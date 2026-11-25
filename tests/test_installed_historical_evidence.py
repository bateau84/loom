"""Counterexamples for historical qualification oracles; not installed-host acceptance."""
from copy import deepcopy
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

from installed_historical_evidence import (
    assert_exact_field_envelope, assert_read_only_effects, physical_generation_oracle, synthetic_transfer,
)
from test_installed_learning_stage4 import driver_plan, driver_receipts


def exported(session, message):
    return {"info": {"id": session}, "messages": [{"id": message, "type": "assistant", "content": [
        {"type": "tool", "id": "native-part", "name": "subagent", "state": {
            "status": "completed", "input": {"prompt": "synthetic"},
            "content": [{"type": "text", "text": "SYNTHETIC_ORIGINAL"}],
            "metadata": {"sessionID": "ses_child"},
        }},
    ]}]}


def storage_fixture(path):
    split, inline = exported("ses_split", "msg_split"), exported("ses_inline", "msg_inline")
    with sqlite3.connect(path) as db:
        db.executescript("""
            CREATE TABLE session_message(id TEXT PRIMARY KEY,session_id TEXT,type TEXT,data TEXT);
            CREATE TABLE session_part(message_id TEXT,session_id TEXT,ordinal INTEGER,data TEXT,
                                      PRIMARY KEY(message_id,ordinal));
        """)
        for value in (split, inline):
            message = value["messages"][0]
            physical = deepcopy(message)
            if value is split:
                physical["content"] = []
            db.execute("INSERT INTO session_message VALUES(?,?,?,?)",
                       (message["id"], value["info"]["id"], "assistant", json.dumps(physical)))
        db.execute("INSERT INTO session_part VALUES(?,?,?,?)",
                   ("msg_split", "ses_split", 0, json.dumps(split["messages"][0]["content"][0])))
    return split, inline


