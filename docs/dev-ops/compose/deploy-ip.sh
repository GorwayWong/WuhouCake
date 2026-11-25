#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

unset COMPOSE_FILE COMPOSE_PATH_SEPARATOR COMPOSE_ENV_FILES COMPOSE_DISABLE_ENV_FILE COMPOSE_PROJECT_NAME PITR_REPO_DIR
unset DEPLOY_POSTGRES_PROJECT DEPLOY_POSTGRES_VOLUME DEPLOY_POSTGRES_SYSTEM_IDENTIFIER PITR_REPO_MOUNT PITR_REPO_FS_UUID APP_IMAGE RELEASE_DIR

exec python3 - "$@" <<'PYTHON'
from contextlib import contextmanager
import fcntl
import hashlib
import io
import json
import os
from html.parser import HTMLParser
from ipaddress import IPv4Address
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import zipfile
import sys
from urllib.parse import urlsplit


def stop(message):
    sys.exit(f"发布已停止：{message}")


args = sys.argv[1:]
release = bool(args and args[0] == "--release")
rollback_safe = release and args[-1] == "--rollback-safe"
candidate = args[1:-1] if rollback_safe else args[1:]
check_only = "--check" in args
recover_previous = args == ["--recover-previous"]
disable_pitr = "--disable-pitr" in args
services = [] if release or recover_previous else [arg for arg in args if arg not in ("--check", "--disable-pitr")]
if (release and len(candidate) != 2 or not release and not recover_previous and (
        len(set(args)) != len(args) or services not in ([], ["postgres"]) or disable_pitr and services != ["postgres"])):
    stop("用法：./deploy-ip.sh [--release IMAGE RELEASE_DIR [--rollback-safe] | --recover-previous | [--check] [postgres [--disable-pitr]]]")

compose = ["docker", "compose", "--env-file", ".env"]
application_services = ["app", "image-worker"]
release_services = [*application_services, "gateway"]
journal = Path("maintenance/release-pending.json")
receipt = journal.with_name("release-last.json")

if release or not check_only:
    journal.parent.mkdir(exist_ok=True)
    lock = journal.with_name("release.lock").open("a")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        stop("已有发布或启动在运行。")
    if journal.exists() and not recover_previous:
        stop("上次发布未完成。请按运维手册处理 maintenance/release-pending.json。")


def read(command, failure):
    try:
        return subprocess.check_output(command, stderr=subprocess.DEVNULL, text=True, timeout=30)
    except (OSError, subprocess.SubprocessError, UnicodeError):
        stop(failure)


def config(*args):
    return read(compose + ["config", *args], "无法解析 Compose 配置，请检查部署目录的 .env 和覆盖文件。")


environment = dict(line.split("=", 1) for line in config("--environment").splitlines() if "=" in line)
try:
    model = json.loads(config("--format", "json", "postgres"))
    postgres = model["services"]["postgres"]
    mounts = {mount["target"]: mount for mount in postgres.get("volumes", [])}
    data = mounts.get("/var/lib/postgresql/data", {})
    volume = model["volumes"]["postgres-data"]
    volume_name = volume["name"]
    expected_project = environment.get("DEPLOY_POSTGRES_PROJECT")
    expected_volume = environment.get("DEPLOY_POSTGRES_VOLUME")
    expected_cluster = environment.get("DEPLOY_POSTGRES_SYSTEM_IDENTIFIER", "")
    if not expected_project or not expected_volume or not re.fullmatch(r"[0-9]{1,20}", expected_cluster):
        stop("请先在 .env 登记现有 PostgreSQL 的项目名、卷和集群标识。")
    if model["name"] != expected_project or volume_name != expected_volume or volume.get("external") is not True:
        stop("解析后的项目或外部数据卷与登记不符。")
    if data.get("type") != "volume" or data.get("source") != "postgres-data" or data.get("read_only", False):
        stop("PostgreSQL 必须使用登记的可写数据卷。")
except (ValueError, TypeError, KeyError, AttributeError):
    stop("无法读取 PostgreSQL 和数据卷配置。")

