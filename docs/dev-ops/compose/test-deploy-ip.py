"""Exercise deploy preflight with synthetic Docker and mount metadata."""
import json
from io import BytesIO
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import zipfile


SCRIPT = Path(__file__).with_name("deploy-ip.sh")
PGDATA = "/var/lib/postgresql/data"
PROJECT = "wuhou-ip"
VOLUME = "wuhou-ip_postgres-data"
IDENTIFIER = "7123456789012345678"
OLD = "sha256:" + "a" * 64
NEW = "sha256:" + "b" * 64


class DeployPreflight(unittest.TestCase):
    def test_existing_cluster_and_pitr_mount(self):
        result, commands = self.run_preflight(pitr=True, args=["--check"])
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn("预检通过", result.stdout)
        self.assertFalse(any("up" in call for call in commands))
        probe = next(call for call in commands if call[0] == "run")
        self.assertIn(f"type=volume,src={VOLUME},dst=/verified-data,readonly", probe)

    def test_unsafe_configurations_stop_before_recreation(self):
        for failure in ("wrong_project", "wrong_volume", "wrong_running_volume", "missing_volume",
                        "empty_database", "wrong_cluster", "unmounted", "wrong_disk", "read_only", "missing_overlay"):
            with self.subTest(failure=failure):
                result, commands = self.run_preflight(failure=failure, pitr=failure in ("unmounted", "wrong_disk", "read_only"))
                self.assertNotEqual(0, result.returncode, result.stdout)
                self.assertIn("发布已停止", result.stderr)
                self.assertFalse(any("up" in call for call in commands))

    def test_successful_release_and_explicit_pitr_rollback(self):
        for failure, args in (("", []), ("missing_overlay", ["postgres", "--disable-pitr"])):
            with self.subTest(args=args):
                result, commands = self.run_preflight(failure=failure, args=args)
                self.assertEqual(0, result.returncode, result.stderr)
                self.assertIn(["compose", "--env-file", ".env", "up", "-d", "--wait"]
                              + (["postgres"] if args else []), commands)
                self.assertEqual(not args, any("exec" in call for call in commands))

    def test_release_requires_dependency_readiness(self):
        for failure in ("readiness_down", "readiness_missing"):
            with self.subTest(failure=failure):
                result, commands = self.run_preflight(failure=failure)
                self.assertNotEqual(0, result.returncode, result.stdout)
                self.assertIn("未通过 readiness", result.stderr)
                self.assertIn("up", commands[-2])
                self.assertIn("exec", commands[-1])

    def test_release_runs_verified_backup_before_startup(self):
        for failure in ("", "backup_failed"):
            with self.subTest(failure=failure):
                result, commands = self.run_preflight(failure=failure, args=["--release"])
                self.assertIn(["backup", "predeploy"], commands)
                if failure:
                    self.assertNotEqual(0, result.returncode)
                    self.assertFalse(any("up" in call for call in commands))
                else:
                    self.assertEqual(0, result.returncode, result.stderr)
                    self.assertLess(commands.index(["backup", "predeploy"]), next(i for i, call in enumerate(commands) if "up" in call))
                    self.assertIn("APP_IMAGE=" + NEW, self.final_env)

    def test_release_checks_candidate_app_before_switching_gateway(self):
        result, commands = self.run_preflight(args=["--release"])
        self.assertEqual(0, result.returncode, result.stderr)
        starts = [i for i, call in enumerate(commands) if "up" in call]
        self.assertEqual(2, len(starts))
        app, gateway = starts
        self.assertEqual(["app", "image-worker"], commands[app][-2:])
        self.assertEqual("gateway", commands[gateway][-1])
        self.assertTrue(any("exec" in call and "http://127.0.0.1:8080/actuator/health/readiness" in call
                            for call in commands[app + 1:gateway]))
        result, commands = self.run_preflight(args=["--release"], failure="readiness_down")
        self.assertNotEqual(0, result.returncode)
        self.assertFalse(any("up" in call and call[-1] == "gateway" for call in commands))

    def test_release_checks_the_packaged_order_protocol(self):
        for app, web in ((None, "2"), ("2", None), ("2", "3")):
            with self.subTest(app=app, web=web):
                result, commands = self.run_preflight(args=["--release"], candidate_protocol=app, candidate_web_protocol=web)
                self.assertNotEqual(0, result.returncode)
                self.assertIn("建单协议", result.stderr)
                self.assertFalse(any("up" in call or "backup" in call for call in commands))

    def test_first_protocol_release_restores_legacy_before_gateway_only(self):
        result, commands = self.run_preflight(failure="readiness_down", args=["--release", "--rollback-safe"], baseline_protocol=None)
        self.assertNotEqual(0, result.returncode)
        self.assertEqual("rolled-back", self.receipt["state"])
        self.assertFalse(self.receipt["gatewaySwitchStarted"])
        self.assertIsNone(self.pending)
        updates = [call for call in commands if "up" in call or "stop" in call]
        self.assertEqual(3, len(updates))
        self.assertTrue(all(call[-2:] == ["app", "image-worker"] for call in updates))
        for failure in ("gateway_404", "history_changed_before_gateway", "config_changed_before_gateway"):
            with self.subTest(failure=failure):
                result, commands = self.run_preflight(failure=failure, args=["--release", "--rollback-safe"], baseline_protocol=None)
                self.assertNotEqual(0, result.returncode)
                self.assertEqual("manual-recovery", self.pending["state"])
                self.assertEqual(failure == "gateway_404", self.pending["gatewaySwitchStarted"])
                self.assertFalse(any("up" in call and ".env" in call for call in commands))
        result, commands = self.run_preflight(failure="readiness_down", args=["--release"], baseline_protocol=None)
        self.assertNotEqual(0, result.returncode)
        self.assertEqual("manual-recovery", self.pending["state"])
        self.assertFalse(any("up" in call and ".env" in call for call in commands))
        result, commands = self.run_preflight(args=["--release", "--rollback-safe"], baseline_protocol=None)
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual("published", self.receipt["state"])

    def test_startup_rejects_configured_legacy_artifacts(self):
        result, commands = self.run_preflight(baseline_protocol=None)
        self.assertNotEqual(0, result.returncode)
        self.assertIn("建单协议", result.stderr)
        self.assertFalse(any("up" in call for call in commands))

    def test_preflight_reports_legacy_pair_and_rejects_mismatched_protocol(self):
        result, commands = self.run_preflight(args=["--check"], baseline_protocol=None)
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn("可作为首次升级基线", result.stdout)
        self.assertIn("普通启动不支持", result.stdout)
        self.assertFalse(any("up" in call for call in commands))
        result, commands = self.run_preflight(args=["--check"], failure="baseline_web_protocol_mismatch")
        self.assertNotEqual(0, result.returncode)
        self.assertIn("建单协议", result.stderr)
        self.assertFalse(any("up" in call for call in commands))

    def test_manual_recovery_restarts_legacy_application_without_touching_gateway(self):
        result, commands = self.run_preflight(failure="readiness_down", args=["--release"],
                                              baseline_protocol=None, recover="unchanged")
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual("rolled-back", self.receipt["state"])
        self.assertFalse(self.receipt["gatewaySwitchStarted"])
        self.assertIsNone(self.pending)
        self.assertIn("APP_IMAGE=old-app", self.final_env)
        updates = [call for call in commands if "up" in call or "stop" in call]
        self.assertEqual(1, len(updates))
        self.assertEqual(["app", "image-worker"], updates[0][-2:])
        self.assertIn("--no-deps", updates[0])
        self.assertTrue(any(call[0] == "curl" for call in commands[commands.index(updates[0]) + 1:]))

    def test_manual_recovery_checks_record_artifacts_gateway_and_schema_before_starting(self):
        for change in ("missing", "evidence_missing", "unknown_phase", "gateway_switched", "gateway_replaced",
                       "wrong_image", "wrong_frontend", "env_changed", "config_hash_changed", "schema_changed"):
            with self.subTest(change=change):
                result, commands = self.run_preflight(failure="readiness_down", args=["--release"],
                                                      baseline_protocol=None, recover=change)
                self.assertNotEqual(0, result.returncode, result.stdout)
                self.assertIn("前滚", result.stderr)
                self.assertFalse(any("up" in call or "stop" in call for call in commands))
                self.assertIsNone(self.receipt)
                if change != "missing":
                    self.assertIsNotNone(self.pending)

    def test_manual_recovery_preserves_record_if_the_restarted_application_is_unready(self):
        result, commands = self.run_preflight(failure="readiness_down", args=["--release"],
                                              baseline_protocol=None, recover="recovery_unready")
        self.assertNotEqual(0, result.returncode)
        self.assertIn("未通过 readiness", result.stderr)
        self.assertIsNotNone(self.pending)
        self.assertIsNone(self.receipt)
        self.assertEqual([["app", "image-worker"]], [call[-2:] for call in commands if "up" in call])

    def test_site_files_are_required_before_backup_and_startup(self):
        for failure in ("missing_index", "missing_entry", "missing_style"):
            for args in (["--check"], ["--release"]):
                with self.subTest(failure=failure, args=args):
                    result, commands = self.run_preflight(failure=failure, args=args)
                    self.assertNotEqual(0, result.returncode)
                    self.assertIn("前端产物", result.stderr)
                    self.assertFalse(any("up" in call or "backup" in call for call in commands))

    def test_release_probes_the_actual_gateway(self):
        for failure in ("", "gateway_404", "entry_returns_html", "stale_home", "wrong_media"):
            with self.subTest(failure=failure):
                result, commands = self.run_preflight(failure=failure, args=["--release"])
                probes = [call for call in commands if call[0] == "curl" and "candidate-dir" in call]
                self.assertTrue(probes)
                self.assertIn("192.0.2.1:443:127.0.0.1:8443", probes[0])
                if failure:
                    self.assertNotEqual(0, result.returncode)
                    self.assertIn("网关前端", result.stderr)
                else:
                    self.assertEqual(0, result.returncode, result.stderr)
                    self.assertEqual(["https://192.0.2.1/", "https://192.0.2.1/assets/main.js",
                                      "https://192.0.2.1/assets/main.css"], [call[-2] for call in probes])

    def test_verified_failures_roll_back_without_touching_database(self):
        for failure in ("up_failed", "readiness_down", "gateway_404"):
            with self.subTest(failure=failure):
                result, commands = self.run_preflight(failure=failure, args=["--release", "--rollback-safe"])
                self.assertNotEqual(0, result.returncode)
                self.assertIn("已回退并验证上一版", result.stderr)
                self.assertEqual("rolled-back", self.receipt["state"])
                self.assertIsNone(self.pending)
                self.assertIn("APP_IMAGE=old-app", self.final_env)
                updates = [call for call in commands if "up" in call or "stop" in call]
                expected = [["app", "image-worker"]]
                if failure == "gateway_404":
                    expected.extend([["gateway"], ["app", "image-worker", "gateway"], ["app", "image-worker"], ["gateway"]])
                else:
                    expected.extend([["app", "image-worker"], ["app", "image-worker"]])
                self.assertEqual(len(expected), len(updates))
                for services, call in zip(expected, updates):
                    self.assertEqual(services, call[-len(services):])
                self.assertIn("--no-deps", updates[-1])

    def test_unsafe_or_failed_rollback_requires_manual_recovery(self):
        for failure in ("migration_changed", "history_changed", "rollback_failed", "interrupted"):
            with self.subTest(failure=failure):
                result, commands = self.run_preflight(failure=failure, args=["--release", "--rollback-safe"])
                self.assertNotEqual(0, result.returncode)
                self.assertIn("APP_IMAGE=old-app", self.final_env)
                self.assertIsNotNone(self.pending)
                self.assertEqual(2 * int(failure != "interrupted") + int(failure == "rollback_failed"),
                                 sum("up" in call for call in commands))
                self.assertIsNone(self.receipt)

    def run_preflight(self, failure="", pitr=False, args=(), *, baseline_protocol="2",
                      candidate_protocol="2", candidate_web_protocol="2", recover=None):
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory).resolve()
            shutil.copy(SCRIPT, work)
            mount = work / "backup-disk"
            repo = mount / "pitr"
            repo.mkdir(parents=True)
            settings = work / "pgbackrest-ip.conf"
            settings.touch()
            dist = work / "dist"
            (dist / "assets").mkdir(parents=True)
            for error, path, body in (
                    ("missing_index", "index.html", '<script type="module" src="/assets/main.js"></script>'
                     '<link rel="stylesheet" href="/assets/main.css">'),
                    ("missing_entry", "assets/main.js", "export {};"),
                    ("missing_style", "assets/main.css", "body {}")):
                if error != failure:
                    (dist / path).write_text(body)
            candidate = work / "candidate-dir"
            shutil.copytree(dist, candidate / "dist")
            baseline_web_protocol = "3" if failure == "baseline_web_protocol_mismatch" else baseline_protocol
            for root, protocol in ((dist, baseline_web_protocol), (candidate / "dist", candidate_web_protocol)):
                index = root / "index.html"
                if protocol is not None and index.exists():
                    index.write_text(f'<meta name="wuhou-order-submission-protocol" content="{protocol}">' + index.read_text())
            (work / ".env").write_text(f"APP_IMAGE=old-app\nRELEASE_DIR={work}\n")
            if failure == "interrupted":
                (work / "maintenance").mkdir()
                (work / "maintenance/release-pending.json").write_text('{"state":"switching"}')
            for reference, protocol in ((OLD, baseline_protocol), (NEW, candidate_protocol)):
                with zipfile.ZipFile(work / (reference[-1] + ".jar"), "w") as jar:
                    jar.writestr("BOOT-INF/classes/db/migration/V1__test.sql",
                                 "SELECT 2" if failure == "migration_changed" and reference == NEW else "SELECT 1")
                    if protocol is not None:
                        module = BytesIO()
                        with zipfile.ZipFile(module, "w") as order:
                            order.writestr("order/submission-protocol.txt", protocol + "\n")
                        jar.writestr("BOOT-INF/lib/WuhouCake-order-test.jar", module.getvalue())
            if args and args[0] == "--release":
                args = ["--release", "new-app", str(candidate), *args[1:]]
            environment = {
                "APP_IMAGE": "old-app", "RELEASE_DIR": str(work),
                "DEPLOY_POSTGRES_PROJECT": PROJECT,
                "DEPLOY_POSTGRES_VOLUME": VOLUME,
                "DEPLOY_POSTGRES_SYSTEM_IDENTIFIER": IDENTIFIER,
            }
            mounts = [{"type": "volume", "source": "postgres-data", "target": PGDATA}]
            postgres = {"image": "postgres:17-bookworm", "volumes": mounts}
            existing_mounts = [{"Destination": PGDATA, "Name": "wrong" if failure == "wrong_running_volume" else VOLUME}]
            if pitr or failure == "missing_overlay":
                existing_mounts.append({"Destination": "/var/lib/pgbackrest"})
            if pitr:
                environment.update(PITR_REPO_DIR=str(repo), PITR_REPO_MOUNT=str(mount), PITR_REPO_FS_UUID="disk-uuid")
                postgres.update(image="wuhou-postgres-pitr:17", command=[
                    "postgres", "-c", "archive_mode=on", "-c", "archive_timeout=120s",
                    "-c", "archive_command=pgbackrest --stanza=wuhou archive-push %p",
                ])
                mounts.extend([
                    {"type": "bind", "source": str(repo), "target": "/var/lib/pgbackrest", "bind": {"create_host_path": False}},
                    {"type": "bind", "source": str(settings), "target": "/etc/pgbackrest/pgbackrest.conf", "read_only": True},
                ])
            fixture = {
                "environment": environment, "failure": failure,
                "candidate": str(candidate),
                "old": OLD, "new": NEW,
                "model": {"name": "wrong" if failure == "wrong_project" else PROJECT,
                          "services": {"postgres": postgres, "app": {"image": OLD}, "image-worker": {"image": OLD}, "gateway": {
                              "environment": {"PUBLIC_IP": "192.0.2.1"},
                              "volumes": [{"type": "bind", "source": str(dist), "target": "/srv", "read_only": True}],
                              "ports": [{"target": 443, "published": "8443", "protocol": "tcp"}],
                          }},
                          "volumes": {"postgres-data": {"name": "wrong" if failure == "wrong_volume" else VOLUME, "external": True}}},
                "running": [
                    {"Id": "container-" + name, "Image": image, "State": {"Running": True}, "Mounts": mounts,
                     "Config": {"Labels": {"com.docker.compose.service": name, "com.docker.compose.config-hash": name}}}
                    for name, image, mounts in [
                        ("app", OLD, []), ("image-worker", OLD, []),
                        ("gateway", NEW, [{"Destination": "/srv", "Source": str(dist), "RW": False}])]
                ],
                "existing": [{"Image": "sha256:local-image", "Mounts": existing_mounts}],
                "cluster": "18" if failure == "empty_database" else "17",
                "identifier": "123" if failure == "wrong_cluster" else IDENTIFIER,
                "filesystem": {"filesystems": [{
                    "target": "/" if failure == "unmounted" else str(mount),
                    "uuid": "other-disk" if failure == "wrong_disk" else "disk-uuid",
                    "options": "ro" if failure == "read_only" else "rw,relatime",
                    "fsroot": "/",
                }]},
            }
            (work / "fixture.json").write_text(json.dumps(fixture))
            backup = work / "backup-ip-database.sh"
            backup.write_text("""#!/usr/bin/env python3
import json
import sys
from pathlib import Path
with Path("commands.jsonl").open("a") as log:
    log.write(json.dumps(["backup", *sys.argv[1:]]) + "\\n")
sys.exit(json.loads(Path("fixture.json").read_text())["failure"] == "backup_failed")
""")
            backup.chmod(0o700)
            docker = work / "docker"
            docker.write_text(r"""#!/usr/bin/env python3
import json
import sys
from pathlib import Path
args = sys.argv[1:]
fixture = json.loads(Path("fixture.json").read_text())
with Path("commands.jsonl").open("a") as log:
    log.write(json.dumps(args) + "\n")
is_candidate = any(".release-" in arg for arg in args)
former = [json.loads(line) for line in Path("commands.jsonl").read_text().splitlines()[:-1]]
switched = any("up" in call for call in former)
failure = fixture["failure"]
if "config" in args:
    if "--environment" in args:
        for name, value in fixture["environment"].items():
            print(f"{name}={value}")
    elif "--hash=*" in args:
        print("app changed\nimage-worker image-worker\ngateway gateway" if failure == "config_hash_changed"
              else "app app\nimage-worker image-worker\ngateway gateway")
    else:
        model = fixture["model"]
        if is_candidate:
            model["services"]["gateway"]["volumes"][0]["source"] = fixture["candidate"] + "/dist"
            for service in ("app", "image-worker"):
                model["services"][service]["image"] = fixture["new"]
        print(json.dumps(model))
elif args[:2] == ["volume", "inspect"]:
    sys.exit(failure == "missing_volume")
elif args[:2] == ["image", "inspect"]:
    print(fixture["old"] if args[-1] == "old-app" and failure != "wrong_image" else fixture["new"])
elif args[0] == "ps":
    print("existing-postgres")
elif args[0] == "inspect":
    rows = fixture["existing"] if args[1] == "existing-postgres" else fixture["running"]
    if args[1:] == ["existing-gateway"]:
        rows = [rows[-1]]
    print(json.dumps(rows))
elif args[0] == "run":
    if "cat" in args and "/app/application.jar" in args:
        sys.stdout.buffer.write(Path(args[-2][-1] + ".jar").read_bytes())
    else:
        if failure == "empty_database":
            sys.exit(1)
        print(fixture["cluster"])
        print("Database system identifier: " + fixture["identifier"])
elif "ps" in args:
    print("existing-gateway" if args[-2:] == ["-q", "gateway"] else "existing-app existing-worker existing-gateway")
elif "exec" in args:
    if "psql" in args:
        history_changed = failure == "schema_changed" or switched and failure in ("history_changed", "history_changed_before_gateway")
        print(json.dumps([fixture["identifier"], [{"success": True, "version": 2 if history_changed else 1}]]))
    else:
        if switched and failure == "readiness_missing":
            sys.exit(1)
        if switched and is_candidate and failure == "config_changed_before_gateway":
            with Path(".env").open("a") as env:
                env.write("UPDATED=1\n")
        readiness_down = failure in ("readiness_down", "history_changed_before_gateway", "config_changed_before_gateway")
        down = failure == "recovery_unready" or switched and readiness_down and (is_candidate or not any(".release-" in str(c) for c in former))
        print(json.dumps({"status": "DOWN" if down else "UP"}))
elif "up" in args:
    if is_candidate and failure == "up_failed" or not is_candidate and failure == "rollback_failed":
        sys.exit(1)
elif "stop" not in args:
    sys.exit(2)
""")
            findmnt = work / "findmnt"
            findmnt.write_text("""#!/usr/bin/env python3
import json
from pathlib import Path
print(json.dumps(json.loads(Path("fixture.json").read_text())["filesystem"]))
""")
            curl = work / "curl"
            curl.write_text(r"""#!/usr/bin/env python3
import json
import sys
from pathlib import Path
from urllib.parse import urlsplit
args = sys.argv[1:]
commands = [json.loads(line) for line in Path("commands.jsonl").read_text().splitlines()]
updates = [call for call in commands if "up" in call and call[-1] == "gateway"]
candidate = bool(updates and any(".release-" in entry for entry in updates[-1]))
with Path("commands.jsonl").open("a") as log:
    log.write(json.dumps(["curl", *args, *(["candidate-dir"] if candidate else [])]) + "\n")
failure = json.loads(Path("fixture.json").read_text())["failure"] if candidate else ""
path = urlsplit(args[-1]).path.lstrip("/")
if failure in ("gateway_404", "migration_changed", "history_changed", "rollback_failed"):
    sys.exit(22)
dist = Path("candidate-dir/dist" if candidate else "dist")
index = (dist / "index.html").read_bytes()
body = index if not path else (dist / path).read_bytes()
media = "text/html" if not path else "text/javascript" if path.endswith(".js") else "text/css"
if path.endswith(".js") and failure == "entry_returns_html":
    body, media = index, "text/html"
if not path and failure == "stale_home":
    body += b"old"
if not path and failure == "wrong_media":
    media = "text/plain"
sys.stdout.buffer.write(body + ("\n200 " + media).encode())
""")
            for command in (docker, findmnt, curl):
                command.chmod(0o700)
            def invoke(arguments):
                return subprocess.run(["sh", str(work / SCRIPT.name), *arguments], capture_output=True, text=True,
                                      env=os.environ | {"PATH": f"{work}{os.pathsep}{os.environ['PATH']}"}, timeout=25)

            result = invoke(args)
            log = work / "commands.jsonl"
            offset = 0
            if recover is not None:
                self.assertNotEqual(0, result.returncode, result.stdout)
                pending = work / "maintenance/release-pending.json"
                metadata = json.loads(pending.read_text())
                self.assertIn("legacyRecovery", metadata)
                fixture["failure"] = recover
                if recover == "missing":
                    pending.unlink()
                elif recover == "evidence_missing":
                    del metadata["legacyRecovery"]
                elif recover == "unknown_phase":
                    del metadata["gatewaySwitchStarted"]
                elif recover == "gateway_switched":
                    metadata["gatewaySwitchStarted"] = True
                elif recover == "gateway_replaced":
                    fixture["running"][-1]["Id"] = "replaced-gateway"
                elif recover == "wrong_frontend":
                    (dist / "assets/main.js").write_text("export const other = true;")
                elif recover == "env_changed":
                    with (work / ".env").open("a") as config:
                        config.write("UPDATED=1\n")
                if pending.exists():
                    pending.write_text(json.dumps(metadata))
                (work / "fixture.json").write_text(json.dumps(fixture))
                offset = len(log.read_text().splitlines())
                result = invoke(["--recover-previous"])
            self.final_env = (work / ".env").read_text()
            def release_record(name):
                path = work / "maintenance" / f"release-{name}.json"
                return json.loads(path.read_text()) if path.exists() else None
            self.pending = release_record("pending")
            self.receipt = release_record("last")
            return result, [json.loads(line) for line in log.read_text().splitlines()[offset:]] if log.exists() else []


if __name__ == "__main__":
    unittest.main()
