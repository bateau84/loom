import importlib.util
from contextlib import closing
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("installed_host_smoke", Path(__file__).with_name("installed_host_smoke.py"))
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


class BootHarnessTest(unittest.TestCase):
    def test_environment_does_not_inherit_credentials_or_remote_server(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {
            "OPENAI_API_KEY": "do-not-copy", "ANTHROPIC_API_KEY": "do-not-copy",
            "OPENCODE_SERVER": "https://not-local", "OPENCODE_CONFIG_CONTENT": "do-not-copy",
        }):
            env = smoke.isolated_environment(Path(tmp))
            self.assertNotIn("OPENAI_API_KEY", env)
            self.assertNotIn("ANTHROPIC_API_KEY", env)
            self.assertNotIn("OPENCODE_SERVER", env)
            self.assertNotIn("OPENCODE_CONFIG_CONTENT", env)
            for key in ["HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "OPENCODE_CONFIG_DIR"]:
                self.assertTrue(Path(env[key]).is_relative_to(Path(tmp)))

    def test_absent_ledger_is_not_created_by_validation(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(smoke.ledger_inventory(Path(tmp)), [])
            self.assertEqual(list(Path(tmp).iterdir()), [])

    def test_missing_tables_fail_instead_of_being_created(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp)
            path = state / "loom/actions-v1/example/ledger.sqlite"
            path.parent.mkdir(parents=True)
            with closing(sqlite3.connect(path)) as db, db:
                db.execute("CREATE TABLE wrong(data TEXT)")
            with self.assertRaisesRegex(RuntimeError, "Incomplete Loom schema"):
                smoke.ledger_inventory(state)
            with closing(sqlite3.connect(path)) as db, db:
                self.assertEqual(db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall(), [("wrong",)])

    def test_valid_database_is_read_without_changing_records(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp)
            path = state / "loom/actions-v1/example/ledger.sqlite"
            path.parent.mkdir(parents=True)
            with closing(sqlite3.connect(path)) as db, db:
                for table in sorted(smoke.EXPECTED_TABLES):
                    db.execute(f"CREATE TABLE {table}(data TEXT)")
                db.execute("INSERT INTO ledger(data) VALUES ('preserved')")
                db.execute("PRAGMA user_version=1")
            self.assertEqual(smoke.ledger_inventory(state)[0]["counts"]["ledger"], 1)
            with closing(sqlite3.connect(path)) as db, db:
                self.assertEqual(db.execute("SELECT data FROM ledger").fetchone()[0], "preserved")

    def test_failed_executable_produces_failed_report(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            output = root / "report"
            with patch.object(smoke, "source_inventory", return_value={}):
                with self.assertRaises(FileNotFoundError):
                    smoke.run_probe(str(root / "missing-opencode"), root, output, "2.0.18")
            report = json.loads((output / "report.json").read_text())
            self.assertEqual(report["status"], "failed")
            self.assertEqual(report["two_agent_acceptance"], "not exercised")
            self.assertFalse(report["independent_review"])


if __name__ == "__main__":
    unittest.main()
