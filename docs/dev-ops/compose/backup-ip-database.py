"""Run and monitor the IP deployment's local PostgreSQL backups."""

import argparse
from contextlib import contextmanager
from datetime import datetime, time, timedelta, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import shutil
import signal
import stat
import subprocess
import tempfile
from time import monotonic
from zoneinfo import ZoneInfo

BACKUPS = Path("backups")
MAINTENANCE = Path("maintenance")
STATUS = MAINTENANCE / "server-status" / "status.json"
COMPOSE = ("docker", "compose", "--env-file", ".env", "exec", "-T", "postgres")
GIB = 1024 ** 3
RESERVE = 2 * GIB
KINDS = ("daily", "predeploy")
NAME = re.compile(r"[0-9]{8}T[0-9]{12}Z")
SHOP_TIME = ZoneInfo("Asia/Shanghai")
INTEGRITY_MAX_AGE = timedelta(hours=26)


class BackupFailure(Exception):
    pass


def now():
    return datetime.now(timezone.utc)


def timestamp(value):
    return value.isoformat(timespec="seconds").replace("+00:00", "Z")


def private_directory(path):
    path.mkdir(mode=0o700, parents=True, exist_ok=True)


def log(message, priority="notice"):
    print(message, flush=True)
    try:
        subprocess.run(("logger", "-t", "wuhou-backup", "-p", "user." + priority, "--", message),
                       stdin=subprocess.DEVNULL, check=True, timeout=5)
    except (OSError, subprocess.SubprocessError):
        print("wuhou-backup: 主机日志写入失败", flush=True)


def atomic_json(path, value):
    with tempfile.NamedTemporaryFile("w", dir=path.parent, prefix=".status-", delete=False) as file:
        temporary = Path(file.name)
        try:
            json.dump(value, file, ensure_ascii=False)
            file.flush()
            os.fsync(file.fileno())
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)


def read_json(path):
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        return None


