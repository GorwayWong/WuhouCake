#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

unset COMPOSE_FILE COMPOSE_PATH_SEPARATOR COMPOSE_ENV_FILES COMPOSE_DISABLE_ENV_FILE COMPOSE_PROJECT_NAME PITR_REPO_DIR
unset DEPLOY_POSTGRES_PROJECT DEPLOY_POSTGRES_VOLUME DEPLOY_POSTGRES_SYSTEM_IDENTIFIER PITR_REPO_MOUNT PITR_REPO_FS_UUID

exec python3 - "$@" <<'PYTHON'
import json
import os
from html.parser import HTMLParser
from ipaddress import IPv4Address
from pathlib import Path
import re
import shutil
import subprocess
import sys
from urllib.parse import urlsplit


def stop(message):
    sys.exit(f"发布已停止：{message}")


args = sys.argv[1:]
check_only = "--check" in args
release = "--release" in args
disable_pitr = "--disable-pitr" in args
services = [arg for arg in args if arg not in ("--check", "--disable-pitr", "--release")]
if (len(set(args)) != len(args) or services not in ([], ["postgres"])
        or disable_pitr and services != ["postgres"] or release and (check_only or services)):
    stop("用法：./deploy-ip.sh [--release | [--check] [postgres [--disable-pitr]]]")

compose = ["docker", "compose", "--env-file", ".env"]


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

class EntryPage(HTMLParser):
    def __init__(self):
        super().__init__()
        self.assets = {}
        self.has_entry = False

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
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


if not services:
    try:
        gateway = json.loads(config("--format", "json", "gateway"))["services"]["gateway"]
        site_mount, = [mount for mount in gateway["volumes"] if mount["target"] == "/srv"]
        if site_mount["type"] != "bind" or not site_mount.get("read_only"):
            raise ValueError("Frontend mount must be read-only")
        dist = Path(site_mount["source"]).resolve()
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


up = compose + ["up", "-d", "--wait", *services]
if check_only:
    print("原数据库与 PITR 配置预检通过。" + ("" if services else "前端产物预检通过。"))
elif services:
    os.execvp("docker", up)
else:
    if release and subprocess.run(["./backup-ip-database.sh", "predeploy"]).returncode:
        stop("发布前备份或校验失败。请查看 wuhou-backup 日志。")
    if subprocess.run(up).returncode:
        stop("容器启动失败，请核对 Compose 状态和服务日志。")
    failure = "应用未通过 readiness 检查，请核对 PostgreSQL、Redis 和应用日志。"
    body = read(compose + ["exec", "-T", "app", "wget", "-T", "10", "-qO-",
                           "http://127.0.0.1:8080/actuator/health/readiness"], failure)
    try:
        if json.loads(body).get("status") != "UP":
            stop(failure)
    except (ValueError, AttributeError):
        stop(failure)
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
                stop(failure)
        except (OSError, subprocess.SubprocessError, ValueError):
            stop(failure)
    print("应用 readiness 与网关前端检查通过。")
PYTHON
