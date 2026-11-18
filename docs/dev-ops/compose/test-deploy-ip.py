"""Exercise deploy preflight with synthetic Docker and mount metadata."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("deploy-ip.sh")
PGDATA = "/var/lib/postgresql/data"
PROJECT = "wuhou-ip"
VOLUME = "wuhou-ip_postgres-data"
IDENTIFIER = "7123456789012345678"


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
                self.assertEqual(["compose", "--env-file", ".env", "up", "-d", "--wait"]
                                 + (["postgres"] if args else []), commands[-1 if args else -2])
                self.assertEqual(not args, any("exec" in call for call in commands))

    def test_release_requires_dependency_readiness(self):
        for failure in ("readiness_down", "readiness_missing"):
            with self.subTest(failure=failure):
                result, commands = self.run_preflight(failure=failure)
                self.assertNotEqual(0, result.returncode, result.stdout)
                self.assertIn("未通过 readiness", result.stderr)
                self.assertIn("up", commands[-2])
                self.assertIn("exec", commands[-1])

    def run_preflight(self, failure="", pitr=False, args=()):
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory).resolve()
            shutil.copy(SCRIPT, work)
            mount = work / "backup-disk"
            repo = mount / "pitr"
            repo.mkdir(parents=True)
            settings = work / "pgbackrest-ip.conf"
            settings.touch()
            environment = {
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
                "model": {"name": "wrong" if failure == "wrong_project" else PROJECT, "services": {"postgres": postgres},
                          "volumes": {"postgres-data": {"name": "wrong" if failure == "wrong_volume" else VOLUME, "external": True}}},
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
            docker = work / "docker"
            docker.write_text(r"""#!/usr/bin/env python3
import json
import sys
from pathlib import Path
args = sys.argv[1:]
fixture = json.loads(Path("fixture.json").read_text())
with Path("commands.jsonl").open("a") as log:
    log.write(json.dumps(args) + "\n")
if "config" in args:
    if "--environment" in args:
        for name, value in fixture["environment"].items():
            print(f"{name}={value}")
    else:
        print(json.dumps(fixture["model"]))
elif args[:2] == ["volume", "inspect"]:
    sys.exit(fixture["failure"] == "missing_volume")
elif args[0] == "ps":
    print("existing-postgres")
elif args[0] == "inspect":
    print(json.dumps(fixture["existing"]))
elif args[0] == "run":
    if fixture["failure"] == "empty_database":
        sys.exit(1)
    print(fixture["cluster"])
    print("Database system identifier: " + fixture["identifier"])
elif "exec" in args:
    if fixture["failure"] == "readiness_missing":
        sys.exit(1)
    print(json.dumps({"status": "DOWN" if fixture["failure"] == "readiness_down" else "UP"}))
elif "up" not in args:
    sys.exit(2)
""")
            findmnt = work / "findmnt"
            findmnt.write_text("""#!/usr/bin/env python3
import json
from pathlib import Path
print(json.dumps(json.loads(Path("fixture.json").read_text())["filesystem"]))
""")
            for command in (docker, findmnt):
                command.chmod(0o700)
            result = subprocess.run(["sh", str(work / SCRIPT.name), *args], capture_output=True, text=True,
                                    env=os.environ | {"PATH": f"{work}{os.pathsep}{os.environ['PATH']}"}, timeout=8)
            return result, [json.loads(line) for line in (work / "commands.jsonl").read_text().splitlines()]


if __name__ == "__main__":
    unittest.main()
