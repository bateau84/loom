"""Counterexamples for passive installed Stage 3 waits, not host acceptance."""
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from installed_learning_stage3 import until, view


class SourceBoundaryWaitTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.path = Path(self.temporary.name) / "learning.sqlite"
        self.db = sqlite3.connect(self.path)
        self.addCleanup(self.db.close)
        self.db.executescript("""
            CREATE TABLE learning_evaluation_opportunities(session_id TEXT,state TEXT,reason TEXT);
            CREATE TABLE learning_evaluation_batches(id TEXT,sequence INTEGER,owner_session TEXT,state TEXT,report_id TEXT);
            CREATE TABLE learning_evaluation_reports(id TEXT,body_json TEXT);
            CREATE TABLE learning_evaluation_members(batch_id TEXT,source_refs TEXT);
        """)

    def publish(self, ident, sequence, sources, *, state="complete", report=True):
        self.db.execute("INSERT INTO learning_evaluation_batches VALUES(?,?,?,?,?)",
                        (ident, sequence, "owner", state, ident if report else None))
        self.db.execute("INSERT INTO learning_evaluation_members VALUES(?,?)", (ident, json.dumps(sources)))
        if report:
            self.db.execute("INSERT INTO learning_evaluation_reports VALUES(?,?)", (ident, '{"observations":{}}'))
        self.db.commit()

    @staticmethod
    def completed(value):
        return bool(value.get("batch") and value["batch"][1] == "complete" and value["batch"][2])

    def test_intervening_complete_revision_cannot_satisfy_later_source_wait(self):
        self.publish("intervening", 2, [{"kind": "ledger-record", "id": "earlier", "session_id": "owner"}])
        # This is the observed failure shape: a valid new report is already
        # complete, but its frozen membership predates the next original.
        self.assertTrue(self.completed(view(self.path, "owner")))
        with patch("installed_learning_stage3.time.sleep", side_effect=lambda _: self.publish(
                "with-later-source", 3, [{"kind": "ledger-record", "id": "later", "session_id": "owner"}])) as sleep:
            result = until(self.path, "owner", self.completed, "later evidence", source_record_id="later")
        sleep.assert_called_once()
        self.assertEqual(result["batch"][0], "with-later-source")
        self.assertTrue(result["source_in_membership"])

    def test_source_identity_includes_kind_and_owning_session(self):
        self.publish("wrong-identities", 1, [
            {"kind": "ledger-record", "id": "later", "session_id": "foreign"},
            {"kind": "objective", "id": "later", "session_id": "owner"},
        ])
        self.assertFalse(view(self.path, "owner", "later")["source_in_membership"])
        self.publish("exact-original", 2, [{"kind": "ledger-record", "id": "later", "session_id": "owner"}])
        self.assertTrue(view(self.path, "owner", "later")["source_in_membership"])

    def test_membership_does_not_replace_successful_publication(self):
        self.publish("pending", 1, [{"kind": "ledger-record", "id": "later", "session_id": "owner"}],
                     state="running", report=False)
        with patch("installed_learning_stage3.time.sleep", side_effect=lambda _: self.publish(
                "complete", 2, [{"kind": "ledger-record", "id": "later", "session_id": "owner"}])) as sleep:
            result = until(self.path, "owner", self.completed, "completed evidence", source_record_id="later")
        sleep.assert_called_once()
        self.assertEqual(result["batch"], ["complete", "complete", "complete"])


if __name__ == "__main__":
    unittest.main()
