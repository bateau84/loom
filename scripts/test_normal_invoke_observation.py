from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    "loom_normal_invoke_observation", Path(__file__).with_name("normal_invoke_observation.py")
)
assert SPEC and SPEC.loader
PARSER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PARSER)
RUN_SPEC = importlib.util.spec_from_file_location("loom_run_evals", Path(__file__).with_name("run-evals.py"))
assert RUN_SPEC and RUN_SPEC.loader
RUN = importlib.util.module_from_spec(RUN_SPEC)
RUN_SPEC.loader.exec_module(RUN)


def capture(events: list[dict], *, omitted: int = 0, complete: bool = True,
            payload_policy: str = "synthetic-secret-free-fixture/v1") -> str:
    records = [{"kind": "header", "schema": PARSER.DIAGNOSTIC_SCHEMA,
                "payload_policy": payload_policy,
                "diagnostic_only": True, "evidence_eligible": False}, *events,
               {"kind": "footer", "schema": PARSER.DIAGNOSTIC_SCHEMA,
                "event_count": len(events), "omitted_events": omitted, "writes_complete": complete,
                "payload_policy": payload_policy,
                "diagnostic_only": True, "evidence_eligible": False}]
    for record in records[1:-1]:
        record["payload_policy"] = payload_policy
    return "\n".join(json.dumps(record) for record in records) + "\n"


def event(schema: str, sequence: int, **fields) -> dict:
    return {"schema": schema, "sequence": sequence, "observer_failures": 0, **fields}


def valid_events() -> list[dict]:
    actor = {"agent": "general", "session_id": "session-1", "message_id": "message-1"}
    parent = {"invocation_id": "outer-invocation", "session_id": "session-1",
              "message_id": "message-1", "call_id": "outer-call"}
    return [
        {"schema": PARSER.NATIVE_SCHEMA, "diagnostic_only": True, "evidence_eligible": False,
         "event": event(PARSER.NATIVE_SCHEMA, 1, kind="call_start", invocation_id="outer-invocation",
                         call_id="outer-call", tool="execute", mode="native", actor=actor, parent=None,
                         boundary="executable-input", input={"state": "available", "value": {"code": ""}})},
        {"schema": PARSER.LOCAL_SCHEMA, "diagnostic_only": True, "evidence_eligible": False,
         "event": event(PARSER.LOCAL_SCHEMA, 2, kind="parent_start", actor=actor, parent=parent,
                         boundary="codemode-engine", mode="code_mode")},
        {"schema": PARSER.LOCAL_SCHEMA, "diagnostic_only": True, "evidence_eligible": False,
         "event": event(PARSER.LOCAL_SCHEMA, 3, kind="call_start", invocation_id="inner-invocation",
                         tool="loom.status", catalog_path="loom.code.status", actor=actor, parent=parent,
                         boundary="executable-input", input={"state": "available", "value": {"workflowId": "w"}})},
        {"schema": PARSER.LOCAL_SCHEMA, "diagnostic_only": True, "evidence_eligible": False,
         "event": event(PARSER.LOCAL_SCHEMA, 4, kind="call_end", invocation_id="inner-invocation",
                         actor=actor, parent=parent, boundary="codemode-json-return", dispatched=True,
                         outcome="returned", result={"state": "available", "value": {"summary": "sentinel"}})},
        {"schema": PARSER.LOCAL_SCHEMA, "diagnostic_only": True, "evidence_eligible": False,
         "event": event(PARSER.LOCAL_SCHEMA, 5, kind="parent_end", actor=actor, parent=parent,
                         admitted=1, dispatched=1, terminals=1, missing_terminals=0,
                         unsupported_dispatches=0, unavailable_fields=0, scope="one-codemode-engine-invocation",
                         evidence_eligible=False)},
        {"schema": PARSER.NATIVE_SCHEMA, "diagnostic_only": True, "evidence_eligible": False,
         "event": event(PARSER.NATIVE_SCHEMA, 6, kind="call_end", invocation_id="outer-invocation",
                         call_id="outer-call", actor=actor, boundary="session-tool-terminal",
                         unavailable_fields=0, outcome="returned",
                         result={"state": "available", "value": {"content": []}})},
    ]


