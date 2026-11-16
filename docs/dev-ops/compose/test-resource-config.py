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
    "APP_TEMP_DIR": "/synthetic/scratch", "RELEASE_DIR": "/synthetic/release",
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
        path.write_text("".join(f"{key}={value}\n" for key, value in (FIXTURE | values).items()))
        env = {key: os.environ[key] for key in ("PATH", "HOME") if key in os.environ}
        command = ["docker", "compose", "--env-file", str(path)]
        for file in files:
            command += ["-f", str(COMPOSE / f"docker-compose-{file}.yml")]
        subprocess.run(command + ["config", "--quiet"], env=env, check=True)
        config = subprocess.check_output(command + ["config", "--format", "json"], env=env)
        return json.loads(config)["services"]


class ResourceContract(unittest.TestCase):
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

    def test_production_app_mounts_dedicated_scratch_and_stays_off_public_interfaces(self):
        for services in (resolve("app"), resolve("ip")):
            app = services["app"]
            target = app["environment"]["APP_TEMP_DIR"]
            self.assertEqual(target, app["environment"]["SPRING_SERVLET_MULTIPART_LOCATION"])
            volume = next(volume for volume in app["volumes"] if volume["target"] == target)
            self.assertEqual("/synthetic/scratch", volume["source"])
            self.assertEqual("bind", volume["type"])
            self.assertFalse(volume["bind"]["create_host_path"])
            self.assertEqual("127.0.0.1", app["ports"][0]["host_ip"])

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
