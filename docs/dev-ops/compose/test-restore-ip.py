"""Restore synthetic Wuhou data using real PostgreSQL and the application."""

import argparse
from contextlib import contextmanager
import hashlib
import http.cookiejar
import json
import os
from pathlib import Path
import shutil
import socket
import struct
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zlib

HERE = Path(__file__).resolve().parent
POSTGRES = "postgres:17-bookworm"
INITIAL = "Synthetic restore initial passphrase!"
PASSWORD = "Synthetic restore permanent passphrase!"


def run(*command, **options):
    return subprocess.run(command, check=True, timeout=180, **options)


def json_call(client, method, path, data=None, **options):
    return json.loads(client(method, path, data, **options))["data"]


def session(base, initial=False):
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(jar))
    token = None

    def request(method, path, data=None, *, headers=None, status=200):
        fields = {"Authorization": "Bearer " + token} if token else {}
        if data is not None and not isinstance(data, bytes):
            data = json.dumps(data).encode()
            fields["Content-Type"] = "application/json"
        fields.update(headers or {})
        req = urllib.request.Request(base + path, data=data, method=method, headers=fields)
        try:
            response = opener.open(req, timeout=20)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            body = response.read()
            if response.code != status:
                raise AssertionError(f"{method} {path}: HTTP {response.code}, expected {status}: {body[:500]!r}")
            return body

    def login(password):
        csrf = json_call(request, "GET", "/api/auth/csrf")
        cookie = next(cookie for cookie in jar if cookie.name == "XSRF-TOKEN")
        return json_call(request, "POST", "/api/auth/login", {"employeeNumber": "RESTORE", "password": password},
                         headers={csrf["headerName"]: urllib.parse.unquote(cookie.value)})["accessToken"]

    token = login(INITIAL if initial else PASSWORD)
    if initial:
        json_call(request, "POST", "/api/me/password", {"currentPassword": INITIAL, "newPassword": PASSWORD})
        token = login(PASSWORD)
    return request


def create_order(client, name, phone):
    return json_call(client, "POST", "/api/orders", {
        "customer": {"customerName": "Recovery fixture", "phone": phone},
        "fulfillment": {"type": "PICKUP", "requestedReceiveDate": "2030-01-01"},
        "items": [{"name": name, "productType": "CAKE", "quantity": 2, "attributes": {"size": "8"}}],
        "originalAmountCents": 12000, "totalAmountCents": 12000, "paymentMethod": "CASH",
    }, status=201, headers={"Idempotency-Key": str(uuid.uuid4()), "X-Wuhou-Order-Submission": "3"})


def png():
    def chunk(kind, payload):
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload))
    head = struct.pack(">IIBBBBB", 2, 2, 8, 2, 0, 0, 0)
    row = b"\0\xff\0\0\0\xff\0"
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", head) + chunk(b"IDAT", zlib.compress(row * 2)) + chunk(b"IEND", b"")


def seed(client):
    order = create_order(client, "Before recovery point", "13800000000")
    path = "/api/orders/" + order["orderId"]
    item = order["items"][0]["itemId"]
    boundary = "wuhou-" + uuid.uuid4().hex
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="itemId"\r\n\r\n{item}\r\n'
            f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="fixture.png"\r\n'
            "Content-Type: image/png\r\n\r\n").encode() + png() + f"\r\n--{boundary}--\r\n".encode()
    image = json_call(client, "POST", path + "/images", body, status=201,
                      headers={"Content-Type": f"multipart/form-data; boundary={boundary}",
                               "Idempotency-Key": str(uuid.uuid4())})
    json_call(client, "POST", path + "/notes", {"content": "Retain this work note"}, status=201)
    image_path = path + "/images/" + image["imageId"]
    return path, item, image_path, hashlib.sha256(client("GET", image_path)).hexdigest()


def verify(client, expected, later_id):
    path, item, image_path, digest = expected
    order = json_call(client, "GET", path)
    assert order["paymentStatus"] == "PAID" and order["paidAt"] and order["totalAmountCents"] == 12000
    assert [(element["itemId"], element["quantity"]) for element in order["items"]] == [(item, 2)]
    assert hashlib.sha256(client("GET", image_path)).hexdigest() == digest
    history = json_call(client, "GET", path + "/activities")["items"]
    assert {"CREATED", "NOTE"} <= {record["type"] for record in history}
    notes = json_call(client, "GET", path + "/notes")["items"]
    assert any(note["content"] == "Retain this work note" for note in notes)
    client("GET", "/api/orders/" + later_id, status=404)