read(["docker", "volume", "inspect", volume_name], "登记的 PostgreSQL 数据卷不存在或无法检查。")
container_ids = read(["docker", "ps", "-aq", "--filter", f"label=com.docker.compose.project={expected_project}",
                      "--filter", "label=com.docker.compose.service=postgres"], "无法检查现有 PostgreSQL 容器。").split()
if len(container_ids) > 1:
    stop("登记的项目下存在多个 PostgreSQL 容器，请先核对。")
existing_mounts = {}
probe_image = postgres["image"]
if container_ids:
    try:
        container, = json.loads(read(["docker", "inspect", container_ids[0]], "无法读取现有 PostgreSQL 容器。"))
        existing_mounts = {mount["Destination"]: mount for mount in container["Mounts"]}
        if existing_mounts.get("/var/lib/postgresql/data", {}).get("Name") != volume_name:
            stop("现有 PostgreSQL 容器的数据卷与登记不符。")
        probe_image = container["Image"]
    except (ValueError, TypeError, KeyError):
        stop("无法识别现有容器的镜像或数据卷。")

cluster = read(["docker", "run", "--pull=never", "--rm", "--network", "none", "--user", "postgres",
                "--env", "LC_ALL=C", "--entrypoint", "sh", "--mount",
                f"type=volume,src={volume_name},dst=/verified-data,readonly", probe_image, "-ec",
                'cat /verified-data/PG_VERSION; exec pg_controldata /verified-data'],
               "无法只读检查数据卷。请核对本地 PostgreSQL 镜像与数据目录。")
identifier = re.search(r"^Database system identifier:\s*([0-9]+)$", cluster, re.MULTILINE)
if not cluster.startswith("17\n") or not identifier or identifier[1] != expected_cluster:
    stop("数据卷未初始化、版本不符或 PostgreSQL 集群标识已改变。")

repository = environment.get("PITR_REPO_DIR", "")
target_pitr = "/var/lib/pgbackrest" in mounts or "/etc/pgbackrest/pgbackrest.conf" in mounts
if ("/var/lib/pgbackrest" in existing_mounts and not target_pitr and not disable_pitr
        or disable_pitr and (target_pitr or repository)):
    stop("PITR 配置变更不明确。停用时须移除覆盖和目录配置，并显式指定 --disable-pitr。")
if bool(repository) != target_pitr:
    stop("PITR 仓库目录与 Compose 覆盖必须同时配置。")
if repository:
    expected_image = environment.get("PITR_POSTGRES_IMAGE") or "wuhou-postgres-pitr:17"
    if postgres.get("image") != expected_image:
        stop("PostgreSQL 镜像与 PITR 配置不符，请检查 COMPOSE_FILE。")

    command = postgres.get("command")
    if not isinstance(command, list) or command[:1] != ["postgres"] or command[1::2] != ["-c"] * len(command[2::2]):
        stop("PostgreSQL 启动命令与 PITR 配置不符。")
    for setting in ("archive_mode=on", "archive_timeout=120s", "archive_command=pgbackrest --stanza=wuhou archive-push %p"):
        name = setting.split("=", 1)[0]
        if [arg for arg in command[2::2] if arg.split("=", 1)[0] == name] != [setting]:
            stop(f"PostgreSQL 的 {name} 配置与 PITR 要求不符。")

    repo_mount = mounts.get("/var/lib/pgbackrest", {})
    if (repo_mount.get("type") != "bind" or repo_mount.get("read_only", False)
            or repo_mount.get("source") != os.path.abspath(repository)
            or not os.path.isdir(repository)):
        stop("PostgreSQL 缺少 PITR 仓库的可写挂载。")
    mountpoint = environment.get("PITR_REPO_MOUNT", "")
    filesystem_uuid = environment.get("PITR_REPO_FS_UUID", "")
    if (not filesystem_uuid or not os.path.isabs(mountpoint) or mountpoint == "/"
            or os.path.realpath(mountpoint) != mountpoint or os.path.realpath(repository) != repository
            or not repository.startswith(mountpoint + "/")
            or repo_mount.get("bind", {}).get("create_host_path") is not False):
        stop("PITR 仓库必须是登记的专用挂载盘内的实际子目录。")
    try:
        filesystem, = json.loads(read(["findmnt", "--json", "--target", repository, "--output", "TARGET,UUID,OPTIONS,FSROOT"],
                                      "无法读取 PITR 仓库所在文件系统。"))["filesystems"]
        if (filesystem["target"] != mountpoint or filesystem["uuid"] != filesystem_uuid
                or filesystem["fsroot"] != "/" or "rw" not in filesystem["options"].split(",")):
            stop("PITR 仓库未挂载到登记的可写文件系统。")
    except (ValueError, TypeError, KeyError):
        stop("无法识别 PITR 仓库所在的挂载点。")
    config_mount = mounts.get("/etc/pgbackrest/pgbackrest.conf", {})
    if (config_mount.get("type") != "bind" or not config_mount.get("read_only")
            or not os.path.isfile(config_mount.get("source", ""))):
        stop("PostgreSQL 缺少 pgBackRest 配置的只读挂载。")

