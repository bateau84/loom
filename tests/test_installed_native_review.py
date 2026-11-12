"""Oracle tests only: synthetic traces never qualify an installed host."""
import copy
import argparse
import json
import tempfile
import unittest
from pathlib import Path

from native_review_oracle import dispatch_receipts, source_basis


def dispatch_trace():
    source = {"sessionID": "parent", "messageID": "message", "id": "call",
              "agent": "general", "tool": "subagent", "input": {"prompt": "review"}}
    return [
        {"type": "tool-before", "data": source},
        {"type": "tool-after", "data": {**source, "status": "completed",
            "result": {"output": {"sessionID": "child", "status": "completed"},
                       "metadata": {"sessionID": "child"}}}},
    ]


class NativeReviewOracleTest(unittest.TestCase):
    def test_dispatch_uses_native_call_and_result_without_inventing_admission(self):
        receipt, = dispatch_receipts(dispatch_trace())
        self.assertEqual(receipt["binding"], "observed")
        self.assertEqual(receipt["parent"], ["parent", "message", "call"])
        self.assertEqual(receipt["child_session_id"], "child")
        self.assertEqual(receipt["admission_binding"], "UNQUALIFIED")

    def test_missing_or_reused_keys_and_conflicting_child_cannot_be_joined(self):
        missing = dispatch_trace()
        for event in missing:
            del event["data"]["id"]
        duplicate = dispatch_trace()
        duplicate.insert(1, copy.deepcopy(duplicate[0]))
        conflicting = dispatch_trace()
        conflicting[1]["data"]["result"]["metadata"]["sessionID"] = "other-child"
        for observed in (missing, duplicate, conflicting):
            with self.subTest(observed=observed):
                self.assertTrue(all(row["binding"] != "observed" for row in dispatch_receipts(observed)))

    def test_wrong_call_or_actor_does_not_pair_identical_prompt_and_timing(self):
        for field in ("id", "agent", "messageID", "sessionID"):
            observed = dispatch_trace()
            observed[-1]["data"][field] = "other"
            with self.subTest(field=field):
                self.assertNotEqual(dispatch_receipts(observed)[0]["binding"], "observed")

    def test_citation_pointer_and_another_sessions_payload_do_not_prove_supply(self):
        observed = [
            {"type": "provider-request", "data": {"headers": {"x-opencode-session-id": "other"},
                "prompt": [{"role": "user", "content": "SOURCE_BYTES"}]}},
            {"type": "provider-request", "data": {"headers": {"x-opencode-session-id": "reviewer"},
                "prompt": [{"role": "user", "content": "manifest://evidence-a.txt"}]}},
            {"type": "context", "data": {"sessionID": "reviewer", "messages": ["SOURCE_BYTES"]}},
        ]
        basis = source_basis(observed, "reviewer", "evidence-a.txt", "SOURCE_BYTES")
        self.assertEqual(basis["supplied"], [])
        self.assertEqual(basis["retrieved"], [])
        self.assertEqual(basis["same_review_invocation"], "UNQUALIFIED")

    def test_actual_provider_bytes_and_completed_native_read_keep_separate_receipts(self):
        observed = [
            {"type": "provider-request", "data": {"headers": {"x-opencode-session-id": "reviewer"},
                "prompt": [{"role": "user", "content": "SOURCE_BYTES"}]}},
            {"type": "tool-after", "data": {"sessionID": "reviewer", "messageID": "m", "id": "c",
                "tool": "read", "input": {"path": "evidence-a.txt"}, "status": "completed",
                "result": {"content": [{"type": "text", "text": "SOURCE_BYTES"}]}}},
        ]
        basis = source_basis(observed, "reviewer", "evidence-a.txt", "SOURCE_BYTES")
        self.assertEqual(basis["supplied"], [1])
        self.assertEqual(basis["retrieved"], [{"receipt": 2, "call": ["reviewer", "m", "c"]}])
        observed[1]["data"]["status"] = "error"
        self.assertEqual(source_basis(observed, "reviewer", "evidence-a.txt", "SOURCE_BYTES")["retrieved"], [])

    def test_metadata_only_read_cannot_establish_retrieved_source_content(self):
        observed = [{"type": "tool-after", "data": {"sessionID": "reviewer", "messageID": "m", "id": "c",
            "tool": "read", "input": {"path": "evidence-a.txt"}, "status": "completed",
            "result": {"content": [{"type": "text", "text": "No content returned"}],
                       "metadata": {"debug": "SOURCE_BYTES"}}}}]
        self.assertEqual(source_basis(observed, "reviewer", "evidence-a.txt", "SOURCE_BYTES")["retrieved"], [])

    def test_provider_metadata_and_reviewer_assertions_do_not_become_source_supply(self):
        prompt = [{"role": "assistant", "content": [{"type": "text", "text": "SOURCE_BYTES"}]},
                  {"role": "user", "content": [{"type": "text", "text": "Only a pointer", "metadata": "SOURCE_BYTES"}]},
                  {"role": "tool", "content": [None, {"type": "tool-result", "output": None},
                      {"type": "tool-result", "output": {"type": "text", "value": "No source", "metadata": "SOURCE_BYTES"}}]}]
        event = {"type": "provider-request", "data": {"headers": {"x-opencode-session-id": "reviewer"}, "prompt": prompt}}
        self.assertEqual(source_basis([event], "reviewer", "evidence-a.txt", "SOURCE_BYTES")["supplied"], [])

    def test_unavailable_runtime_records_every_case_unqualified_and_no_native_pass(self):
        from installed_native_review import run
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "report"
            report = run(argparse.Namespace(repository=Path(__file__).resolve().parents[1],
                report_directory=output, opencode=None, plugin=None, artifact=None))
            self.assertEqual(report["status"], "UNQUALIFIED")
            self.assertEqual(report["execution_status"], "UNQUALIFIED")
            self.assertFalse(report["checks"])
            self.assertTrue(all(row["status"] == "UNQUALIFIED" for row in report["scenarios"].values()))
            self.assertEqual(json.loads((output / "report.json").read_text()), report)


if __name__ == "__main__":
    unittest.main()
