"""Validate resolved Compose resource contracts with synthetic configuration."""
import json
import os
from pathlib import Path
import shlex
import subprocess
import tempfile
import unittest

COMPOSE = Path(__file__).resolve().parent
FIXTURE = {
    "POSTGRES_DB": "synthetic", "POSTGRES_USER": "synthetic",
    "POSTGRES_PASSWORD": "synthetic-db", "REDIS_PASSWORD": "synthetic-cache",
    "APP_IMAGE": "synthetic:local", "PUBLIC_IP": "192.0.2.10",
    "CUSTOMER_ENTRY_PUBLIC_ORIGIN": "https://192.0.2.10",
    "APP_UID": "10001", "APP_GID": "10001", "IDENTITY_KEY_DIR": "/synthetic/keys",
    "RELEASE_DIR": "/synthetic/release",
    "JAVA_TOOL_OPTIONS": "-Duser.timezone=Asia/Shanghai -Xmx900m",
    "JDK_JAVA_OPTIONS": "-Xss8m", "_JAVA_OPTIONS": "-Xmx900m",
}
MIB = 1024**2


def resolve(*files, development=False):
    with tempfile.TemporaryDirectory() as work:
        path = Path(work) / "compose.env"
        values = {}
        if development:
            for line in (COMPOSE.parent / "env/dev.env.example").read_text().splitlines():
                if line and not line.startswith("#") and "=" in line:
                    key, value = line.split("=", 1)
                    values[key] = value
        if "scratch" in files:
            values["APP_SCRATCH_HOST_DIR"] = "/synthetic/scratch"
        path.write_text("".join(f"{key}={value}\n" for key, value in (FIXTURE | values).items()))
        env = {key: os.environ[key] for key in ("PATH", "HOME") if key in os.environ}
        command = ["docker", "compose", "--env-file", str(path)]
        for file in files:
            command += ["-f", str(COMPOSE / f"docker-compose-{file}.yml")]
        subprocess.run(command + ["config", "--quiet"], env=env, check=True)
        config = subprocess.check_output(command + ["config", "--format", "json"], env=env)
        return json.loads(config)["services"]