def valid_order_submission_protocol(value):
    return isinstance(value, str) and re.fullmatch(r"[2-9]|[1-9][0-9]{1,8}", value) is not None


class EntryPage(HTMLParser):
    def __init__(self):
        super().__init__()
        self.assets = {}
        self.has_entry = False
        self.order_submission_protocol = None

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        if tag == "meta" and attrs.get("name") == "wuhou-order-submission-protocol":
            declared = attrs.get("content")
            if self.order_submission_protocol is not None or not valid_order_submission_protocol(declared):
                raise ReleaseError("前端产物中的建单协议声明无效。")
            self.order_submission_protocol = declared
            return
        is_entry = tag == "script" and attrs.get("type") == "module"
        relation = attrs.get("rel") if tag == "link" else None
        if not is_entry and relation not in ("modulepreload", "stylesheet"):
            return
        url = urlsplit(attrs.get("src" if is_entry else "href") or "")
        if url.netloc or url.scheme:
            return
        if not re.fullmatch(r"/assets/[A-Za-z0-9._/-]+", url.path) or url.query or url.fragment:
            raise ValueError("Invalid entry asset path")
        self.has_entry |= is_entry
        self.assets[url.path] = "css" if relation == "stylesheet" else "js"


def frontend(command, expected_directory=None):
    try:
        gateway = json.loads(read(command + ["config", "--format", "json", "gateway"], "无法读取网关配置。"))["services"]["gateway"]
        site_mount, = [mount for mount in gateway["volumes"] if mount["target"] == "/srv"]
        if site_mount["type"] != "bind" or not site_mount.get("read_only"):
            raise ValueError("Frontend mount must be read-only")
        dist = Path(site_mount["source"]).resolve()
        if expected_directory is not None and dist != Path(expected_directory, "dist").resolve():
            raise ValueError("Compose did not select the candidate directory")
        index = (dist / "index.html").resolve(strict=True)
        if not index.is_relative_to(dist) or not index.is_file():
            raise ValueError("Invalid frontend entry")
        page = EntryPage()
        page.feed(index.read_text(encoding="utf-8"))
        page.close()
        if not page.has_entry:
            raise ValueError("Missing module entry")
        assets = {"/": (index, ("text/html",))}
        for url, kind in page.assets.items():
            source = (dist / url.lstrip("/")).resolve(strict=True)
            if not source.is_relative_to(dist) or not source.is_file() or not source.stat().st_size:
                raise ValueError("Missing frontend asset")
            assets[url] = (source, ("text/css",) if kind == "css" else ("text/javascript", "application/javascript"))
        public_ip = str(IPv4Address(gateway["environment"]["PUBLIC_IP"]))
        https_port, = [int(port["published"]) for port in gateway["ports"]
                       if port["target"] == 443 and port.get("protocol", "tcp") == "tcp"]
        if not 1 <= https_port <= 65535:
            raise ValueError("Invalid gateway host port")
    except (OSError, RuntimeError, ValueError, TypeError, KeyError, AttributeError):
        stop("前端产物或网关挂载配置不完整，请检查 /srv 对应的发布目录、入口文件和 HTTPS 端口。")
    if not shutil.which("curl"):
        stop("网关前端检查需要 curl。")

    return assets, public_ip, https_port, page.order_submission_protocol

