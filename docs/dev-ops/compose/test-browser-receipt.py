"""Exercise browser recovery using a real receipt and isolated services."""

import argparse
import os
from pathlib import Path
import runpy
import socket
import subprocess
import tempfile
import time
import urllib.request
import uuid

HERE = Path(__file__).resolve().parent
FRONTEND = HERE.parents[2] / "frontend"
FOCUSED = ("客户填单校验失败后可修改|浏览器存储不可用|响应丢失后重载|录单响应体挂起|"
           "跨标签页同时退出保存|七张套餐图片保存响应丢失|套餐上传结果未知")


def browser_checks(backend, work, token):
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    base = f"http://127.0.0.1:{port}"
    env = os.environ | {"API_PROXY_TARGET": backend, "DRAFT_TEST_URL": base,
                        "WUHOU_TEST_ENTRY_TOKEN": token, "WUHOU_TEST_RECEIPT_FILE": str(work / "receipt")}
    with (work / "vite.log").open("w+") as log:
        vite = subprocess.Popen(["node", "node_modules/vite/bin/vite.js", "--host", "127.0.0.1",
                                 "--port", str(port), "--strictPort"], cwd=FRONTEND, env=env, stdout=log, stderr=log)
        try:
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline and vite.poll() is None:
                try:
                    with urllib.request.urlopen(base, timeout=2) as response:
                        if response.status == 200:
                            break
                except OSError:
                    time.sleep(0.2)
            else:
                log.seek(0)
                raise RuntimeError(log.read())
            subprocess.run(["node", "--test", "--test-concurrency=1", "tests/accessRevocation.browser.mjs", "tests/publicOrderReceipt.real.browser.mjs"],
                           cwd=FRONTEND, env=env, check=True, timeout=240)
            subprocess.run(["node", "--test", "--test-concurrency=1", f"--test-name-pattern={FOCUSED}", "tests/publicOrderRetry.browser.mjs",
                            "tests/orderDraft.browser.mjs", "tests/packageRecovery.browser.mjs"],
                           cwd=FRONTEND, env=env, check=True, timeout=240)
        finally:
            if vite.poll() is None:
                vite.terminate()
                try:
                    vite.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    vite.kill()
                    vite.wait()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--jar", type=Path, required=True)
    args = parser.parse_args()
    fixtures = runpy.run_path(str(HERE / "test-restore-ip.py"))
    with tempfile.TemporaryDirectory(prefix="wuhou-browser-") as directory:
        work = Path(directory)
        services = fixtures["Environment"](work, args.jar.resolve(strict=True), None)
        try:
            services.up("postgres", "redis")
            services.initialize()
            with services.application("postgres") as backend:
                client = fixtures["session"](backend, initial=True)
                entry = fixtures["json_call"](client, "POST", "/api/customer-submissions/entry", {"action": "CREATE"})
                browser_checks(backend, work, entry["url"].split("/fill/")[1])
            receipt = str(uuid.UUID((work / "receipt").read_text()))
            assert services.sql("postgres", "SELECT id::text FROM customer_order_submission") == receipt
            assert services.sql("postgres", "SELECT type FROM customer_submission_activity") == "SUBMITTED"
            print("Real browser receipt matched one database submission and one activity", flush=True)
        finally:
            services.docker("down", "--volumes", "--remove-orphans")


if __name__ == "__main__":
    main()
