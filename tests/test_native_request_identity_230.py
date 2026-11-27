"""OpenCode 2.3.0 source-modeled request/attempt identity counterexamples.

Five cases are source-modeled, not installed-host tests or billing receipts.
Two additional checks replay retained native evidence and compare the modeled
hook fields with the exact installed SDK. No new native host runs here.
Hidden _attempt/_account annotations construct two plausible native histories
with identical public observations. See docs/architecture/qualification/native-attempt-qualification-205.md.
"""
from __future__ import annotations

import hashlib
import json
import re
import unittest
from collections import Counter
from pathlib import Path

REPOSITORY = Path(__file__).resolve().parents[1]

MODEL = {"providerID": "request-local", "id": "fast", "variant": "medium"}
PUBLIC = {
    "experimental.model.resolve": ("sessionID", "agent", "kind", "model"),
    "model.request": ("sessionID", "agent", "kind", "model", "baseURL", "headers"),
    "retry": ("sessionID", "agent", "model", "error", "attempt", "decision"),
    "http.request": ("sessionID", "agent", "kind", "model", "request"),
    "http.response": ("sessionID", "agent", "kind", "model", "request", "response"),
    "experimental.ws.handshake": ("sessionID", "agent", "kind", "model", "url", "headers"),
    "experimental.ws.send": ("sessionID", "agent", "kind", "model", "frame"),
    # Session bus events below are projections for the modeled counterexample,
    # not a claim to enumerate their complete native schemas.
    "session.execution.succeeded": ("sessionID",),
    "session.execution.interrupted": ("sessionID", "reason"),
}


def row(event: str, **values: object) -> dict:
    return {"event": event, **values}


def visible(events: list[dict]) -> list[dict]:
    return [
        {"event": e["event"], **{key: e[key] for key in PUBLIC[e["event"]] if key in e}}
        for e in events
    ]


def prepared(kind: str = "primary", *, account: str = "A") -> list[dict]:
    return [
        row("experimental.model.resolve", sessionID="s", agent="architect", kind=kind, model=MODEL),
        row("model.request", sessionID="s", agent="architect", kind=kind, model=MODEL,
            baseURL="http://127.0.0.1/fixture", headers={}, _account=account),
    ]


def retry(origin: str) -> dict:
    return row("retry", sessionID="s", agent="architect", model=MODEL,
               error={"type": "provider.error", "message": "503 retryable"}, attempt=2,
               decision={"retry": True, "delay": 1}, _attempt=origin)


class Tagged230AttemptWitnesses(unittest.TestCase):
    def test_retained_native_generate_trace_has_no_session_retry_callback(self):
        """Replay prior CI evidence; this is not a new host/account qualification."""
        evidence = json.loads((REPOSITORY / "docs/architecture/qualification/native-request-identity-230-evidence.json").read_text())
        excerpt = next(item for item in evidence["prior_installed_evidence"]["retry_excerpts"]
                       if item["case"] == "native-generate-prepared-retry")
        events = [item["event"] for item in excerpt["events"]]
        original_lines = "".join(json.dumps(event, sort_keys=True) + "\n" for event in events).encode()
        self.assertEqual(hashlib.sha256(original_lines).hexdigest(), excerpt["source_lines_sha256"])
        self.assertEqual([item["source_line"] for item in excerpt["events"]], excerpt["source_trace_line_numbers"])
        counts = Counter(event["type"] for event in events)
        self.assertEqual(counts["resolve-input"], 1)
        self.assertEqual(counts["request-input"], 1)
        self.assertEqual(counts["request-approved"], 1)
        self.assertEqual(counts["transport"], 2)
        self.assertEqual(counts["retry"], 0)

    def test_two_effective_accounts_are_indistinguishable_to_request_and_retry_hooks(self):
        before = prepared(account="A")
        one = before + [retry("send-1")]
        two = [*prepared(account="B"), retry("send-2")]
        self.assertEqual(visible(one), visible(two))
        self.assertNotEqual(one[1]["_account"], two[1]["_account"])
        self.assertNotEqual(one[-1]["_attempt"], two[-1]["_attempt"])

    def test_retry_ordinal_cannot_identify_current_kind_or_physical_attempt(self):
        a = prepared("compaction") + [retry("compaction-1")]
        b = prepared("compaction") + [retry("compaction-2")]
        self.assertEqual(visible(a), visible(b))
        self.assertNotIn("kind", visible(a)[-1])
        self.assertNotIn("attemptID", visible(a)[-1])
        self.assertEqual(a[-1]["attempt"], 2)

    def test_http_request_object_is_only_local_to_request_and_response_hooks(self):
        request = object()
        http = [
            row("http.request", sessionID="s", agent="architect", kind="primary",
                model=MODEL, request=request, _attempt="a", _account="A"),
            row("http.response", sessionID="s", agent="architect", kind="primary",
                model=MODEL, request=request, response={"status": 200}, _attempt="a"),
        ]
        self.assertIs(http[0]["request"], http[1]["request"])
        self.assertNotIn("attemptID", visible(http)[0])
        self.assertNotIn("billingPrincipal", visible(http)[1])
        self.assertEqual(visible(http)[1]["response"]["status"], 200)
        # The HTTP header can precede both a successful or a failed streamed body.
        self.assertIs(http[1]["request"], http[0]["request"])

    def test_websocket_frame_and_handshake_fields_do_not_bind_billing_principal(self):
        ws = [
            row("experimental.ws.handshake", sessionID="s", agent="architect",
                kind="primary", model=MODEL, url="wss://fixture.invalid", headers={},
                _credentialRevision="r1", _account="A"),
            row("experimental.ws.send", sessionID="s", agent="architect",
                kind="primary", model=MODEL, frame='{"type":"response"}',
                _credentialRevision="r2", _account="B"),
        ]
        for event in visible(ws):
            self.assertNotIn("attemptID", event)
            self.assertNotIn("billingPrincipal", event)
            self.assertNotIn("credentialRevision", event)

    def test_session_terminal_does_not_settle_one_of_two_prepared_sends(self):
        prefix = prepared()
        old = prefix + [row("session.execution.interrupted", sessionID="s", reason="user", _attempt="a")]
        new = prefix + [row("session.execution.interrupted", sessionID="s", reason="user", _attempt="b")]
        self.assertEqual(visible(old), visible(new))
        self.assertNotEqual(old[-1]["_attempt"], new[-1]["_attempt"])

    def test_modeled_hook_fields_match_the_exact_installed_sdk(self):
        """Check actual declarations, not absence from our own projection table."""
        sdk = REPOSITORY / "node_modules/@opencode/plugin"
        self.assertEqual(json.loads((sdk / "package.json").read_text())["version"], "2.3.0")
        declarations = (sdk / "dist/promise/session.d.ts").read_text()
        interfaces = {
            "experimental.model.resolve": "SessionModelResolve",
            "model.request": "SessionModelRequest",
            "retry": "SessionRetry",
            "http.request": "SessionHttpRequest",
            "http.response": "SessionHttpResponse",
            "experimental.ws.handshake": "SessionWebSocketHandshake",
            "experimental.ws.send": "SessionWebSocketSend",
        }
        for event, interface in interfaces.items():
            with self.subTest(event=event):
                block = re.search(r"export interface " + interface + r" \{(.*?)^\}",
                                  declarations, re.MULTILINE | re.DOTALL)
                self.assertIsNotNone(block, interface)
                fields = re.findall(r"^\s*(?:readonly\s+)?(\w+)\??\s*:", block.group(1), re.MULTILINE)
                self.assertEqual(set(fields), set(PUBLIC[event]))


if __name__ == "__main__":
    unittest.main()