class Environment:
    def __init__(self, work, jar, pitr_image):
        self.work, self.jar = work, jar
        self.project = "wuhou-restore-" + uuid.uuid4().hex[:12]
        self.compose = ["docker", "compose", "-p", self.project, "--env-file", ".env"]
        # Use an explicit Compose file so inherited deployment settings cannot select another project.
        clean = ("COMPOSE_FILE", "COMPOSE_PROJECT_NAME", "COMPOSE_ENV_FILES", "COMPOSE_PATH_SEPARATOR")
        self.env = {key: value for key, value in os.environ.items() if key not in clean}
        config = ["-c", "listen_addresses=*"]
        mounts = ["source:/var/lib/postgresql/data"]
        restored = ["restored:/var/lib/postgresql/data"]
        if pitr_image:
            archive = ["-c", "archive_mode=on", "-c", "archive_timeout=120s",
                       "-c", "archive_command=pgbackrest --stanza=wuhou archive-push %p"]
            config += archive
            settings = str(HERE / "pgbackrest-ip.conf") + ":/etc/pgbackrest/pgbackrest.conf:ro"
            mounts += ["archive:/var/lib/pgbackrest", settings]
            restored += ["archive:/var/lib/pgbackrest:ro", settings]
        pg = {
            "image": pitr_image or POSTGRES,
            "environment": {"POSTGRES_USER": "wuhou", "POSTGRES_DB": "wuhou", "POSTGRES_PASSWORD": "isolated-restore"},
            "ports": ["127.0.0.1::5432"],
            "healthcheck": {"test": ["CMD", "pg_isready", "-h", "127.0.0.1", "-U", "wuhou"],
                            "interval": "1s", "timeout": "2s", "retries": 60},
        }
        cache = {"image": "redis:7-bookworm", "ports": ["127.0.0.1::6379"]}
        model = {"name": self.project, "services": {
            "postgres": pg | {"command": ["postgres", *config], "volumes": mounts},
            "restored": pg | {"command": ["postgres", "-c", "archive_mode=off"], "volumes": restored},
            "redis": cache,
            "restored-redis": cache,
        }, "volumes": {name: {} for name in ("source", "restored", "archive")}}
        (work / "compose.yml").write_text(json.dumps(model))
        (work / ".env").write_text(f"COMPOSE_PROJECT_NAME={self.project}\n")
        for file in ("backup-ip-database.py", "backup-ip-database.sh"):
            shutil.copy2(HERE / file, work)
        self.run("openssl", "genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048",
                 "-out", "private.pem", stderr=subprocess.DEVNULL)
        self.run("openssl", "pkey", "-in", "private.pem", "-pubout", "-out", "public.pem")
        (work / "private.pem").chmod(0o600)
        admin = work / "admin.json"
        admin.write_text(json.dumps({"employeeNumber": "RESTORE", "nickname": "Recovery fixture", "password": INITIAL}))
        admin.chmod(0o600)

    def run(self, *command, **options):
        return run(*command, cwd=self.work, env=self.env, **options)

    def docker(self, *command, **options):
        return self.run(*self.compose, *command, **options)

    def capture(self, *args):
        return self.docker(*args, capture_output=True, text=True).stdout.strip()

    def sql(self, db, query):
        return self.capture("exec", "-T", "-u", "postgres", db, "psql", "-XAt", "-v", "ON_ERROR_STOP=1",
                            "-U", "wuhou", "-d", "wuhou", "-c", query)

    def up(self, *services):
        self.docker("up", "-d", "--wait", "--wait-timeout", "100", *services)

    def app_command(self, database):
        pg = self.capture("port", database, "5432")
        redis = self.capture("port", "redis" if database == "postgres" else "restored-redis", "6379")
        if not (pg.startswith("127.0.0.1:") and redis.startswith("127.0.0.1:")):
            raise RuntimeError("Recovery ports must bind to loopback")
        return ["java", "-jar", str(self.jar), "--spring.profiles.active=integration",
                "--spring.datasource.url=jdbc:postgresql://" + pg + "/wuhou",
                "--spring.datasource.username=wuhou", "--spring.datasource.password=isolated-restore",
                "--spring.data.redis.host=127.0.0.1", "--spring.data.redis.port=" + redis.split(":")[1],
                "--spring.data.redis.password=", "--wuhoucake.identity.secure-cookie=false",
                "--wuhoucake.order-recognition.assist.enabled=false", "--wuhoucake.images.worker-url=",
                "--wuhoucake.identity.private-key=" + str(self.work / "private.pem"),
                "--wuhoucake.identity.public-key=" + str(self.work / "public.pem")]

    def initialize(self):
        command = self.app_command("postgres")
        self.run(*command, "--spring.main.web-application-type=none",
                 "--wuhoucake.identity.command=init-admin", "--wuhoucake.identity.credential-file=admin.json")

    @contextmanager
    def application(self, database):
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        base = f"http://127.0.0.1:{port}"
        path = self.work / f"{database}-app.log"
        with path.open("wb") as log:
            app = subprocess.Popen(self.app_command(database) + [f"--server.port={port}"],
                                   cwd=self.work, env=self.env, stdout=log, stderr=subprocess.STDOUT)
            try:
                started = time.monotonic()
                while time.monotonic() - started < 60 and app.poll() is None:
                    try:
                        with urllib.request.urlopen(base + "/actuator/health/readiness", timeout=2) as response:
                            if json.load(response)["status"] == "UP":
                                break
                    except (OSError, ValueError):
                        pass
                    time.sleep(0.5)
                else:
                    raise RuntimeError("Restored application did not become ready")
                yield base
            except Exception:
                print(path.read_text(errors="replace")[-5000:], flush=True)
                raise
            finally:
                if app.poll() is None:
                    app.terminate()
                    try:
                        app.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        app.kill()
                        app.wait()

    def pgbackrest(self, *args):
        self.docker("exec", "-T", "-u", "postgres", "postgres", "pgbackrest", "--stanza=wuhou", *args)

    def restore(self, pitr):
        self.up("postgres", "redis")
        if pitr:
            self.docker("exec", "-T", "-u", "root", "postgres", "chown", "postgres:postgres", "/var/lib/pgbackrest")
            self.pgbackrest("stanza-create")
            self.pgbackrest("check")
        self.initialize()
        if pitr:
            self.pgbackrest("--type=full", "backup")
        with self.application("postgres") as base:
            client = session(base, initial=True)
            expected = seed(client)
            target = self.sql("postgres", "SELECT clock_timestamp()")
            if not pitr:
                self.run("sh", "backup-ip-database.sh", "daily")
            later = create_order(client, "After recovery point", "13800000001")
        assert self.sql("postgres", "SELECT count(*) FROM cake_order") == "2"

        if pitr:
            self.sql("postgres", "SELECT pg_switch_wal()")
            self.pgbackrest("check")

        # Start timing after the source has finished archiving and just before restore.
        started = time.monotonic()
        if pitr:
            self.docker("run", "--rm", "-T", "--no-deps", "--user", "root", "--entrypoint", "chown",
                        "restored", "postgres:postgres", "/var/lib/postgresql/data")
            self.docker("run", "--rm", "-T", "--no-deps", "--user", "postgres", "--entrypoint", "pgbackrest",
                        "restored", "--stanza=wuhou", "--type=time", f"--target={target}",
                        "--target-action=promote", "restore")
            self.up("restored")
            deadline = time.monotonic() + 60
            while self.sql("restored", "SELECT pg_is_in_recovery()") != "f":
                if time.monotonic() >= deadline:
                    raise AssertionError("PostgreSQL did not reach or promote at the recovery target")
                time.sleep(0.5)
        else:
            backup, = (self.work / "backups" / "daily").glob("*/database.dump")
            manifest = json.loads(backup.with_name("manifest.json").read_text())
            with backup.open("rb") as stream:
                assert hashlib.file_digest(stream, "sha256").hexdigest() == manifest["sha256"]
            assert backup.stat().st_size == manifest["bytes"]
            self.up("restored")
            with backup.open("rb") as stream:
                self.docker("exec", "-T", "-u", "postgres", "restored", "pg_restore", "--exit-on-error",
                            "--single-transaction", "-U", "wuhou", "-d", "wuhou", stdin=stream)
        assert self.sql("restored", "SELECT count(*) FROM cake_order") == "1"
        # Separate session state from the source so login proves identity was restored from PostgreSQL.
        self.up("restored-redis")
        with self.application("restored") as base:
            verify(session(base), expected, later["orderId"])
        print(f"{'PITR' if pitr else 'Logical restore'} passed; target={target}; restore_and_verify_seconds={time.monotonic() - started:.2f}",
              flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--jar", type=Path, required=True)
    parser.add_argument("--pitr-image", help="Run PITR using a local image built from postgres-pitr.Dockerfile")
    args = parser.parse_args()
    jar = args.jar.resolve(strict=True)
    with tempfile.TemporaryDirectory(prefix="wuhou-restore-") as directory:
        environment = Environment(Path(directory), jar, args.pitr_image)
        try:
            environment.restore(bool(args.pitr_image))
        finally:
            environment.docker("down", "--volumes", "--remove-orphans")


if __name__ == "__main__":
    main()