class NormalInvokeDiagnosticParserTests(unittest.TestCase):
    def test_preserves_exact_native_and_inner_events_as_ineligible_diagnostics(self):
        records = valid_events()
        for record in records:
            self.assertTrue(PARSER._valid_event_shape(record["event"], record["schema"]), record["event"])
        parsed = PARSER.parse_diagnostic_capture(capture(records))

        self.assertTrue(parsed["capture_valid"], parsed["reasons"])
        self.assertFalse(parsed["evidence_eligible"])
        self.assertFalse(parsed["runwide_complete"])
        self.assertEqual(parsed["upstream_clipping_coverage"], "unattested")
        self.assertEqual(parsed["payload_policy"], "synthetic-secret-free-fixture/v1")
        self.assertEqual(parsed["events"], records)

    def test_rejects_incomplete_identity_or_unbalanced_invocation_without_throwing(self):
        good = valid_events()
        malformed = [
            [good[0], {**good[2], "event": {**good[2]["event"], "actor": {"agent": "general"}}}],
            [good[0], {**good[2], "event": {**good[2]["event"], "sequence": 1}}],
            [good[0], {**good[2], "event": {**good[2]["event"], "outcome": "returned"}}],
            [good[0], {"schema": [], "diagnostic_only": True, "evidence_eligible": False, "event": {}}],
            [good[0], {**good[2], "event": {**good[2]["event"], "observer_failures": 3}}],
            [good[0], {**good[2], "event": {**good[2]["event"], "input": {"state": "omitted", "reason": "redacted"}}}],
        ]
        for records in malformed:
            with self.subTest(records=records[1]):
                parsed = PARSER.parse_diagnostic_capture(capture(records))
                self.assertFalse(parsed["capture_valid"])
                self.assertFalse(parsed["evidence_eligible"])

    def test_rejects_unknown_wrapper_and_event_fields(self):
        good = valid_events()
        bad_wrapper = [{**good[0], "new_wrapper_field": True}, *good[1:]]
        bad_event = [
            {**good[0], "event": {**good[0]["event"], "new_event_field": "ignored"}},
            *good[1:],
        ]
        bad_payload_wrapper = [
            {**good[0], "event": {**good[0]["event"],
                                   "input": {"state": "available", "value": {}, "extra": True}}},
            *good[1:],
        ]
        for records in (bad_wrapper, bad_event, bad_payload_wrapper):
            with self.subTest(record=records[0]):
                parsed = PARSER.parse_diagnostic_capture(capture(records))
                self.assertFalse(parsed["capture_valid"])
                self.assertFalse(parsed["evidence_eligible"])

    def test_rejects_duplicate_json_object_keys(self):
        duplicate_header = capture([]).replace('"kind": "header"', '"kind": "header", "kind": "header"', 1)
        parsed = PARSER.parse_diagnostic_capture(duplicate_header)
        self.assertFalse(parsed["capture_valid"])
        self.assertEqual(parsed["reasons"], ["malformed_json"])

    def test_rejects_extended_actor_and_parent_identity_objects(self):
        for field in ("actor", "parent"):
            records = valid_events()
            mutated = []
            for record in records:
                event_value = record["event"]
                identity = event_value.get(field)
                if isinstance(identity, dict):
                    event_value = {**event_value, field: {**identity, "extension": "ignored"}}
                    record = {**record, "event": event_value}
                mutated.append(record)
            with self.subTest(field=field):
                parsed = PARSER.parse_diagnostic_capture(capture(mutated))
                self.assertFalse(parsed["capture_valid"])
                self.assertFalse(parsed["evidence_eligible"])

    def test_reconciles_orphans_duplicate_starts_parent_counters_and_runtime_loss(self):
        valid = valid_events()
        parent_end = valid[4]
        inner_start = valid[2]
        inner_end = valid[3]
        invalids = [
            valid[:3] + valid[4:],
            [valid[0], valid[1], inner_start, inner_start, inner_end, parent_end, valid[5]],
            [valid[0], valid[1], inner_start, {**inner_end, "event": {**inner_end["event"], "actor": {"agent": "other", "session_id": "session-1", "message_id": "message-1"}}}, parent_end, valid[5]],
            [valid[0], valid[1], inner_start, inner_end,
             {**parent_end, "event": {**parent_end["event"], "missing_terminals": 1}}, valid[5]],
            [{**valid[0], "event": {**valid[0]["event"], "observer_failures": 1}}, *valid[1:]],
        ]
        for records in invalids:
            with self.subTest(record_count=len(records)):
                self.assertFalse(PARSER.parse_diagnostic_capture(capture(records))["capture_valid"])

    def test_rejects_duplicate_parent_terminal_and_native_call_identity(self):
        valid = valid_events()
        duplicate_parent_end = {**valid[4], "event": {**valid[4]["event"], "sequence": 7}}
        with self.subTest(kind="duplicate-parent-end"):
            self.assertFalse(PARSER.parse_diagnostic_capture(capture([*valid, duplicate_parent_end]))["capture_valid"])

        actor = valid[0]["event"]["actor"]
        duplicate_native_start = {"schema": PARSER.NATIVE_SCHEMA, "diagnostic_only": True,
                                  "evidence_eligible": False,
                                  "event": event(PARSER.NATIVE_SCHEMA, 7, kind="call_start",
                                      invocation_id="second-observation-id", call_id="outer-call",
                                      tool="execute", mode="native", actor=actor, parent=None,
                                      boundary="executable-input", input={"state": "available", "value": {}})}
        duplicate_native_end = {"schema": PARSER.NATIVE_SCHEMA, "diagnostic_only": True,
                                "evidence_eligible": False,
                                "event": event(PARSER.NATIVE_SCHEMA, 8, kind="call_end",
                                    invocation_id="second-observation-id", call_id="outer-call",
                                    actor=actor, boundary="session-tool-terminal", unavailable_fields=0,
                                    outcome="returned", result={"state": "available", "value": {}})}
        with self.subTest(kind="duplicate-native-call-scope"):
            self.assertFalse(PARSER.parse_diagnostic_capture(
                capture([*valid, duplicate_native_start, duplicate_native_end]))["capture_valid"])

    def test_rejected_native_starts_do_not_crash_parent_projection(self):
        malformed = [
            event(PARSER.NATIVE_SCHEMA, 7, kind="call_start", tool="execute", actor=[], parent=None,
                  mode="native", boundary="executable-input", input={"state": "available", "value": {}}),
            event(PARSER.NATIVE_SCHEMA, 7, kind="call_start", invocation_id=[], tool="execute",
                  call_id="x", actor=valid_events()[0]["event"]["actor"], parent=None, mode="native",
                  boundary="executable-input", input={"state": "available", "value": {}}),
            event(PARSER.NATIVE_SCHEMA, 7, kind="call_start", tool="execute", call_id="x",
                  actor=valid_events()[0]["event"]["actor"], parent=None, mode="native",
                  boundary="executable-input", input={"state": "available", "value": {}}),
            event(PARSER.NATIVE_SCHEMA, 7, kind="call_start", invocation_id="outer-invocation",
                  tool="execute", call_id="outer-call", actor=[], parent=None, mode="native",
                  boundary="executable-input", input={"state": "available", "value": {}}),
        ]
        for bad in malformed:
            with self.subTest(event=bad):
                wrapper = {"schema": PARSER.NATIVE_SCHEMA, "diagnostic_only": True,
                           "evidence_eligible": False, "event": bad}
                parsed = PARSER.parse_diagnostic_capture(capture([*valid_events(), wrapper]))
                self.assertFalse(parsed["capture_valid"])

    def test_omissions_nonfinite_json_and_invalid_utf8_are_explicit_partial_diagnostics(self):
        omission = {"schema": PARSER.NATIVE_SCHEMA, "diagnostic_only": True,
                    "evidence_eligible": False, "event_omitted": True,
                    "omission_reason": "sensitive_value"}
        omitted = PARSER.parse_diagnostic_capture(capture([omission], omitted=1))
        self.assertEqual(omitted["omitted_events"], 1)
        self.assertFalse(omitted["capture_valid"])
        self.assertEqual(PARSER.parse_diagnostic_capture(b"\xff")["reasons"], ["invalid_utf8"])
        self.assertEqual(PARSER.parse_diagnostic_capture("\ud800")["reasons"], ["invalid_unicode"])
        nonfinite = capture([]).replace('"event_count": 0', '"event_count": NaN')
        self.assertFalse(PARSER.parse_diagnostic_capture(nonfinite)["capture_valid"])
        overflow = capture(valid_events()).replace('"summary": "sentinel"', '"summary": 1e400')
        self.assertFalse(PARSER.parse_diagnostic_capture(overflow)["capture_valid"])

    def test_opaque_payload_policy_is_explicit_and_unknown_policy_is_invalid(self):
        omitted = {"schema": PARSER.NATIVE_SCHEMA, "diagnostic_only": True,
                   "evidence_eligible": False, "event_omitted": True,
                   "omission_reason": "opaque_payload_unverified"}
        ordinary = PARSER.parse_diagnostic_capture(capture(
            [omitted], omitted=1, payload_policy="omit-opaque-payloads/v1"
        ))
        self.assertEqual(ordinary["payload_policy"], "omit-opaque-payloads/v1")
        self.assertFalse(ordinary["capture_valid"])
        raw_payload = PARSER.parse_diagnostic_capture(capture(
            [valid_events()[0]], payload_policy="omit-opaque-payloads/v1"
        ))
        self.assertFalse(raw_payload["capture_valid"])
        self.assertIn("opaque_payload_persisted_under_omit_policy", raw_payload["reasons"])
        invalid = PARSER.parse_diagnostic_capture(capture([valid_events()[0]], payload_policy="waive-redaction"))
        self.assertFalse(invalid["capture_valid"])

    def test_deeply_nested_json_fails_closed_without_aborting_attached_result(self):
        deep_event = valid_events()[0]
        value = "leaf"
        for _ in range(PARSER.MAX_JSON_DEPTH + 10):
            value = {"nested": value}
        deep_event["event"]["input"] = {"state": "available", "value": value}
        raw = capture([deep_event])
        parsed = PARSER.parse_diagnostic_capture(raw)
        self.assertFalse(parsed["capture_valid"])
        self.assertEqual(parsed["reasons"], ["nonfinite_or_nonjson_value"])

        with patch.dict("os.environ", {"OPENCODE_EVAL_NORMAL_OBSERVATIONS": "1"}):
            _temp, target, _judge = RUN.setup_projects(
                {"id": "DEEP-JSON", "agent": "general", "execution": "runtime"}
            )
            try:
                (target / RUN.NORMAL_INVOKE_OBSERVER_FILENAME).write_text(raw, encoding="utf-8")
                result = RUN.attach_observer_capture({"exit_code": 0, "text": "kept"}, target, [])
                self.assertEqual(result["exit_code"], 0)
                self.assertEqual(result["text"], "kept")
                self.assertFalse(result["normal_invoke_diagnostic"]["capture_valid"])
            finally:
                shutil.rmtree(_temp, ignore_errors=True)

    def test_missing_footer_bad_count_truncation_and_oversize_fail_closed(self):
        valid = capture([])
        cases = [valid.splitlines()[0], valid.replace('"event_count": 0', '"event_count": 1'),
                 valid[:-2], "x" * (PARSER.MAX_BYTES + 1)]
        for raw in cases:
            with self.subTest(size=len(raw)):
                parsed = PARSER.parse_diagnostic_capture(raw)
                self.assertFalse(parsed["capture_valid"])
                self.assertEqual(parsed["events"], [])

    def test_unknown_non_string_schema_and_invalid_utf8_do_not_abort_existing_result(self):
        with patch.dict("os.environ", {"OPENCODE_EVAL_NORMAL_OBSERVATIONS": "1"}):
            _temp, target, _judge = RUN.setup_projects(
                {"id": "INVALID-UTF8", "agent": "general", "execution": "runtime"}
            )
            try:
                (target / RUN.NORMAL_INVOKE_OBSERVER_FILENAME).write_bytes(b"\xff\xfe")
                result = RUN.attach_observer_capture({"exit_code": 0, "text": "kept"}, target, [])
                self.assertEqual(result["exit_code"], 0)
                self.assertEqual(result["text"], "kept")
                self.assertFalse(result["normal_invoke_diagnostic"]["capture_valid"])
                self.assertEqual(result["normal_invoke_diagnostic"]["reasons"], ["invalid_utf8"])
            finally:
                shutil.rmtree(_temp, ignore_errors=True)

    def test_sensitive_values_are_collected_for_pre_persist_redaction(self):
        with tempfile.TemporaryDirectory(prefix="loom-observer-secret-test-") as directory:
            config = Path(directory) / "config.json"
            auth = Path(directory) / "auth.json"
            config.write_text(json.dumps({"credential": "config-only-synthetic-secret"}), encoding="utf-8")
            auth.write_text(json.dumps({"providers": {"fixture": {"api_key": "seeded-auth-key"}}}), encoding="utf-8")
            secrets = RUN.collect_sensitive_values(
                {"SHORT_TOKEN": "xy"}, ["SHORT_TOKEN"], auth, config, None, None
            )

        self.assertIn("xy", secrets)
        self.assertIn("seeded-auth-key", secrets)
        self.assertIn("config-only-synthetic-secret", secrets)
        self.assertIn("config-only-synthetic-secret", RUN.sensitive_text_variants("config-only-synthetic-secret"))

    def test_opt_in_launcher_copies_observer_and_projection_never_scores(self):
        with patch.dict(
            "os.environ", {"OPENCODE_EVAL_NORMAL_OBSERVATIONS": "1"}
        ):
            _temp, target, _judge = RUN.setup_projects(
                {"id": "NORMAL-OBSERVATION", "agent": "general", "execution": "runtime"}
            )
            try:
                plugin = target / ".opencode" / "plugins" / "loom-normal-invoke-observer.ts"
                self.assertTrue(plugin.is_file())
                self.assertFalse((target / ".opencode" / "plugins" / "eval-tool-observer.ts").exists())
                records = valid_events()
                capture_path = target / RUN.NORMAL_INVOKE_OBSERVER_FILENAME
                capture_path.write_text(capture(records), encoding="utf-8")

                projection = RUN.attach_observer_capture({}, target, [])
                diagnostic = projection["normal_invoke_diagnostic"]

                self.assertTrue(diagnostic["capture_valid"])
                self.assertFalse(diagnostic["evidence_eligible"])
                self.assertFalse(diagnostic["runwide_complete"])
                self.assertFalse(RUN.nested_tool_capture_complete(diagnostic))
                self.assertEqual(RUN.tool_result_actions(diagnostic), [])
            finally:
                shutil.rmtree(_temp, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
