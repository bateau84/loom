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
    def test_source_inventory_works_without_git_objects(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "src").mkdir()
            (root / "src/example.ts").write_text("export const x = 1\n")
            result = smoke.source_inventory(root)
            self.assertIsNone(result["head"])
            self.assertIn("src/example.ts", result["runtime_sha256"])

    def test_same_host_retries_empty_inventory_until_observable_readiness(self):
        host = object.__new__(smoke.PrivateHost)
        host.project, host.label = Path("/tmp/project"), "unit"
        replies = iter([[], [{"id": "native"}]])
        host.get = lambda path, label: json.dumps({"location": {"directory": str(host.project)}, "data": next(replies)})
        with patch.object(smoke.time, "sleep"):
            data, attempts = host.wait_roster("/api/agent", "agents", lambda items: bool(items))
        self.assertEqual(attempts, 2)
        self.assertEqual(data, [{"id": "native"}])

    def test_failed_plugin_cannot_be_treated_as_ready(self):
        host = object.__new__(smoke.PrivateHost)
        host.project, host.label = Path("/tmp/project"), "unit"
        host.get = lambda path, label: json.dumps({"location": {"directory": str(host.project)}, "data": [{"id": "loom", "state": {"status": "failed"}}]})
        with self.assertRaisesRegex(RuntimeError, "plugin failure"):
            host.wait_roster("/api/plugin", "plugins", lambda items: True)

    def test_roster_envelope_requires_the_requested_location(self):
        project = Path("/tmp/project")
        source = {"location": {"directory": str(project)}, "data": [{"id": "a"}]}
        self.assertEqual(smoke.roster_response(json.dumps(source), project), [{"id": "a"}])
        for invalid in [[], {"data": []}, {"location": {"directory": "/other"}, "data": []},
                        {"location": {"directory": str(project)}, "data": {}}]:
            with self.assertRaises(RuntimeError):
                smoke.roster_response(json.dumps(invalid), project)

    def test_baseline_and_plugin_config_preserve_external_agents(self):
        before = smoke.host_config()
        enabled = smoke.host_config(Path("/tmp/plugin"))
        self.assertEqual(before["agents"], enabled["agents"])
        self.assertEqual(before["plugins"], ["*"])
        self.assertEqual(enabled["plugins"], ["*", "/tmp/plugin"])
        self.assertEqual(set(before["agents"]), {"probe-research", "probe-worker"})

    def test_read_only_endpoint_paths_preserve_location(self):
        from urllib.parse import parse_qs, urlsplit
        path = smoke.endpoint_path("/api/agent", Path("/tmp/a space"))
        self.assertEqual(urlsplit(path).path, "/api/agent")
        self.assertEqual(parse_qs(urlsplit(path).query), {"location[directory]": ["/tmp/a space"]})
        with self.assertRaises(RuntimeError):
            smoke.endpoint_path("/api/session", Path("/tmp/project"))

    def test_readiness_rejects_remote_endpoints(self):
        self.assertEqual(smoke.ready_url('{"url":"http://127.0.0.1:12345"}'), "http://127.0.0.1:12345")
        for url in ["http://example.com:123", "https://127.0.0.1:123", "http://user:pw@127.0.0.1:123", "http://127.0.0.1:123/path"]:
            with self.assertRaises(RuntimeError):
                smoke.ready_url(json.dumps({"url": url}))

    def test_redirects_cannot_send_private_credentials_elsewhere(self):
        with self.assertRaises(RuntimeError):
            smoke.NoRedirect().redirect_request(None, None, 302, "", {}, "http://example.com")

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
                    smoke.run_probe(str(root / "missing-opencode"), root, output, "2.0.29")
            report = json.loads((output / "report.json").read_text())
            self.assertEqual(report["status"], "failed")
            self.assertEqual(report["two_agent_acceptance"], "not exercised")
            self.assertFalse(report["independent_review"])


if __name__ == "__main__":
    unittest.main()
