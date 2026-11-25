"""Verify disk, scheduling, validation and retention without a production database."""

from datetime import datetime, timedelta
import hashlib
import importlib.util
import os
from pathlib import Path
import signal
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

    def verify(self, kind, instant=None):
        with patch.object(ops, "now", return_value=instant or self.instant):
            return ops.verify_archives(kind, float("inf"))

    def status(self, instant=None):
        with patch.object(ops, "disk_usage", return_value=self.disk):
            return ops.collect(instant or self.instant)

    def test_verified_backup_is_published_and_bad_dump_keeps_previous(self):
        with patch.object(ops, "disk_usage", return_value=self.disk), patch.object(ops, "log"), \
                patch.object(ops, "now", return_value=self.instant), \
                patch.object(ops, "COMPOSE", (sys.executable, "-c",
                    "import sys; sys.stdout.buffer.write(b'dump') if 'pg_dump' in sys.argv else sys.exit(sys.stdin.buffer.read() != b'dump')")):
            self.assertFalse(ops.backup("daily", float("inf")))
        kept = ops.archive_paths("daily")
        self.assertEqual(1, len(kept))
        self.assertEqual(hashlib.sha256(b"dump").hexdigest(), ops.read_json(kept[0] / "manifest.json")["sha256"])
        later = self.instant + timedelta(minutes=1)
        with patch.object(ops, "disk_usage", return_value=self.disk), patch.object(ops, "log"), \
                patch.object(ops, "now", return_value=later), \
                patch.object(ops, "COMPOSE", (sys.executable, "-c",
                    "import sys; sys.stdout.buffer.write(b'broken') if 'pg_dump' in sys.argv else sys.exit(1)")):
            self.assertTrue(ops.maintain("daily", float("inf")))
        self.assertEqual(kept, ops.archive_paths("daily"))
        self.assertIsNotNone(ops.read_json(ops.integrity_file("predeploy")))
        self.assertEqual([], list((ops.BACKUPS / "daily").glob(".partial-*")))
        self.assertEqual("VERIFY_FAILED", ops.read_json(ops.MAINTENANCE / "backup-daily.json")["error"])
        with patch.object(ops, "disk_usage", return_value=self.disk):
            status = ops.collect(later)
        self.assertIn("DAILY_FAILED", status["alerts"])
        self.assertEqual(ops.timestamp(self.instant), status["daily"]["lastSuccess"]["verifiedAt"])

    def test_predeploy_exit_depends_on_new_archive(self):
        old = self.archive("predeploy", self.instant - timedelta(days=1))
        (old / "database.dump").write_bytes(b"lost")
        for contents, expected in [(b"lost", 1), (b"dump", 0)]:
            def write(target):
                target.write_bytes(contents)
                return 4, hashlib.sha256(b"dump").hexdigest()
            with patch.object(ops, "write_dump", write), patch.object(ops, "verify_dump"), patch.object(ops, "log"), \
                    patch.object(sys, "argv", ["backup", "predeploy"]):
                self.assertEqual(expected, ops.main())
            status = ops.read_json(ops.STATUS)
            self.assertEqual("FAILED" if expected else "SUCCESS", status["predeploy"]["latestAttempt"]["state"])
            self.assertIn("PREDEPLOY_BACKUP_CORRUPT", status["integrityAlerts"])
            self.assertNotIn("PREDEPLOY_BACKUP_CORRUPT", status["alerts"])
            self.assertTrue(old.exists())

    def test_new_archive_unreadable_or_timed_out_fails_the_attempt(self):
        for state in ("UNREADABLE", "TIMEOUT"):
            def check(kind, path, deadline):
                if state == "TIMEOUT":
                    raise ops.BackupFailure("INTEGRITY_TIMEOUT")
                return {"state": state, "identity": None}
            with patch.object(ops, "check_archive", check), patch.object(ops, "log"), \
                    patch.object(ops, "write_dump", return_value=(4, "0" * 64)), patch.object(ops, "verify_dump"), \
                    patch.object(ops, "rotate") as rotate, patch.object(sys, "argv", ["backup", "predeploy"]):
                self.assertEqual(1, ops.main())
                rotate.assert_not_called()
            attempt = ops.read_json(ops.STATUS)["predeploy"]["latestAttempt"]
            self.assertEqual(("FAILED", "VERIFY_FAILED"), (attempt["state"], attempt["error"]))

    def test_interrupted_history_or_rotation_finalizes_attempt(self):
        for stage, expected in [("verify_archives", "DISK_RESERVE"), ("rotate", "INTERRUPTED")]:
            with self.subTest(stage=stage):
                def write(target):
                    if stage == "verify_archives":
                        raise ops.BackupFailure("DISK_RESERVE")
                    target.write_bytes(b"dump")
                    return 4, hashlib.sha256(b"dump").hexdigest()

                with patch.object(ops, "write_dump", write), patch.object(ops, "verify_dump"), patch.object(ops, "log"), \
                        patch.object(ops, stage, side_effect=lambda *args: signal.raise_signal(signal.SIGTERM)) as interrupted, \
                        patch.object(sys, "argv", ["backup", "predeploy"]):
                    self.assertEqual(1, ops.main())
                interrupted.assert_called_once()
                attempt = ops.read_json(ops.MAINTENANCE / "backup-predeploy.json")
                self.assertEqual(("FAILED", expected), (attempt["state"], attempt["error"]))
                self.assertIsNotNone(attempt["finishedAt"])
                self.assertEqual(attempt, ops.read_json(ops.STATUS)["predeploy"]["latestAttempt"])

    def test_persistently_unreadable_archive_does_not_block_daily_rotation(self):
        paths = [self.archive("daily", self.instant - timedelta(days=n)) for n in range(17)]
        original = ops.archive_identity
        def identity(path):
            if path == paths[-1]:
                raise PermissionError()
            return original(path)
        with patch.object(ops, "archive_identity", identity):
            for day in range(2):
                self.archive("daily", self.instant + timedelta(days=day))
                ops.rotate("daily", self.verify("daily", self.instant + timedelta(days=day)), self.instant)
                self.assertEqual(15, len(ops.archive_paths("daily")))
                self.assertTrue(paths[-1].exists())

    def test_reserve_is_enforced(self):
        with patch.object(ops, "disk_usage", return_value=self.disk | {"availableBytes": ops.RESERVE}), \
                patch.object(subprocess, "Popen") as command, patch.object(ops, "log"):
            self.assertTrue(ops.backup("daily", float("inf")))
            command.assert_not_called()
        self.assertEqual("DISK_RESERVE", ops.read_json(ops.MAINTENANCE / "backup-daily.json")["error"])

    def test_rotation_separates_kinds_and_preserves_last_predeploy(self):
        for day in range(16):
            self.archive("daily", self.instant - timedelta(days=day))
        for day in (0, 1, 2, 3, 4, 5, 31, 40):
            self.archive("predeploy", self.instant - timedelta(days=day))
        ops.rotate("daily", self.verify("daily"), self.instant)
        self.assertEqual(14, len(ops.archive_paths("daily")))
        self.assertEqual(8, len(ops.archive_paths("predeploy")))
        ops.rotate("predeploy", self.verify("predeploy"), self.instant)
        self.assertEqual(5, len(ops.archive_paths("predeploy")))
        ops.rotate("predeploy", self.verify("predeploy"), self.instant + timedelta(days=31))
        self.assertEqual(1, len(ops.archive_paths("predeploy")))

    def test_same_size_damage_falls_back_and_does_not_displace_a_good_copy(self):
        paths = [self.archive("daily", self.instant - timedelta(days=day)) for day in range(16)]
        self.verify("daily")
        self.assertEqual(ops.timestamp(self.instant), self.status()["daily"]["lastSuccess"]["verifiedAt"])
        dump = paths[0] / "database.dump"
        original = dump.stat()
        dump.write_bytes(b"lost")
        os.utime(dump, ns=(original.st_atime_ns, original.st_mtime_ns))
        pending = self.status()
        self.assertIn("DAILY_INTEGRITY_UNCONFIRMED", pending["integrityAlerts"])
        self.assertEqual(ops.timestamp(self.instant - timedelta(days=1)), pending["daily"]["lastSuccess"]["verifiedAt"])
        ops.rotate("daily", self.verify("daily"), self.instant)
        damaged = self.status()
        self.assertIn("DAILY_BACKUP_CORRUPT", damaged["integrityAlerts"])
        self.assertNotIn("DAILY_INTEGRITY_UNCONFIRMED", damaged["integrityAlerts"])
        self.assertEqual(pending["daily"]["lastSuccess"], damaged["daily"]["lastSuccess"])
        self.assertEqual(paths[:15], ops.archive_paths("daily"))

    def test_predeploy_damage_preserves_previous_good_even_when_expired(self):
        old = self.archive("predeploy", self.instant - timedelta(days=31))
        newest = self.archive("predeploy", self.instant)
        broken = self.archive("predeploy", self.instant - timedelta(days=1))
        (broken / "database.dump").write_bytes(b"loss")
        ops.rotate("predeploy", self.verify("predeploy"), self.instant)
        self.assertEqual([newest, broken, old], ops.archive_paths("predeploy"))

    def test_all_copies_damaged_and_recovery(self):
        path = self.archive("daily", self.instant)
        (path / "database.dump").write_bytes(b"lost")
        self.verify("daily")
        self.assertIn("DAILY_BACKUP_CORRUPT", self.status()["integrityAlerts"])
        self.assertIsNone(self.status()["daily"]["lastSuccess"])
        (path / "database.dump").write_bytes(b"dump")
        self.verify("daily")
        self.assertNotIn("DAILY_BACKUP_CORRUPT", self.status()["integrityAlerts"])
        self.assertIsNotNone(self.status()["daily"]["lastSuccess"])

    def test_verify_exit_reports_empty_healthy_corrupt_and_unreadable_archives(self):
        with patch.object(ops, "log") as log, patch.object(sys, "argv", ["backup", "verify"]):
            self.assertEqual(0, ops.main())
            log.assert_any_call("backup_verify_empty kind=daily")
            log.assert_any_call("backup_verify_empty kind=predeploy")
            daily = self.archive("daily", self.instant)
            predeploy = self.archive("predeploy", self.instant)
            self.assertEqual(0, ops.main())
            (daily / "database.dump").write_bytes(b"lost")
            self.assertEqual(1, ops.main())
            status = ops.read_json(ops.STATUS)
            self.assertIn("DAILY_BACKUP_CORRUPT", status["integrityAlerts"])
            self.assertIsNone(status["daily"]["lastSuccess"])
            self.assertIsNotNone(status["predeploy"]["lastSuccess"])
            (daily / "database.dump").write_bytes(b"dump")
            original = ops.archive_identity

            def identity(path):
                if path == predeploy:
                    raise PermissionError()
                return original(path)

            with patch.object(ops, "archive_identity", identity):
                self.assertEqual(1, ops.main())
            status = ops.read_json(ops.STATUS)
            self.assertIn("PREDEPLOY_INTEGRITY_UNCONFIRMED", status["integrityAlerts"])
            self.assertIsNone(status["predeploy"]["lastSuccess"])
            self.assertIsNotNone(status["daily"]["lastSuccess"])

    def test_verify_interruption_returns_nonzero_and_preserves_previous_report(self):
        self.archive("daily", self.instant)
        self.verify("daily")
        report = ops.read_json(ops.integrity_file("daily"))

        def interrupt(*_args):
            signal.raise_signal(signal.SIGTERM)

        with patch.object(ops, "log"), patch.object(ops, "check_archive", side_effect=interrupt), \
                patch.object(sys, "argv", ["backup", "verify"]):
            self.assertEqual(1, ops.main())
        self.assertEqual(report, ops.read_json(ops.integrity_file("daily")))

    def test_missing_stale_and_interrupted_checks_are_not_considered_current(self):
        self.archive("daily", self.instant)
        self.assertIn("DAILY_INTEGRITY_UNCONFIRMED", self.status()["integrityAlerts"])
        self.verify("daily")
        before = ops.read_json(ops.integrity_file("daily"))
        with self.assertRaisesRegex(ops.BackupFailure, "INTEGRITY_TIMEOUT"):
            ops.verify_archives("daily", 0)
        self.assertEqual(before, ops.read_json(ops.integrity_file("daily")))
        status = self.status(self.instant + timedelta(hours=26, seconds=1))
        self.assertIn("DAILY_INTEGRITY_UNCONFIRMED", status["integrityAlerts"])
        self.assertIsNone(status["daily"]["lastSuccess"])

    def test_rotation_skips_if_checked_file_changed(self):
        for day in range(15):
            self.archive("daily", self.instant - timedelta(days=day))
        checked = self.verify("daily")
        (ops.archive_paths("daily")[0] / "database.dump").write_bytes(b"dump")
        ops.rotate("daily", checked, self.instant)
        self.assertEqual(15, len(ops.archive_paths("daily")))

    def test_monitor_logs_disk_and_missed_backup_then_recovery(self):
        self.archive("daily", self.instant - timedelta(days=1))
        self.verify("daily", self.instant - timedelta(minutes=1))
        self.verify("predeploy", self.instant - timedelta(minutes=1))
        with patch.object(ops, "disk_usage", return_value=self.disk):
            self.assertEqual([], ops.collect(self.instant - timedelta(seconds=1))["alerts"])
        with patch.object(ops, "now", return_value=self.instant), patch.object(ops, "log") as log:
            with patch.object(ops, "disk_usage", return_value=self.disk | {"availableBytes": 5 * ops.GIB}):
                ops.publish_status()
                ops.publish_status()
                self.assertEqual({"DISK_LOW", "DAILY_OVERDUE"}, set(ops.read_json(ops.STATUS)["alerts"]))
                self.assertEqual(2, log.call_count)
            self.archive("daily", self.instant)
            self.verify("daily")
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