class ReleaseError(Exception):
    pass


def checked(command, failure, timeout=30):
    try:
        return subprocess.check_output(command, stderr=subprocess.DEVNULL, text=True, timeout=timeout)
    except (OSError, subprocess.SubprocessError, UnicodeError) as error:
        raise ReleaseError(failure) from error


def probe_application(command):
    failure = "应用未通过 readiness 检查，请核对 PostgreSQL、Redis 和应用日志。"
    body = checked(command + ["exec", "-T", "app", "wget", "-T", "10", "-qO-",
                           "http://127.0.0.1:8080/actuator/health/readiness"], failure)
    try:
        if json.loads(body).get("status") != "UP":
            raise ReleaseError(failure)
    except (ValueError, AttributeError):
        raise ReleaseError(failure)


def probe_gateway(site):
    assets, public_ip, https_port, _ = site
    for path, (source, media_types) in assets.items():
        failure = f"网关前端检查失败：{path}。请核对 HTTPS、发布目录及静态文件响应。"
        try:
            response = subprocess.check_output(
                ["curl", "--disable", "--noproxy", "*", "--connect-to", f"{public_ip}:443:127.0.0.1:{https_port}",
                 "--fail", "--silent", "--show-error", "--max-time", "10",
                 "--write-out", "\n%{http_code} %{content_type}", f"https://{public_ip}{path}"],
                stderr=subprocess.DEVNULL, timeout=12)
            content, metadata = response.rsplit(b"\n", 1)
            status, media_type = metadata.decode("ascii").split(" ", 1)
            if status != "200" or media_type.split(";")[0].strip() not in media_types or content != source.read_bytes():
                raise ReleaseError(failure)
        except (OSError, subprocess.SubprocessError, ValueError):
            raise ReleaseError(failure)


def probe(command, site):
    probe_application(command)
    probe_gateway(site)


def image_id(reference):
    value = checked(["docker", "image", "inspect", "--format", "{{.Id}}", reference], "发布镜像必须已在本地。").strip()
    if not re.fullmatch(r"sha256:[a-f0-9]{64}", value):
        raise ReleaseError("无法识别本地镜像 ID。")
    return value


def release_config_hashes():
    hashes = dict(line.split() for line in checked(compose + ["config", "--hash=*"],
                                                   "无法验证运行中服务的 Compose 配置。").splitlines())
    return {name: hashes[name] for name in release_services}


def previous_artifacts():
    ids = checked(compose + ["ps", "-q", *release_services], "无法读取现有发布服务。").split()
    if len(ids) != len(release_services):
        raise ReleaseError("发布前需要一套运行中的基线服务。")
    rows = json.loads(checked(["docker", "inspect", *ids], "无法读取现有容器。"))
    running = {row["Config"]["Labels"]["com.docker.compose.service"]: row for row in rows}
    app = image_id(environment["APP_IMAGE"])
    gateway = running["gateway"]
    mount, = [item for item in gateway["Mounts"] if item["Destination"] == "/srv"]
    if (not all(running[name]["State"]["Running"] for name in release_services)
            or any(running[name]["Image"] != app for name in ["app", "image-worker"])
            or gateway["Image"] != image_id(environment.get("GATEWAY_IMAGE") or "caddy:2.10.2-alpine")
            or mount["RW"] or Path(mount["Source"]).resolve() != Path(environment["RELEASE_DIR"], "dist").resolve()):
        raise ReleaseError("现有发布与 .env 登记不符，请先核对基线镜像和前端目录。")
    hashes = release_config_hashes()
    if any(running[name]["Config"]["Labels"].get("com.docker.compose.config-hash") != hashes[name] for name in release_services):
        raise ReleaseError("运行中服务的 Compose 配置已变化，请走单独维护流程。")
    return {"image": app, "directory": environment["RELEASE_DIR"]}, hashes, gateway["Id"]


