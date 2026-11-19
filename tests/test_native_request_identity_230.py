"""OpenCode 2.3.0 source-modeled request/attempt identity counterexamples.

These are intentionally NOT installed-host tests or provider billing receipts.
The public field sets are copied from tagged v2.3.0 session plugin types.
Hidden _attempt/_account annotations construct two plausible native histories
with identical public observations. See docs/native-attempt-qualification-205.md.
"""
from __future__ import annotations

import unittest

MODEL = {"providerID": "request-local", "id": "fast", "variant": "medium"}
PUBLIC = {
    "experimental.model.resolve": ("sessionID", "agent", "kind", "model"),
    "model.request": ("sessionID", "agent", "kind", "model", "baseURL", "headers"),
    "retry": ("sessionID", "agent", "model", "error", "attempt", "decision"),
    "http.request": ("sessionID", "agent", "kind", "model", "request"),
    "http.response": ("sessionID", "agent", "kind", "model", "request", "response"),
    "experimental.ws.handshake": ("sessionID", "agent", "kind", "model", "url", "headers"),
    "experimental.ws.send": ("sessionID", "agent", "kind", "model", "frame"),
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


def prepared(kind: str = "generate", *, account: str = "A") -> list[dict]:
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
    def test_generate_prepared_retry_has_one_public_model_request_for_two_private_sends(self):
        """This source-modeled send path matches the counts measured in #243's installed host."""
        public = prepared()
        underlying = [
            row("private-send", _attempt="send-1", _account="A"),
            retry("send-1"),
            row("private-send", _attempt="send-2", _account="B"),
        ]
        self.assertEqual(len([e for e in public if e["event"] == "model.request"]), 1)
        self.assertEqual(len([e for e in underlying if e["event"] == "private-send"]), 2)
        self.assertNotIn("attemptID", visible(public)[1])
        self.assertNotIn("accountID", visible(public)[1])

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

    def test_explicit_absence_of_transport_account_fields_in_tagged_public_hooks(self):
        for event, names in PUBLIC.items():
            self.assertNotIn("effectiveBillingAccount", names, event)
            self.assertNotIn("attemptID", names, event)
            self.assertNotIn("credentialRevision", names, event)


if __name__ == "__main__":
    unittest.main()