class ResourceContract(unittest.TestCase):
    def test_app_entrypoint_prepares_local_scratch_for_disabled_mount(self):
        dockerfile = COMPOSE.parents[2] / "WuhouCake-bootstrap/Dockerfile"
        entrypoint = json.loads(next(line.removeprefix("ENTRYPOINT ") for line in dockerfile.read_text().splitlines()
                                     if line.startswith("ENTRYPOINT ")))
        with tempfile.TemporaryDirectory() as work:
            java = Path(work) / "java"
            java.write_text('#!/bin/sh\nprintf "%s\\n" "$1"\n')
            java.chmod(0o700)
            for index, value in enumerate((None, "false", "FALSE", "off", "0", " no ")):
                with self.subTest(value=value):
                    scratch = Path(work) / f"scratch-{index}"
                    shell, flags, script, arg0 = entrypoint
                    script = script.replace("/tmp/wuhoucake-app", shlex.quote(str(scratch)))
                    env = os.environ | {"PATH": f"{work}:{os.environ['PATH']}"}
                    env.pop("APP_SCRATCH_REQUIRE_MOUNT", None)
                    if value is not None:
                        env["APP_SCRATCH_REQUIRE_MOUNT"] = value
                    result = subprocess.check_output([shell, flags, script, arg0], env=env, text=True)
                    self.assertEqual(f"-Djava.io.tmpdir={scratch}", result.strip())
                    self.assertEqual(0o700, scratch.stat().st_mode & 0o777)

    def test_production_database_and_cache_budgets_agree(self):
        standard = resolve("environment")
        ip = resolve("ip")
        for name, memory in (("postgres", 256), ("redis", 96)):
            for config in (standard, ip):
                service = config[name]
                self.assertEqual(memory * MIB, int(service["mem_limit"]))
                self.assertGreater(float(service["cpus"]), 0)
                self.assertIn(int(service["pids_limit"]), range(16, 129))
            for setting in ("mem_limit", "cpus", "pids_limit"):
                self.assertEqual(standard[name][setting], ip[name][setting])
        for config in (standard, ip):
            self.assertIn("max_connections=24", config["postgres"]["command"])
            self.assertIn("shared_buffers=64MB", config["postgres"]["command"])
            self.assertIn("work_mem=2MB", config["postgres"]["command"])
            self.assertIn("temp_file_limit=64MB", config["postgres"]["command"])
            cache = config["redis"]
            for argument in ("--appendonly", "yes", "--maxmemory", "32mb", "noeviction"):
                self.assertIn(argument, cache["command"])
            self.assertTrue(any(v["source"] == "redis-data" and v["target"] == "/data"
                                for v in cache["volumes"]))
        steady = sum(int(config["mem_limit"]) for name, config in ip.items() if name != "certbot")
        self.assertLessEqual(steady, 0.85 * 1.6 * 1024 * MIB)

    def test_development_has_separate_budgets_and_loopback_ports(self):
        for example in (False, True):
            services = resolve("environment", "environment-dev", development=example)
            for name, production in (("postgres", 256), ("redis", 96)):
                self.assertGreater(int(services[name]["mem_limit"]), production * MIB)
                self.assertEqual("127.0.0.1", services[name]["ports"][0]["host_ip"])
            self.assertIn("max_connections=40", services["postgres"]["command"])

    def test_production_app_has_optional_scratch_mount_and_stays_off_public_interfaces(self):
        target = "/tmp/wuhoucake-app"
        for base in ("app", "ip"):
            with self.subTest(base=base):
                app = resolve(base)["app"]
                self.assertNotIn(target, [volume["target"] for volume in app["volumes"]])
                self.assertNotIn("APP_SCRATCH_REQUIRE_MOUNT", app["environment"])
                self.assertEqual("127.0.0.1", app["ports"][0]["host_ip"])
            mounted = resolve(base, "scratch")["app"]
            self.assertEqual("true", mounted["environment"]["APP_SCRATCH_REQUIRE_MOUNT"])
            volume = next(volume for volume in mounted["volumes"] if volume["target"] == target)
            self.assertEqual("/synthetic/scratch", volume["source"])
            self.assertEqual("bind", volume["type"])
            self.assertFalse(volume["bind"]["create_host_path"])

    def test_ip_app_only_mounts_the_status_summary(self):
        services = resolve("ip")
        app = services["app"]
        target = "/run/wuhou-server-status"
        status = next(mount for mount in app["volumes"] if mount["target"] == target)
        self.assertTrue(status["read_only"])
        self.assertFalse(status["bind"]["create_host_path"])
        self.assertTrue(status["source"].endswith("/maintenance/server-status"))
        self.assertEqual(target + "/status.json", app["environment"]["WUHOU_SERVER_STATUS_FILE"])
        self.assertNotIn(target, [mount["target"] for mount in services["image-worker"].get("volumes", [])])

    def test_compose_does_not_accept_inherited_jvm_overrides(self):
        for services in (resolve("app"), resolve("ip")):
            app = services["app"]["environment"]
            options = shlex.split(app["JAVA_TOOL_OPTIONS"])
            for required in ("-Xmx256m", "-XX:MaxMetaspaceSize=136m",
                             "-XX:MaxDirectMemorySize=24m", "-XX:ReservedCodeCacheSize=48m",
                             "-Xss512k", "-XX:ActiveProcessorCount=2"):
                self.assertIn(required, options)
            self.assertNotIn("-Xmx900m", options)
            worker = services["image-worker"]
            self.assertIn("-Xmx24m", worker["entrypoint"])
            for name in ("JDK_JAVA_OPTIONS", "_JAVA_OPTIONS"):
                self.assertFalse(app.get(name))
                self.assertFalse((worker.get("environment") or {}).get(name))
            self.assertFalse((worker.get("environment") or {}).get("JAVA_TOOL_OPTIONS"))


if __name__ == "__main__":
    unittest.main()