def flyway_history():
    sql = ("SELECT json_build_array((SELECT system_identifier::text FROM pg_control_system()), "
           "(SELECT json_agg(h ORDER BY installed_rank) FROM public.flyway_schema_history h))")
    value = json.loads(checked(compose + ["exec", "-T", "-u", "postgres", "postgres", "psql", "-XAt",
                                          "-v", "ON_ERROR_STOP=1", "-U", "wuhou", "-d", "wuhou", "-c", sql],
                               "无法读取 Flyway 历史或数据库集群标识。"))
    if value[0] != expected_cluster or not value[1] or not all(row["success"] for row in value[1]):
        raise ReleaseError("Flyway 历史或数据库集群标识不满足回退条件。")
    return value


def application_artifact(image, collect_migrations=False):
    # Inspect the same resources the application loads from the packaged jar.
    command = ["docker", "run", "--pull=never", "--rm", "--network", "none", "--entrypoint", "cat",
               image, "/app/application.jar"]
    with tempfile.TemporaryFile() as jar:
        subprocess.run(command, stdout=jar, stderr=subprocess.DEVNULL, check=True, timeout=60)
        with zipfile.ZipFile(jar) as boot:
            migrations = {}
            protocols = []

            def scan(archive, prefix, owner):
                for name in archive.namelist():
                    if name.startswith(prefix + "db/migration/") and not name.endswith("/"):
                        migrations[(owner, name)] = hashlib.sha256(archive.read(name)).digest()

            if collect_migrations:
                scan(boot, "BOOT-INF/classes/", "bootstrap")
            for name in boot.namelist():
                if not name.startswith("BOOT-INF/lib/") or not name.endswith(".jar"):
                    continue
                order_module = Path(name).name.startswith("WuhouCake-order-")
                if not collect_migrations and not order_module:
                    continue
                with zipfile.ZipFile(io.BytesIO(boot.read(name))) as module:
                    if collect_migrations:
                        scan(module, "", Path(name).name)
                    if order_module:
                        protocols.extend(module.read(item).decode("ascii").strip()
                                         for item in module.infolist() if item.filename == "order/submission-protocol.txt")
        if collect_migrations and not migrations:
            raise ReleaseError("镜像未包含可核实的 Flyway 迁移。")
        if len(protocols) > 1 or protocols and not valid_order_submission_protocol(protocols[0]):
            raise ReleaseError("应用镜像中的建单协议声明无效。")
        return (protocols[0] if protocols else None), migrations


def require_order_submission_protocol(site, app_protocol):
    if app_protocol is None or site[3] != app_protocol:
        raise ReleaseError("应用镜像与前端产物必须声明相同的建单协议，才能启动工作台。")


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def frontend_fingerprint(site):
    return fingerprint({url: hashlib.sha256(source.read_bytes()).hexdigest()
                        for url, (source, _) in site[0].items()})


def atomic_record(path, data):
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as file:
        tmp = Path(file.name)
        try:
            file.write(data)
            file.flush()
            os.fsync(file.fileno())
            os.replace(tmp, path)
        finally:
            tmp.unlink(missing_ok=True)


def record(path, data):
    atomic_record(path, (json.dumps(data, ensure_ascii=False) + "\n").encode())
    parent = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(parent)
    finally:
        os.close(parent)


@contextmanager
def candidate_config(image, directory):
    env = Path(".env")
    if env.is_symlink() or not env.is_file():
        raise ReleaseError(".env 必须为普通文件。")
    original = env.read_bytes()
    content = original.decode()
    for key, value in (("APP_IMAGE", image), ("RELEASE_DIR", directory)):
        content, count = re.subn(r"^" + key + r"=[^\r\n]*", lambda match: f"{key}={value}", content, flags=re.M)
        if count != 1:
            raise ReleaseError(f".env 必须包含唯一的 {key}= 配置行。")
    with tempfile.NamedTemporaryFile(dir=".", prefix=".release-", delete=False) as file:
        temporary = Path(file.name)
    try:
        temporary.write_text(content)
        yield ["docker", "compose", "--env-file", str(temporary)], original, content.encode()
    finally:
        temporary.unlink(missing_ok=True)


def start_release_services(command, services, failure):
    startup = command + ["up", "-d", "--no-deps", "--pull", "never", "--wait", "--wait-timeout", "180"]
    checked(startup + services, failure, timeout=200)