class PhysicalGenerationOracleTest(unittest.TestCase):
    def test_distinct_physical_forms_must_equal_supported_export_and_remain_unchanged(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "native.db"
            split, inline = storage_fixture(path)
            before = path.read_bytes()
            result = physical_generation_oracle(path, split, inline)
            self.assertEqual(result["status"], "PASS")
            self.assertEqual([(item["inline_parts"], item["split_parts"]) for item in result["populations"]], [(0, 1), (1, 0)])
            self.assertEqual(path.read_bytes(), before)

    def test_same_counts_with_changed_content_cannot_qualify(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "native.db"
            split, inline = storage_fixture(path)
            changed = deepcopy(split["messages"][0]["content"][0])
            changed["state"]["content"][0]["text"] = "ADJACENT_OUTPUT_IS_NOT_ORIGINAL"
            with sqlite3.connect(path) as db:
                db.execute("UPDATE session_part SET data=?", (json.dumps(changed),))
            with self.assertRaisesRegex(RuntimeError, "disagree with the supported normalized export"):
                physical_generation_oracle(path, split, inline)

    def test_export_shape_alone_does_not_prove_split_storage(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "native.db"
            split, inline = storage_fixture(path)
            with sqlite3.connect(path) as db:
                db.execute("DELETE FROM session_part")
                db.execute("UPDATE session_message SET data=? WHERE id='msg_split'",
                           (json.dumps(split["messages"][0]),))
            with self.assertRaisesRegex(RuntimeError, "actual split-only storage"):
                physical_generation_oracle(path, split, inline)

    def test_wrong_session_and_mixed_generation_cannot_qualify(self):
        for kind in ("foreign", "mixed"):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as temporary:
                path = Path(temporary) / "native.db"
                split, inline = storage_fixture(path)
                with sqlite3.connect(path) as db:
                    if kind == "foreign":
                        db.execute("UPDATE session_message SET session_id='ses_foreign' WHERE id='msg_inline'")
                    else:
                        db.execute("INSERT INTO session_part VALUES(?,?,?,?)",
                                   ("msg_inline", "ses_inline", 0, json.dumps(inline["messages"][0]["content"][0])))
                with self.assertRaises(RuntimeError):
                    physical_generation_oracle(path, split, inline)


class ReadOnlyEffectOracleTest(unittest.TestCase):
    def receipts(self):
        # Fixture inputs are not native receipts. The installed harness must
        # still obtain and reconcile its own complete passive audit.
        return [event for event in driver_receipts()
                if not (event["type"] == "native-event" and event["data"]["type"] == "session.created")]

    def test_known_reader_requires_the_exact_driver_sequence(self):
        result = assert_read_only_effects(self.receipts(), {"owner"}, driver_plan())
        self.assertEqual(result["evaluator_dispatches"], 0)
        receipts = self.receipts()
        receipts.append(deepcopy(next(event for event in receipts if event["type"] == "model-request")))
        with self.assertRaisesRegex(RuntimeError, "invocation"):
            assert_read_only_effects(receipts, {"owner"}, driver_plan())

    def test_external_recipient_and_evaluator_cannot_hide_in_known_driver_activity(self):
        for changed in ({"sessionID": "historical-owner"}, {"agent": "evaluator"},
                        {"model": {"providerID": "external", "id": "reader"}}):
            with self.subTest(changed=changed):
                receipts = self.receipts()
                next(event for event in receipts if event["type"] == "model-request")["data"].update(changed)
                with self.assertRaisesRegex(RuntimeError, "non-reader or external"):
                    assert_read_only_effects(receipts, {"owner"}, driver_plan())

    def test_native_recipient_activity_and_record_writes_are_rejected(self):
        for added in (
            {"type": "tool-before", "data": {"tool": "subagent"}},
            {"type": "tool-before", "data": {"tool": "loom_record", "input": {"operation": "add"}}},
            {"type": "native-event", "data": {"type": "session.created"}},
            {"type": "native-event", "data": {"type": "session.inbox.enqueued", "data": {"item": {"type": "synthetic"}}}},
            {"type": "provider-inputs", "data": {"notices": ["unexpected resume"]}},
        ):
            with self.subTest(added=added), self.assertRaises(RuntimeError):
                assert_read_only_effects(self.receipts() + [added], {"owner"}, driver_plan())

    def test_synthetic_transfer_does_not_widen_shared_host_access(self):
        for method, path, body in (
            ("GET", "/api/experimental/session/ses_foreign/export?sanitize=false", None),
            ("GET", "/api/session/ses_owned/message", None),
            ("POST", "/api/experimental/session/import", {"info": {"id": "ses_foreign"}}),
        ):
            with self.subTest(path=path), self.assertRaisesRegex(RuntimeError, "unowned transfer"):
                synthetic_transfer(None, {"ses_owned"}, method, path, body)


class SelectiveFieldEnvelopeOracleTest(unittest.TestCase):
    def response(self, fields):
        return {"result": {"format": "loom-native-evidence-source/v1", "session_id": "ses_reader",
            "source": "native-context", "source_sha256": "a" * 64, "messages_sha256": "b" * 64,
            "coverage": {"full_history": False, "authenticity": "native-context", "location_verified": True,
                         "detail": "Synthetic native context"},
            "identity": {"session_id": "ses_reader", "message_id": "msg_exact", "part_id": "part_exact"},
            "status": "resolved", "part": {"part_sha256": "c" * 64}, "fields": deepcopy(fields), "gaps": [],
            "note": "Exact selected projection", "namespace": {"project_id": "project", "workspace_id": None,
                                                                   "native_store_identity": "unavailable"}}}

    def test_complete_dispatch_response_and_explicit_status_are_accepted(self):
        fields = {"dispatch": {"session_id": "ses_child", "source_field": "state.metadata.sessionID"}}
        for selected in (fields, {**fields, "status": "completed"}):
            with self.subTest(fields=selected):
                result = assert_exact_field_envelope(json.dumps(self.response(selected)), selected, "completed")
                self.assertTrue(result["complete_serialized_response_checked"])

    def test_unrequested_metadata_anywhere_outside_fields_is_rejected(self):
        fields = {"dispatch": {"session_id": "ses_child", "source_field": "state.metadata.sessionID"}}
        for target, key, value in (
            ("part", "status", "completed"), ("part", "normalized_part_bytes", 123),
            ("part", "fields", {"output": {"availability": "available", "bytes": 50}}),
            ("result", "normalized_source_bytes", 456), ("coverage", "status", "completed"),
            ("namespace", "status", "completed"), ("outer", "status", "completed"),
            ("fields", "status", "completed"),
        ):
            response = self.response(fields)
            where = response if target == "outer" else response["result"] if target == "result" else response["result"][target]
            where[key] = value
            with self.subTest(target=target, key=key), self.assertRaises(RuntimeError):
                assert_exact_field_envelope(json.dumps(response), fields, "completed")

    def test_approved_original_may_contain_status_text_without_metadata_being_added(self):
        fields = {"output": [{"type": "text", "text": 'Original {"status":"completed"} payload'}]}
        response = self.response(fields)
        self.assertEqual(assert_exact_field_envelope(json.dumps(response), fields, "completed")["selected_fields"], ["output"])
        response["result"]["part"]["status"] = "completed"
        with self.assertRaisesRegex(RuntimeError, "unselected part metadata"):
            assert_exact_field_envelope(json.dumps(response), fields, "completed")


if __name__ == "__main__":
    unittest.main()
