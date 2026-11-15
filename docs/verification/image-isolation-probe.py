#!/usr/bin/env python3
"""仅对回环地址的专用测试实例验收七图提交、同键重放及读取延迟。"""
import argparse
import concurrent.futures
import http.cookiejar
import http.client
import json
import os
from pathlib import Path
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', default='http://127.0.0.1:18080')
    parser.add_argument('--images', required=True)
    parser.add_argument('--seconds', type=int, default=1800)
    parser.add_argument('--output', required=True)
    parser.add_argument('--pause-worker', default='')
    args = parser.parse_args()
    if urllib.parse.urlparse(args.base).scheme != 'http' or urllib.parse.urlparse(args.base).hostname not in ('127.0.0.1', 'localhost'):
        parser.error('Only a dedicated loopback test instance is allowed')
    if args.pause_worker and not args.pause_worker.startswith('wuhou-image-soak-'):
        parser.error('Fault injection is limited to wuhou-image-soak containers')
    pictures = [(p.name, p.read_bytes()) for p in sorted(Path(args.images).glob('phone-*.jpg'))]
    assert len(pictures) == 7 and all(len(data) <= 5 * 1024 * 1024 for _, data in pictures)
    cookies = http.cookiejar.CookieJar()
    auth = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookies))
    token = ''
    stop = threading.Event()
    readings, failures, uploads = [], [], []

    def request(method, path, body=None, headers=None, opener=None):
        data = body if isinstance(body, bytes) else None if body is None else json.dumps(body).encode()
        fields = {'Authorization': 'Bearer ' + token} if token else {}
        if body is not None and not isinstance(body, bytes): fields['Content-Type'] = 'application/json'
        fields.update(headers or {})
        req = urllib.request.Request(args.base + path, data=data, headers=fields, method=method)
        started = time.monotonic()
        try:
            if isinstance(body, bytes):
                address = urllib.parse.urlparse(args.base)
                connection = http.client.HTTPConnection(address.hostname, address.port, timeout=65)
                try:
                    try: connection.request(method, path, body=body, headers=fields)
                    except (BrokenPipeError, ConnectionResetError): pass  # 服务器可在上传正文完成前拒绝过载请求。
                    response = connection.getresponse(); status = response.status; value = json.load(response)
                finally: connection.close()
            else:
                open_request = opener.open if opener else urllib.request.urlopen
                with open_request(req, timeout=65) as response:
                    value = json.load(response); status = response.status
        except urllib.error.HTTPError as failure:
            status = failure.code; value = json.load(failure)
        return status, value, time.monotonic() - started

    def authenticate(path, body=None):
        status, data, _ = request('GET', '/api/auth/csrf', opener=auth)
        assert status == 200
        csrf = next(cookie.value for cookie in cookies if cookie.name == 'XSRF-TOKEN')
        return request('POST', '/api/auth/' + path, body, {data['data']['headerName']: urllib.parse.unquote(csrf)}, auth)

    password = os.environ.get('WUHOU_IMAGE_TEST_PASSWORD', 'Synthetic-permanent-pass-2026!')
    initial = os.environ.get('WUHOU_IMAGE_TEST_INITIAL_PASSWORD', 'Synthetic-initial-pass-2026!')
    status, data, _ = authenticate('login', {'employeeNumber': 'SOAK', 'password': password})
    if status != 200:
        status, data, _ = authenticate('login', {'employeeNumber': 'SOAK', 'password': initial})
        assert status == 200, (status, data.get('code'))
        token = data['data']['accessToken']
        assert request('POST', '/api/me/password', {'currentPassword': initial, 'newPassword': password})[0] == 200
        status, data, _ = authenticate('login', {'employeeNumber': 'SOAK', 'password': password})
    assert status == 200
    token = data['data']['accessToken']

    def probe():
        while not stop.is_set():
            for path in ('/api/auth/csrf', '/api/me', '/api/order-packages'):
                try:
                    status, _, elapsed = request('GET', path)
                    readings.append(elapsed)
                    if status != 200: failures.append({'path': path, 'status': status})
                except Exception as failure: failures.append({'path': path, 'error': type(failure).__name__})
            stop.wait(1)

    def package():
        key = str(uuid.uuid4()); boundary = 'wuhou-' + key
        items = [{'itemId': str(uuid.uuid4()), 'imageId': str(uuid.uuid4()), 'name': '商品' + str(i), 'productType': 'OTHER', 'quantity': 1, 'unitPriceCents': 1000} for i in range(7)]
        manifest = {'name': '资源验收-' + key, 'items': items}
        parts = [f'--{boundary}\r\nContent-Disposition: form-data; name="package"; filename="manifest.json"\r\nContent-Type: application/json\r\n\r\n'.encode(), json.dumps(manifest).encode()]
        for item, (name, content) in zip(items, pictures):
            parts.extend([f'\r\n--{boundary}\r\nContent-Disposition: form-data; name="{item["imageId"]}"; filename="{name}"\r\nContent-Type: image/jpeg\r\n\r\n'.encode(), content])
        parts.append(f'\r\n--{boundary}--\r\n'.encode())
        return b''.join(parts), {'Idempotency-Key': key, 'Content-Type': 'multipart/form-data; boundary=' + boundary}

    def upload(payload):
        started = time.monotonic()
        try: result = request('POST', '/api/order-packages', *payload)
        except (ConnectionError, urllib.error.URLError, http.client.HTTPException) as failure:
            result = (0, {'code': 'TRANSPORT_INTERRUPTED', 'error': type(failure).__name__}, time.monotonic() - started)
        uploads.append({'status': result[0], 'code': result[1].get('code'), 'seconds': round(result[2], 3)})
        return result, payload

    monitor = threading.Thread(target=probe, daemon=True); monitor.start()
    started = time.monotonic(); last_refresh = started
    completed, rejected, reconciled = 0, 0, 0
    report = {'fixture_count': 7, 'fixture_bytes': sum(len(content) for _, content in pictures), 'failures': failures}
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            while time.monotonic() - started < args.seconds:
                if time.monotonic() - last_refresh > 240:
                    status, data, _ = authenticate('refresh')
                    assert status == 200, ('refresh', status, data.get('code'))
                    token = data['data']['accessToken']; last_refresh = time.monotonic()
                futures = [pool.submit(upload, package()) for _ in range(3)]
                results = [future.result() for future in futures]
                for (status, data, elapsed), payload in results:
                    if status == 503 and data.get('code') == 'IMAGE_PROCESSING_BUSY': rejected += 1; continue
                    if status == 0:
                        status, data, elapsed = request('POST', '/api/order-packages', *payload)
                        reconciled += 1
                    assert status == 201, (status, data.get('code'), elapsed)
                    repeated = request('POST', '/api/order-packages', *payload)
                    assert repeated[0] == 201 and repeated[1]['data']['id'] == data['data']['id'], ('replay', repeated[0], repeated[1].get('code'))
                    assert request('DELETE', '/api/order-packages/' + data['data']['id'] + '?expectedVersion=0')[0] == 200
                    completed += 1
                if completed == 0: raise AssertionError('No package accepted')
                print(json.dumps({'completed_batches': completed, 'busy_rejections': rejected, 'reconciled_connections': reconciled, 'elapsed': round(time.monotonic() - started)}, ensure_ascii=False), flush=True)
                if args.pause_worker:
                    name, args.pause_worker = args.pause_worker, ''
                    subprocess.run(['docker', 'pause', name], check=True, stdout=subprocess.DEVNULL)
                    try:
                        status, value, elapsed = request('POST', '/api/order-packages', *package())
                        assert status == 503 and value.get('code') in ('IMAGE_PROCESSING_TIMEOUT', 'IMAGE_PROCESSING_UNAVAILABLE'), (status, value.get('code'))
                        report['worker_unavailable'] = {'status': status, 'code': value['code'], 'seconds': round(elapsed, 3)}
                    finally: subprocess.run(['docker', 'unpause', name], check=True, stdout=subprocess.DEVNULL)
                    time.sleep(12)
    finally:
        stop.set(); monitor.join(timeout=70)
        ordered = sorted(readings)
        report.update({'elapsed_seconds': round(time.monotonic() - started, 2), 'completed_batches': completed, 'busy_rejections': rejected, 'reconciled_connections': reconciled,
                       'read_count': len(readings), 'read_p95_seconds': ordered[min(len(ordered) - 1, int(len(ordered) * .95))] if ordered else None,
                       'read_max_seconds': max(readings, default=None), 'uploads': uploads})
        Path(args.output).write_text(json.dumps(report, ensure_ascii=False, indent=2))
    assert not failures, failures
    assert report['read_p95_seconds'] < 1 and report['read_max_seconds'] < 3, report


if __name__ == '__main__':
    main()