def start_release_application(command):
    start_release_services(command, application_services, "应用服务启动失败，请核对容器状态和日志。")
    probe_application(command)


def start_release_gateway(command, site):
    start_release_services(command, ["gateway"], "网关启动失败，请核对容器状态和日志。")
    probe(command, site)


def recover_legacy_previous():
    failure = "无法确认网关尚未切换且旧版可恢复。请保留发布记录并按手册前滚。"
    if journal.is_symlink() or not journal.is_file():
        raise ReleaseError(failure)
    metadata = json.loads(journal.read_text(encoding="utf-8"))
    if not isinstance(metadata, dict):
        raise ReleaseError(failure)
    evidence = metadata.get("legacyRecovery")
    if (metadata.get("state") not in ("switching", "manual-recovery")
            or metadata.get("gatewaySwitchStarted") is not False
            or metadata.get("cluster") != expected_cluster or not isinstance(evidence, dict)):
        raise ReleaseError(failure)
    previous = metadata["previous"]
    previous_image = image_id(environment["APP_IMAGE"])
    env = Path(".env")
    if (env.is_symlink() or hashlib.sha256(env.read_bytes()).hexdigest() != evidence["env"]
            or previous != {"image": previous_image, "directory": environment["RELEASE_DIR"]}
            or release_config_hashes() != evidence["compose"]
            or fingerprint(flyway_history()) != evidence["flyway"]):
        raise ReleaseError(failure)
    # A different gateway may already have served the new client.
    gateway, = checked(compose + ["ps", "-q", "gateway"], failure).split()
    gateway_row, = json.loads(checked(["docker", "inspect", gateway], failure))
    if gateway_row["Id"] != evidence["gateway"]:
        raise ReleaseError(failure)
    site = frontend(compose, previous["directory"])
    protocol, _ = application_artifact(previous_image)
    if protocol is not None or site[3] is not None or frontend_fingerprint(site) != evidence["frontend"]:
        raise ReleaseError(failure)
    probe_gateway(site)
    start_release_application(compose)
    restored, hashes, gateway_id = previous_artifacts()
    if (restored != previous or hashes != evidence["compose"] or gateway_id != evidence["gateway"]
            or hashlib.sha256(env.read_bytes()).hexdigest() != evidence["env"]
            or fingerprint(flyway_history()) != evidence["flyway"]
            or frontend_fingerprint(site) != evidence["frontend"]):
        raise ReleaseError(failure)
    probe_gateway(site)
    metadata.update(state="rolled-back")
    record(receipt, metadata)
    journal.unlink()


