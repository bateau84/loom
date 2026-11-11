"""Stopped-file scanner regressions; native creation has a separate installed runner."""
from contextlib import closing
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("experiment_recovery", ROOT / "tools/inspect_experiment_recovery.py")
scanner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scanner)
NATIVE_SQL = (ROOT / "tests/fixtures/opencode-2.2.6-recovery.sql").read_text()
SECRET = "Private candidate words must never appear in the report."


class ExperimentRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.native = self.root / "opencode.db"
        self.learning = self.root / "learning.sqlite"
        with closing(sqlite3.connect(self.native)) as db:
            db.executescript(NATIVE_SQL)
            db.executemany("INSERT INTO session_v2 VALUES (?,?,?)", [
                ("ses_control", "project-one", None), ("ses_treatment", "project-one", None),
                ("ses_child", "project-one", "ses_treatment")])
            db.commit()
        with closing(sqlite3.connect(self.learning)) as db:
            db.executescript("""
                CREATE TABLE learning_candidates (id TEXT PRIMARY KEY, content TEXT, candidate_sha256 TEXT);
                CREATE TABLE learning_trials (id TEXT PRIMARY KEY);
                CREATE TABLE learning_live_experiments (
                    id TEXT PRIMARY KEY, session_id TEXT, candidate_id TEXT,
                    candidate_sha256 TEXT, status TEXT);
                CREATE TABLE learning_live_events (seq INTEGER PRIMARY KEY);
            """)
            db.execute("INSERT INTO learning_candidates VALUES (?,?,?)", ("cand_one", SECRET, scanner.digest(SECRET)))
            db.commit()

    def entry(self, session="ses_treatment", removed=0, value=SECRET):
        with closing(sqlite3.connect(self.native)) as db:
            db.execute("INSERT INTO instruction_entry VALUES (?,?,?,?,1,2)",
                       (session, scanner.ENTRY_KEY, None if removed else json.dumps(value), removed))
            db.commit()

    def trial(self, status="stopped", session="ses_treatment"):
        with closing(sqlite3.connect(self.learning)) as db:
            db.execute("INSERT INTO learning_live_experiments VALUES (?,?,?,?,?)",
                       ("trial_one", session, "cand_one", scanner.digest(SECRET), status))
            db.commit()

    def inspect(self, learning=True):
        return scanner.inspect(self.native, [self.learning] if learning else [],
                               host_version="2.2.6", writers_stopped=True)

    def test_orphan_native_entry_blocks_without_learning_and_keeps_bytes_private(self):
        self.entry()
        before = scanner.inventory(self.native)
        report = self.inspect(learning=False)
        self.assertEqual(report["active_native_entries"], 1)
        self.assertEqual(report["status"], "RECOVERY_REQUIRED")
        self.assertIn("assignment-history-unavailable", report["sessions"][0]["recovery_blockers"])
        self.assertFalse(report["session_reuse_authorized"])
        self.assertFalse(report["clean_controls_qualified"])
        self.assertNotIn(SECRET, json.dumps(report))
        self.assertEqual(scanner.inventory(self.native), before)

    def test_removed_tombstone_and_stopped_trial_keep_exposure_history_after_reopen(self):
        self.entry(removed=1)
        self.trial()
        before = [scanner.inventory(p) for p in (self.native, self.learning)]
        for _ in range(2):
            report = self.inspect()
            self.assertEqual(report["status"], "NO_ACTIVE_ENTRY_IN_SNAPSHOT")
            row = report["sessions"][0]
            self.assertEqual(row["native_entry"], "removed-tombstone")
            self.assertFalse(row["control_eligible"])
            self.assertEqual(row["exposure"], "possible-or-historical")
        self.assertEqual([scanner.inventory(p) for p in (self.native, self.learning)], before)

    def test_deleted_learning_history_cannot_erase_native_tombstone(self):
        self.entry(removed=1)
        report = self.inspect(learning=False)
        self.assertEqual(report["sessions"][0]["native_entry"], "removed-tombstone")
        self.assertFalse(report["sessions"][0]["control_eligible"])
        self.assertIsNone(report["sessions"][0]["trial"])

    def test_installing_without_entry_is_unconfirmed_and_stopped_with_entry_is_blocked(self):
        for state in ("installing", "assigned", "possible-exposure", "stopping", "recovery-required", "stop-uncertain"):
            with self.subTest(state=state):
                with closing(sqlite3.connect(self.learning)) as db:
                    db.execute("DELETE FROM learning_live_experiments")
                    db.commit()
                self.trial(state)
                report = self.inspect()
                self.assertEqual(report["status"], "RECOVERY_REQUIRED")
                self.assertIn("archived-withdrawal-unconfirmed", report["sessions"][0]["recovery_blockers"])
        with closing(sqlite3.connect(self.learning)) as db:
            db.execute("UPDATE learning_live_experiments SET status='stopped'")
            db.commit()
        self.entry()
        self.assertIn("entry-present-after-stopped-state", self.inspect()["sessions"][0]["recovery_blockers"])

    def test_instruction_fold_without_entry_retains_possible_historical_exposure(self):
        with closing(sqlite3.connect(self.native)) as db:
            db.execute("INSERT INTO instruction_state VALUES (?,1,1,?,?)", ("ses_child",
                       json.dumps({scanner.STATE_KEY: "a" * 64}), "{}"))
            db.commit()
        row = self.inspect(learning=False)["sessions"][0]
        self.assertEqual(row["session_id"], "ses_child")
        self.assertTrue(row["instruction_history"])
        self.assertFalse(row["control_eligible"])

    def test_entry_content_drift_is_recovery_blocker(self):
        self.trial("assigned")
        self.entry(value="changed candidate")
        self.assertIn("native-candidate-content-drift", self.inspect()["sessions"][0]["recovery_blockers"])

    def test_missing_native_session_is_not_treated_as_withdrawn(self):
        self.trial(session="ses_missing")
        self.assertIn("native-session-missing", self.inspect()["sessions"][0]["recovery_blockers"])

    def test_unknown_native_schema_and_migration_are_rejected(self):
        with closing(sqlite3.connect(self.native)) as db:
            db.execute("INSERT INTO migration VALUES ('future',1)")
            db.commit()
        with self.assertRaisesRegex(ValueError, "migration inventory"):
            self.inspect()
        with closing(sqlite3.connect(self.native)) as db:
            db.execute("DELETE FROM migration WHERE id='future'")
            db.execute("ALTER TABLE instruction_entry ADD COLUMN unexpected TEXT")
            db.commit()
        with self.assertRaisesRegex(ValueError, "schema"):
            self.inspect()

    def test_malformed_or_unknown_native_entry_is_not_silently_ignored(self):
        self.entry()
        with closing(sqlite3.connect(self.native)) as db:
            db.execute("UPDATE instruction_entry SET value='{' ")
            db.commit()
        with self.assertRaises(ValueError):
            self.inspect()
        with closing(sqlite3.connect(self.native)) as db:
            db.execute("UPDATE instruction_entry SET key='loom.live-instruction.v2',value='null'")
            db.commit()
        with self.assertRaisesRegex(ValueError, "Unsupported experimental"):
            self.inspect()

    def test_unknown_trial_state_and_missing_candidate_fail_closed(self):
        self.trial()
        with closing(sqlite3.connect(self.learning)) as db:
            db.execute("UPDATE learning_live_experiments SET status='future-state'")
            db.commit()
        with self.assertRaisesRegex(ValueError, "Unknown archived"):
            self.inspect()
        with closing(sqlite3.connect(self.learning)) as db:
            db.execute("UPDATE learning_live_experiments SET status='stopped'")
            db.execute("DELETE FROM learning_candidates")
            db.commit()
        with self.assertRaisesRegex(ValueError, "candidate content"):
            self.inspect()

    def test_duplicate_history_inputs_fail_without_choosing_one(self):
        self.trial()
        second = self.root / "other-learning.sqlite"
        second.write_bytes(self.learning.read_bytes())
        with self.assertRaisesRegex(ValueError, "Duplicate or mixed"):
            scanner.inspect(self.native, [self.learning, second], host_version="2.2.6", writers_stopped=True)

    def test_explicit_stopped_acknowledgment_and_exact_host_are_required(self):
        with self.assertRaisesRegex(ValueError, "writers-stopped"):
            scanner.inspect(self.native, [], host_version="2.2.6", writers_stopped=False)
        with self.assertRaisesRegex(ValueError, "exact OpenCode"):
            scanner.inspect(self.native, [], host_version="2.2.7", writers_stopped=True)

    def test_symlink_fifo_and_oversized_inputs_rejected_without_sqlite_open(self):
        alias = self.root / "alias.db"
        alias.symlink_to(self.native)
        with self.assertRaises(OSError):
            scanner.inventory(alias)
        fifo = self.root / "fifo.db"
        os.mkfifo(fifo)
        with self.assertRaisesRegex(ValueError, "regular"):
            scanner.inventory(fifo)
        with patch.object(scanner, "MAX_FILE_BYTES", 10):
            with self.assertRaisesRegex(ValueError, "inspection limit"):
                self.inspect()

    def test_changed_file_after_copy_cannot_produce_success_receipt(self):
        original = scanner.copy_snapshot
        def changing(path, destination, expected):
            original(path, destination, expected)
            if path == self.native:
                with closing(sqlite3.connect(path)) as db:
                    db.execute("UPDATE session_v2 SET project_id='changed'")
                    db.commit()
        with patch.object(scanner, "copy_snapshot", changing):
            with self.assertRaisesRegex(ValueError, "Paired inputs changed"):
                self.inspect()

    def test_row_limit_never_reports_truncated_scan_as_absent(self):
        with patch.object(scanner, "MAX_ROWS", 1):
            with self.assertRaisesRegex(ValueError, "row limit"):
                self.inspect()

    def test_residual_committed_wal_is_inspected_without_changing_source(self):
        code = """
import json, os, sqlite3, sys
db=sqlite3.connect(sys.argv[1])
db.execute('PRAGMA journal_mode=WAL')
db.execute('PRAGMA wal_autocheckpoint=0')
db.execute('INSERT INTO instruction_entry VALUES (?,?,?,?,1,1)', ('ses_treatment','loom.live-instruction.v1',json.dumps('wal candidate'),0))
db.commit()
os._exit(0)
"""
        subprocess.run([sys.executable, "-c", code, str(self.native)], check=True, timeout=10)
        before = scanner.inventory(self.native)
        self.assertGreater(before["-wal"]["bytes"], 0)
        self.assertEqual(self.inspect(learning=False)["active_native_entries"], 1)
        self.assertEqual(scanner.inventory(self.native), before)

    def test_cli_report_is_private_exclusive_and_never_approves_reuse(self):
        report_path = self.root / "report.json"
        args = ["--native-db", str(self.native), "--host-version", "2.2.6", "--writers-stopped",
                "--report", str(report_path)]
        self.assertEqual(scanner.main(args), 0)
        self.assertEqual(report_path.stat().st_mode & 0o777, 0o600)
        report = json.loads(report_path.read_text())
        self.assertEqual(report["status"], "NO_ACTIVE_ENTRY_IN_SNAPSHOT")
        self.assertFalse(report["session_reuse_authorized"])
        before = report_path.read_bytes()
        self.assertEqual(scanner.main(args), 2)
        self.assertEqual(report_path.read_bytes(), before)

    def test_report_cannot_create_any_native_or_learning_database_sidecar(self):
        before = [scanner.inventory(p) for p in (self.native, self.learning)]
        for database in (self.native, self.learning):
            for suffix in scanner.SIDECARS:
                with self.subTest(database=database.name, suffix=suffix):
                    args = ["--native-db", str(self.native), "--learning-db", str(self.learning),
                            "--host-version", "2.2.6", "--writers-stopped",
                            "--report", str(database) + suffix]
                    with patch.object(scanner, "inspect", side_effect=AssertionError("Must reject before inspection")):
                        self.assertEqual(scanner.main(args), 2)
                    self.assertEqual([scanner.inventory(p) for p in (self.native, self.learning)], before)

    def test_report_alias_of_reserved_database_or_sidecar_is_rejected(self):
        before = [scanner.inventory(p) for p in (self.native, self.learning)]
        alternate = self.root / "directory-alias"
        alternate.symlink_to(self.root, target_is_directory=True)
        for suffix in scanner.SIDECARS:
            with self.subTest(suffix=suffix):
                args = ["--native-db", str(self.native), "--learning-db", str(self.learning),
                        "--host-version", "2.2.6", "--writers-stopped",
                        "--report", str(alternate / (self.learning.name + suffix))]
                with patch.object(scanner, "inspect", side_effect=AssertionError("Must reject before inspection")):
                    self.assertEqual(scanner.main(args), 2)
                self.assertEqual([scanner.inventory(p) for p in (self.native, self.learning)], before)


if __name__ == "__main__":
    unittest.main()
