"""Verify disk, scheduling, validation and retention without a production database."""

from datetime import datetime, timedelta
import hashlib
import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("backup", Path(__file__).with_name("backup-ip-database.py"))
ops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)


class BackupTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        status = root / "maintenance" / "server-status" / "status.json"
        self.instant = datetime.fromisoformat("2026-11-18T20:35:00+00:00")
        self.paths = patch.multiple(ops, BACKUPS=root / "backups", MAINTENANCE=status.parent.parent, STATUS=status)
        self.paths.start()
        self.addCleanup(self.paths.stop)
        ops.private_directory(ops.BACKUPS)
        ops.private_directory(ops.STATUS.parent)
        self.disk = {"totalBytes": 40 * ops.GIB, "availableBytes": 20 * ops.GIB}

    def archive(self, kind, instant):
        path = ops.BACKUPS / kind / instant.strftime("%Y%m%dT%H%M%S%fZ")
        ops.private_directory(path)
        (path / "database.dump").write_bytes(b"dump")
        ops.atomic_json(path / "manifest.json", {"kind": kind, "verifiedAt": ops.timestamp(instant), "bytes": 4,
                                                 "sha256": hashlib.sha256(b"dump").hexdigest()})
        return path

    def test_verified_backup_is_published_and_bad_dump_keeps_previous(self):
        with patch.object(ops, "disk_usage", return_value=self.disk), patch.object(ops, "log"), \
                patch.object(ops, "now", return_value=self.instant), \
                patch.object(ops, "COMPOSE", (sys.executable, "-c",
                    "import sys; sys.stdout.buffer.write(b'dump') if 'pg_dump' in sys.argv else sys.exit(sys.stdin.buffer.read() != b'dump')")):
            self.assertFalse(ops.backup("daily"))
        kept = ops.archive_entries("daily")
        self.assertEqual(1, len(kept))
        self.assertEqual(hashlib.sha256(b"dump").hexdigest(), kept[0][1]["sha256"])
        later = self.instant + timedelta(minutes=1)
        with patch.object(ops, "disk_usage", return_value=self.disk), patch.object(ops, "log"), \
                patch.object(ops, "now", return_value=later), \
                patch.object(ops, "COMPOSE", (sys.executable, "-c",
                    "import sys; sys.stdout.buffer.write(b'broken') if 'pg_dump' in sys.argv else sys.exit(1)")):
            self.assertTrue(ops.backup("daily"))
        self.assertEqual(kept, ops.archive_entries("daily"))
        self.assertEqual([], list((ops.BACKUPS / "daily").glob(".partial-*")))
        self.assertEqual("VERIFY_FAILED", ops.read_json(ops.MAINTENANCE / "backup-daily.json")["error"])
        with patch.object(ops, "disk_usage", return_value=self.disk):
            status = ops.collect(later)
        self.assertIn("DAILY_FAILED", status["alerts"])
        self.assertEqual(ops.timestamp(self.instant), status["daily"]["lastSuccess"]["verifiedAt"])

    def test_reserve_is_enforced(self):
        with patch.object(ops, "disk_usage", return_value=self.disk | {"availableBytes": ops.RESERVE}), \
                patch.object(subprocess, "Popen") as command, patch.object(ops, "log"):
            self.assertTrue(ops.backup("daily"))
            command.assert_not_called()
        self.assertEqual("DISK_RESERVE", ops.read_json(ops.MAINTENANCE / "backup-daily.json")["error"])

    def test_rotation_separates_kinds_and_preserves_last_predeploy(self):
        for day in range(16):
            self.archive("daily", self.instant - timedelta(days=day))
        for day in (0, 1, 2, 3, 4, 5, 31, 40):
            self.archive("predeploy", self.instant - timedelta(days=day))
        ops.rotate("daily", self.instant)
        self.assertEqual(14, len(ops.archive_entries("daily")))
        self.assertEqual(8, len(ops.archive_entries("predeploy")))
        ops.rotate("predeploy", self.instant)
        self.assertEqual(5, len(ops.archive_entries("predeploy")))
        ops.rotate("predeploy", self.instant + timedelta(days=31))
        self.assertEqual(1, len(ops.archive_entries("predeploy")))

    def test_monitor_logs_disk_and_missed_backup_then_recovery(self):
        self.archive("daily", self.instant - timedelta(days=1))
        with patch.object(ops, "disk_usage", return_value=self.disk):
            self.assertEqual([], ops.collect(self.instant - timedelta(seconds=1))["alerts"])
        with patch.object(ops, "now", return_value=self.instant), patch.object(ops, "log") as log:
            with patch.object(ops, "disk_usage", return_value=self.disk | {"availableBytes": 5 * ops.GIB}):
                ops.publish_status()
                ops.publish_status()
                self.assertEqual({"DISK_LOW", "DAILY_OVERDUE"}, set(ops.read_json(ops.STATUS)["alerts"]))
                self.assertEqual(2, log.call_count)
            self.archive("daily", self.instant)
            with patch.object(ops, "disk_usage", return_value=self.disk):
                ops.publish_status()
                self.assertEqual([], ops.read_json(ops.STATUS)["alerts"])
                self.assertEqual(4, log.call_count)

    def test_jobs_share_the_same_lock(self):
        with ops.lock("backup.lock"), self.assertRaises(BlockingIOError):
            with ops.lock("backup.lock"):
                self.fail("concurrent backup acquired lock")


if __name__ == "__main__":
    unittest.main()