def publish():
    image, directory = candidate
    if not re.fullmatch(r"[a-zA-Z0-9_./:@-]+", image) or not re.fullmatch(r"/[a-zA-Z0-9_./-]+", directory):
        raise ReleaseError("请指定本地候选镜像及不含空格的绝对发布目录。")
    old, hashes, gateway = previous_artifacts()
    baseline_site = frontend(compose)
    probe(compose, baseline_site)
    new_id = image_id(image)
    if Path(directory).resolve() == Path(old["directory"]).resolve():
        raise ReleaseError("候选前端须使用新目录。")
    with candidate_config(new_id, directory) as (command, original, content):
        site = frontend(command, directory)
        resolved = json.loads(checked(command + ["config", "--format", "json", "app", "image-worker"],
                                      "无法核对候选服务镜像。"))["services"]
        if any(resolved[name]["image"] != new_id for name in ("app", "image-worker")):
            raise ReleaseError("Compose 未选择指定的候选镜像。")
        inspect_migrations = rollback_safe or baseline_site[3] is None
        new_protocol, new_migrations = application_artifact(new_id, collect_migrations=inspect_migrations)
        require_order_submission_protocol(site, new_protocol)
        history = None
        legacy_baseline = False
        if inspect_migrations:
            old_protocol, old_migrations = application_artifact(old["image"], collect_migrations=True)
            legacy_baseline = old_protocol is None and baseline_site[3] is None
            if rollback_safe and not legacy_baseline and (old_protocol != new_protocol or baseline_site[3] != old_protocol):
                raise ReleaseError("上一版缺少兼容的建单协议，不能自动回退。请去掉 --rollback-safe 后重新发布。")
            if (rollback_safe or legacy_baseline) and old_migrations == new_migrations:
                history = flyway_history()
        if subprocess.run(["./backup-ip-database.sh", "predeploy"], timeout=1250).returncode:
            raise ReleaseError("发布前备份或校验失败。请查看 wuhou-backup 日志。")
        metadata = {"previous": old, "candidate": {"image": new_id, "directory": directory},
                    "cluster": expected_cluster, "sameMigrationHistoryRequired": rollback_safe and history is not None,
                    "gatewaySwitchStarted": False, "state": "switching"}
        if legacy_baseline and history is not None:
            metadata["legacyRecovery"] = {
                "env": hashlib.sha256(original).hexdigest(), "compose": hashes,
                "gateway": gateway, "flyway": fingerprint(history), "frontend": frontend_fingerprint(baseline_site),
            }
        record(journal, metadata)
        gateway_switch_started = False
        try:
            start_release_application(command)
            metadata["gatewaySwitchStarted"] = True
            record(journal, metadata)
            gateway_switch_started = True
            start_release_gateway(command, site)
            if Path(".env").read_bytes() != original:
                raise ReleaseError("发布期间 .env 发生变化。")
            atomic_record(Path(".env"), content)
        except (ReleaseError, OSError) as error:
            metadata.update(state="manual-recovery", gatewaySwitchStarted=gateway_switch_started,
                            failure=str(error) if isinstance(error, ReleaseError) else "发布配置写入失败")
            record(journal, metadata)
            try:
                services_to_stop = release_services if gateway_switch_started else application_services
                checked(command + ["stop", "-t", "10", *services_to_stop], "无法停止候选发布服务。", timeout=45)
                if (not rollback_safe or history is None or (legacy_baseline and gateway_switch_started)
                        or flyway_history() != history or Path(".env").read_bytes() != original
                        or image_id(environment["APP_IMAGE"]) != old["image"]):
                    raise ReleaseError("自动回退条件不满足，请执行人工恢复流程。")
                start_release_application(compose)
                if gateway_switch_started:
                    start_release_gateway(compose, baseline_site)
                else:
                    probe_gateway(baseline_site)
                metadata.update(state="rolled-back")
                record(receipt, metadata)
                journal.unlink()
            except (ReleaseError, OSError, ValueError, TypeError, KeyError) as rollback_error:
                raise ReleaseError(f"{metadata['failure']} 自动回退未完成。请查阅发布记录和恢复手册。") from rollback_error
            raise ReleaseError(f"{metadata['failure']} 已回退并验证上一版。") from error
        metadata.update(state="published")
        record(receipt, metadata)
        journal.unlink()


try:
    up = compose + ["up", "-d", "--wait", *services]
    if check_only:
        if not services:
            site = frontend(compose)
            protocol, _ = application_artifact(image_id(environment["APP_IMAGE"]))
            if protocol is None and site[3] is None:
                print("前后端均无建单协议声明，可作为首次升级基线。普通启动不支持此组合。")
            else:
                require_order_submission_protocol(site, protocol)
        print("原数据库与 PITR 配置预检通过。" + ("" if services else "前端产物预检通过。"))
    elif services:
        checked(up, "PostgreSQL 启动失败，请核对 Compose 状态和服务日志。", timeout=200)
    elif release:
        publish()
        print("应用 readiness 与网关前端检查通过，候选版本已登记。")
    elif recover_previous:
        recover_legacy_previous()
        print("已恢复并验证网关切换前的旧版。")
    else:
        site = frontend(compose)
        app_protocol, _ = application_artifact(image_id(environment["APP_IMAGE"]))
        require_order_submission_protocol(site, app_protocol)
        checked(up, "容器启动失败，请核对 Compose 状态和服务日志。", timeout=200)
        probe(compose, site)
        print("应用 readiness 与网关前端检查通过。")
except ReleaseError as error:
    stop(str(error))
except (OSError, ValueError, TypeError, KeyError, subprocess.SubprocessError, zipfile.BadZipFile):
    stop("无法验证发布输入或执行发布。请检查部署目录和发布记录。")
PYTHON
