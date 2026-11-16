#!/usr/bin/env python3
"""Run a disposable Worker with the resource configuration from production Compose."""
import argparse
import concurrent.futures
from contextlib import ExitStack
import http.client
import json
import os
from pathlib import Path
import socket
import struct
import subprocess
import tempfile
import time
import uuid
import zipfile
import zlib


def docker(*args, **kwargs):
    return subprocess.check_output(["docker", *args], text=True, **kwargs).strip()


def png(width, height, depth):
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data))

    compressor = zlib.compressobj()
    pixel = b"\x12\x53\x32\x7f" if depth == 8 else b"\x12\x34\x53\x21\x32\x55\x7f\x01"
    row = b"\0" + pixel * width
    data = b"".join(compressor.compress(row) for _ in range(height)) + compressor.flush()
    header = struct.pack(">IIBBBBB", width, height, depth, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", data) + chunk(b"IEND", b"")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("jar", type=Path)
    parser.add_argument("--base-image", default="eclipse-temurin:21-jre-alpine")
    args = parser.parse_args()
    env = os.environ | dict(APP_IMAGE="probe", POSTGRES_DB="probe", POSTGRES_USER="probe",
                            POSTGRES_PASSWORD="probe", REDIS_PASSWORD="probe", IDENTITY_KEY_DIR="/tmp/probe",
                            CUSTOMER_ENTRY_PUBLIC_ORIGIN="https://example.test")
    compose = Path(__file__).resolve().parents[1] / "dev-ops/compose/docker-compose-app.yml"
    worker = json.loads(docker("compose", "-f", str(compose), "config", "--format", "json", env=env))["services"]["image-worker"]
    name = "wuhou-worker-probe-" + uuid.uuid4().hex[:8]

    def request(path, payload=None, timeout=17):
        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=timeout)
        try:
            connection.request("GET" if payload is None else "POST", path, body=payload)
            response = connection.getresponse()
            data = response.read(6 * 1024 * 1024)
            return response.status, data
        finally:
            connection.close()

    def wait_for(predicate):
        end = time.monotonic() + 15
        while time.monotonic() < end:
            try:
                if predicate():
                    return
            except (OSError, http.client.HTTPException):
                pass
            time.sleep(0.1)
        raise AssertionError("Worker readiness or processing state timed out")

    def process(image):
        filename = b"cake.png"
        payload = struct.pack(">IH", 1, len(filename)) + filename + struct.pack(">I", len(image)) + image
        status, result = request("/process", payload)
        failure_size, = struct.unpack(">H", result[4:6])
        return status, result[6:6 + failure_size]

    with tempfile.TemporaryDirectory() as tmp:
        folder = Path(tmp)
        folder.chmod(0o755)
        with zipfile.ZipFile(args.jar) as jar:
            for entry in jar.namelist():
                filename = Path(entry).name
                if filename.startswith(("WuhouCake-order-", "thumbnailator-")) and filename.endswith(".jar"):
                    (folder / filename).write_bytes(jar.read(entry))
        command = worker["entrypoint"]
        docker("run", "-d", "--name", name, "--pull=never", "--init", "--read-only", "--tmpfs", worker["tmpfs"][0],
               "--memory", str(worker["mem_limit"]), "--cpus", str(worker["cpus"]), "--pids-limit", str(worker["pids_limit"]),
               "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", "--user", "10001:10001",
               "--publish", "127.0.0.1::8091", "--mount", f"type=bind,src={folder},dst=/app/image-worker,readonly",
               "--entrypoint", command[0], args.base_image, *command[1:])
        try:
            port = int(docker("port", name, "8091/tcp").rsplit(":", 1)[1])
            wait_for(lambda: request("/health")[0] == 200)
            small = png(24, 12, 8)
            for width, height, depth in [(24, 12, 8), (6000, 4000, 8), (3838, 3838, 16), (1920, 1920, 16)]:
                assert process(png(width, height, depth)) == (200, b""), (width, height, depth)
            peak = int(docker("exec", name, "cat", "/sys/fs/cgroup/memory.peak"))
            events = dict(item.split() for item in docker("exec", name, "cat", "/sys/fs/cgroup/memory.events").splitlines())
            assert peak < int(worker["mem_limit"]) and events["oom_kill"] == "0", (peak, events)
            docker("exec", name, "dd", "if=/dev/zero", "of=/tmp/fill", "bs=1M", "count=16", stderr=subprocess.DEVNULL)
            assert process(small) == (503, b"IMAGE_PROCESSING_UNAVAILABLE")
            docker("exec", name, "rm", "/tmp/fill")
            assert process(small) == (200, b"")

            with socket.create_connection(("127.0.0.1", port), timeout=2) as slow:
                partial = b"POST /process HTTP/1.1\r\nHost: localhost\r\nContent-Length: 200\r\n\r\nx"
                slow.sendall(partial)
                wait_for(lambda: b"wuhou_image_worker_active 1\n" in request("/metrics")[1])
                with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
                    assert list(pool.map(process, [small] * 3)) == [(503, b"IMAGE_PROCESSING_BUSY")] * 3
                with ExitStack() as peers:
                    for _ in range(8):
                        peer = peers.enter_context(socket.create_connection(("127.0.0.1", port), timeout=2))
                        peer.sendall(partial)
                    try:
                        request("/health", timeout=0.75)
                    except (OSError, http.client.HTTPException):
                        pass
                    else:
                        raise AssertionError("Slow requests did not saturate the worker's request queue")
                docker("restart", "-t", "0", name)
                try:
                    assert slow.recv(1) == b""
                except ConnectionResetError:
                    pass
            port = int(docker("port", name, "8091/tcp").rsplit(":", 1)[1])
            wait_for(lambda: request("/health")[0] == 200)
            assert process(small) == (200, b"")
            print(json.dumps({"peak_bytes": peak, "events": events, "image_cases": 4, "fast_rejections": 3,
                              "full_tmpfs_recovery": True, "request_queue_saturated": True, "restart_during_upload_recovery": True}))
        except BaseException:
            print(docker("logs", "--tail", "30", name))
            raise
        finally:
            docker("rm", "-f", name)


if __name__ == "__main__":
    main()
