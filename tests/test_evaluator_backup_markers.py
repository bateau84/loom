"""Offline backup must not mistake lost evaluator mappings for legacy state."""
from contextlib import closing
import importlib.util
import os
from pathlib import Path
import sqlite3
import shutil
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "tools" / "learning-state-backup.py"
spec = importlib.util.spec_from_file_location("learning_state_backup", SCRIPT)
backup_tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup_tool)


class EvaluatorBackupMarkersTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name).resolve()
        self.project = str(root / "project")
        scope = backup_tool.project_scope("test-project", self.project)
        self.source = root / scope
        self.source.mkdir()
        self.backup = root / "backup"
        with closing(sqlite3.connect(self.source / "ledger.sqlite")) as db, db:
            db.execute("PRAGMA user_version=1")
            for table in backup_tool.REQUIRED_TABLES["ledger.sqlite"]:
                db.execute(f'CREATE TABLE "{table}" (id TEXT)')
        with closing(sqlite3.connect(self.source / "learning.sqlite")) as db, db:
            for table, columns in {**backup_tool.REQUIRED_COLUMNS, **backup_tool.EVALUATION_COLUMNS}.items():
                fields = ", ".join(f'"{column}"' for column in sorted(columns))
                db.execute(f'CREATE TABLE "{table}" ({fields})')
            db.execute("INSERT INTO learning_evaluation_schema VALUES (1, 1)")

    def run_backup(self):
        return subprocess.run(
            ["python3", str(SCRIPT), "backup", "--source-dir", str(self.source),
             "--backup-dir", str(self.backup), "--project-id", "test-project",
             "--project-canonical", self.project, "--loom-revision", "a" * 40,
             "--package-version", "test"],
            env={**os.environ, "LOOM_WRITERS_STOPPED": "yes"},
            capture_output=True, text=True, check=False,
        )

    def test_rejects_missing_extension_after_mapping(self):
        for marker in ("evaluator-request-mapped", "evaluator-dispatch-unavailable"):
            if self.backup.exists():
                shutil.rmtree(self.backup)
            with self.subTest(marker=marker), closing(sqlite3.connect(self.source / "learning.sqlite")) as db, db:
                db.execute("DELETE FROM learning_evaluation_batches")
                db.execute("INSERT INTO learning_evaluation_batches (blocked_reason) VALUES (?)", (marker,))
                db.commit()
                result = self.run_backup()
                self.assertNotEqual(result.returncode, 0, result.stdout)
                self.assertIn("learning_evaluator_", result.stderr)
                self.assertFalse((self.backup / backup_tool.MANIFEST).exists())

    def test_accepts_genuine_legacy_evaluation(self):
        result = self.run_backup()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("BACKUP VERIFIED", result.stdout)


if __name__ == "__main__":
    unittest.main()