@contextmanager
def lock(name):
    with (MAINTENANCE / name).open("a") as file:
        fcntl.flock(file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def disk_usage():
    stat = os.statvfs(BACKUPS)
    total = stat.f_blocks * stat.f_frsize
    if total <= 0:
        raise OSError("invalid backup filesystem size")
    return {"totalBytes": total, "availableBytes": max(0, min(total, stat.f_bavail * stat.f_frsize))}


def archive_paths(kind):
    directory = BACKUPS / kind
    try:
        paths = list(directory.iterdir())
    except FileNotFoundError:
        return []
    return sorted((path for path in paths if NAME.fullmatch(path.name)), reverse=True)


def archive_identity(path):
    identity = []
    for candidate in (path, path / "manifest.json", path / "database.dump"):
        try:
            entry = candidate.lstat()
        except FileNotFoundError:
            return None
        expected = stat.S_ISDIR if candidate == path else stat.S_ISREG
        if not expected(entry.st_mode):
            return None
        identity.append([entry.st_dev, entry.st_ino, entry.st_size, entry.st_mtime_ns, entry.st_ctime_ns])
    return identity


def check_archive(kind, path, deadline):
    identity = None
    try:
        identity = archive_identity(path)
        if identity is None:
            return {"identity": None, "state": "CORRUPT"}
        manifest = read_json(path / "manifest.json")
        verified = datetime.fromisoformat(manifest["verifiedAt"])
        if (verified.utcoffset() != timedelta(0) or verified > now() or manifest["kind"] != kind
                or type(manifest["bytes"]) is not int or manifest["bytes"] <= 0
                or manifest["bytes"] != identity[-1][2]
                or not re.fullmatch(r"[0-9a-f]{64}", manifest["sha256"])):
            return {"identity": identity, "state": "CORRUPT"}
        digest = hashlib.sha256()
        with (path / "database.dump").open("rb") as source:
            for block in iter(lambda: source.read(1024 * 1024), b""):
                if monotonic() >= deadline:
                    raise BackupFailure("INTEGRITY_TIMEOUT")
                digest.update(block)
        if archive_identity(path) != identity:
            return {"identity": identity, "state": "UNREADABLE"}
        if digest.hexdigest() != manifest["sha256"]:
            return {"identity": identity, "state": "CORRUPT"}
        return {"identity": identity, "state": "VALID",
                "backup": {key: manifest[key] for key in ("verifiedAt", "bytes")}}
    except (KeyError, TypeError, ValueError):
        return {"identity": identity, "state": "CORRUPT"}
    except OSError:
        return {"identity": identity, "state": "UNREADABLE"}


def integrity_file(kind):
    return MAINTENANCE / f"backup-integrity-{kind}.json"


def verify_archives(kind, deadline, verified=None):
    checked = {}
    for path in archive_paths(kind):
        entry = (verified or {}).get(path.name)
        checked[path.name] = entry if entry and current_entry(path, entry) == entry["state"] else check_archive(kind, path, deadline)
    atomic_json(integrity_file(kind), {"checkedAt": timestamp(now()), "archives": checked})
    return checked


def current_entry(path, entry):
    if not isinstance(entry, dict):
        return "UNREADABLE"
    try:
        if archive_identity(path) == entry["identity"]:
            return entry["state"]
    except (KeyError, OSError):
        pass
    return "UNREADABLE"


def integrity_status(kind, instant):
    try:
        report = read_json(integrity_file(kind))
        fresh = timedelta(0) <= instant - datetime.fromisoformat(report["checkedAt"]) <= INTEGRITY_MAX_AGE
        checked = report["archives"]
        if not isinstance(checked, dict):
            raise ValueError("invalid integrity report")
    except (KeyError, OSError, TypeError, ValueError):
        fresh, checked = False, {}
    latest = None
    corrupt = False
    unconfirmed = not fresh
    try:
        paths = archive_paths(kind)
    except OSError:
        return None, False, True
    for path in paths:
        entry = checked.get(path.name)
        state = current_entry(path, entry)
        if state == "CORRUPT":
            corrupt = True
        elif state == "VALID":
            if fresh and latest is None:
                try:
                    backup = entry["backup"]
                    verified = datetime.fromisoformat(backup["verifiedAt"])
                    if verified <= instant and type(backup["bytes"]) is int and backup["bytes"] > 0:
                        latest = backup
                    else:
                        unconfirmed = True
                except (KeyError, TypeError, ValueError):
                    unconfirmed = True
        else:
            unconfirmed = True
    return latest, corrupt, unconfirmed


def daily_required_since(instant):
    local = instant.astimezone(SHOP_TIME)
    due = datetime.combine(local.date(), time(3, 35), SHOP_TIME)
    return due if local >= due + timedelta(hours=1) else due - timedelta(days=1)


def collect(instant):
    disk = disk_usage()
    alerts = []
    integrity_alerts = []
    result = {"schema": 1, "observedAt": timestamp(instant), "disk": disk}
    if disk["availableBytes"] < 4 * GIB or disk["availableBytes"] * 100 < 15 * disk["totalBytes"]:
        alerts.append("DISK_LOW")
    for kind in KINDS:
        success, corrupt, unconfirmed = integrity_status(kind, instant)
        attempt = read_json(MAINTENANCE / f"backup-{kind}.json")
        result[kind] = {"latestAttempt": attempt, "lastSuccess": success}
        if corrupt:
            integrity_alerts.append(kind.upper() + "_BACKUP_CORRUPT")
        if unconfirmed:
            integrity_alerts.append(kind.upper() + "_INTEGRITY_UNCONFIRMED")
        if attempt and (attempt["state"] == "FAILED" or
                        (attempt["state"] == "RUNNING"
                         and instant - datetime.fromisoformat(attempt["startedAt"]) >= timedelta(minutes=25))):
            alerts.append(kind.upper() + "_FAILED")
        if kind == "daily" and (not success or
                                datetime.fromisoformat(success["verifiedAt"]) < daily_required_since(instant)):
            alerts.append("DAILY_OVERDUE")
    return result | {"alerts": alerts, "integrityAlerts": integrity_alerts}


def publish_status():
    try:
        with lock("backup-status.lock"):
            try:
                previous = read_json(STATUS) or {}
            except (OSError, ValueError):
                previous = {}
            current = collect(now())
            atomic_json(STATUS, current)
            active = set(current["alerts"] + current["integrityAlerts"])
            old = set(previous.get("alerts", []) + previous.get("integrityAlerts", [])) if isinstance(previous, dict) else set()
            for code in sorted(active - old):
                log("backup_alert=" + code, "warning")
            for code in sorted(old - active):
                log("backup_recovered=" + code)
    except BlockingIOError:
        pass


def write_dump(target):
    checksum = hashlib.sha256()
    size = 0
    if disk_usage()["availableBytes"] <= RESERVE:
        raise BackupFailure("DISK_RESERVE")
    with subprocess.Popen((*COMPOSE, "pg_dump", "-U", "wuhou", "-d", "wuhou", "--format=custom"),
                          stdin=subprocess.DEVNULL, stdout=subprocess.PIPE) as process:
        deadline = monotonic() + 600
        try:
            with target.open("xb") as file, selectors.DefaultSelector() as selector:
                selector.register(process.stdout, selectors.EVENT_READ)
                while True:
                    remaining = deadline - monotonic()
                    if remaining <= 0 or not selector.select(remaining):
                        raise BackupFailure("DUMP_TIMEOUT")
                    chunk = os.read(process.stdout.fileno(), 1024 * 1024)
                    if not chunk:
                        break
                    if disk_usage()["availableBytes"] - len(chunk) < RESERVE:
                        raise BackupFailure("DISK_RESERVE")
                    file.write(chunk)
                    checksum.update(chunk)
                    size += len(chunk)
                if process.wait(timeout=max(0, deadline - monotonic())) or size == 0:
                    raise BackupFailure("DUMP_FAILED")
                file.flush()
                os.fsync(file.fileno())
        except subprocess.TimeoutExpired as failure:
            raise BackupFailure("DUMP_TIMEOUT") from failure
        finally:
            if process.poll() is None:
                process.kill()
    return size, checksum.hexdigest()


def verify_dump(target):
    try:
        with target.open("rb") as file:
            subprocess.run((*COMPOSE, "pg_restore", "--exit-on-error", "--file=/dev/null"),
                           stdin=file, check=True, timeout=600)
    except (OSError, subprocess.SubprocessError) as failure:
        raise BackupFailure("VERIFY_FAILED") from failure


def rotate(kind, checked, instant):
    paths = archive_paths(kind)
    states = {path: current_entry(path, checked.get(path.name)) for path in paths}
    keep_predeploy = 2 if any(state != "VALID" for state in states.values()) else 1
    good = [path for path in paths if states[path] == "VALID"]
    for position, path in enumerate(good, 1):
        expired = datetime.fromisoformat(checked[path.name]["backup"]["verifiedAt"]) < instant - timedelta(days=30)
        if kind == "daily" and position > 14 or kind == "predeploy" and (position > 5 or position > keep_predeploy and expired):
            shutil.rmtree(path)


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def create_archive(kind, directory, name, deadline):
    # After taking the common lock these directories have no active writer.
    for path in directory.glob(".partial-*"):
        if path.is_dir() and not path.is_symlink():
            shutil.rmtree(path)
    with tempfile.TemporaryDirectory(dir=directory, prefix=".partial-") as temporary:
        work = Path(temporary)
        dump = work / "database.dump"
        size, checksum = write_dump(dump)
        verify_dump(dump)
        completed = now()
        atomic_json(work / "manifest.json", {"kind": kind, "verifiedAt": timestamp(completed),
                                             "bytes": size, "sha256": checksum})
        sync_directory(work)
        work.rename(directory / name)
        sync_directory(directory)
        return check_archive(kind, directory / name, deadline)


def scan_history(kind, deadline, verified=None):
    try:
        return verify_archives(kind, deadline, verified)
    except BackupFailure as error:
        if str(error) != "INTEGRITY_TIMEOUT":
            raise
        log("backup_integrity_failed kind=" + kind + " code=INTEGRITY_TIMEOUT", "warning")
    except (OSError, ValueError):
        log("backup_integrity_failed kind=" + kind, "warning")
    return None


def backup(kind, deadline):
    directory = BACKUPS / kind
    private_directory(directory)
    started = now()
    name = started.strftime("%Y%m%dT%H%M%S%fZ")
    attempt = {"state": "RUNNING", "startedAt": timestamp(started), "finishedAt": None, "error": None}
    attempt_file = MAINTENANCE / f"backup-{kind}.json"
    atomic_json(attempt_file, attempt)
    failure = None
    entry = None
    try:
        entry = create_archive(kind, directory, name, deadline)
        if entry["state"] != "VALID":
            failure = "VERIFY_FAILED"
    except BackupFailure as error:
        failure = "VERIFY_FAILED" if str(error) == "INTEGRITY_TIMEOUT" else str(error)
    except OSError:
        failure = "STORAGE_FAILED"
    try:
        checked = scan_history(kind, deadline, {name: entry})
        if not failure and current_entry(directory / name, entry) != "VALID":
            failure = "VERIFY_FAILED"
        if not failure and checked is not None:
            try:
                rotate(kind, checked, now())
            except OSError:
                log("backup_rotation_failed kind=" + kind, "warning")
    except BackupFailure as error:
        failure = failure or str(error)
    attempt |= {"state": "FAILED" if failure else "SUCCESS", "finishedAt": timestamp(now()), "error": failure}
    atomic_json(attempt_file, attempt)
    log(f"backup_{attempt['state'].lower()} kind={kind}" + (f" code={failure}" if failure else ""),
        "warning" if failure else "notice")
    return bool(failure)


def maintain(action, deadline):
    if action == "verify":
        results = [scan_history(kind, deadline) for kind in KINDS]
        for kind, result in zip(KINDS, results):
            if result == {}:
                log("backup_verify_empty kind=" + kind)
        return any(result is None or any(entry["state"] != "VALID" for entry in result.values())
                   for result in results)
    failed = backup(action, deadline)
    if action == "daily":
        scan_history("predeploy", deadline)
    return failed


def terminate(_signal, _frame):
    raise BackupFailure("INTERRUPTED")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=(*KINDS, "status", "verify"), nargs="?", default="daily")
    action = parser.parse_args().action
    # Leave time for the caller's 1250-second predeploy timeout.
    deadline = monotonic() + 1220 if action == "predeploy" else float("inf")
    os.umask(0o077)
    signal.signal(signal.SIGTERM, terminate)
    signal.signal(signal.SIGHUP, terminate)
    signal.signal(signal.SIGINT, terminate)
    try:
        private_directory(BACKUPS)
        private_directory(STATUS.parent)
        if action == "status":
            publish_status()
            return 0
        with lock("backup.lock"):
            failed = maintain(action, deadline)
        try:
            publish_status()
        except (OSError, ValueError, KeyError, TypeError):
            log("backup_status_failed", "warning")
        return int(failed)
    except BlockingIOError:
        log(f"backup_lock_busy action={action}", "warning")
    except (OSError, ValueError, BackupFailure, KeyError, TypeError):
        log(f"backup_command_failed action={action}", "warning")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
