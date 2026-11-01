"""Source-modeled callback ambiguity witnesses for OpenCode 2.2.0.

These are NOT installed-host traces or tests of Loom's SQLite quota adapter.
They project public tagged-2.2.0 plugin fields, with private _ fields used
only to construct two different possible hidden native histories. The HTTP
Request/Response stand-ins below preserve their actual field names.
"""
from __future__ import annotations

import unittest

MODEL = {"providerID": "example", "id": "same-model"}
FIRST_RETRY_ORDINAL = 2  # ModelRetry.policy starts at 1, increments before publishing.

PUBLIC = {
    "model.request": ("sessionID", "agent", "model", "kind"),
    "retry": ("sessionID", "agent", "model", "error", "attempt", "decision"),
    "connection.active": ("providerID", "connection"),  # independent plugin lookup
    "session.execution.succeeded": ("sessionID",),
    "session.execution.failed": ("sessionID", "error"),
    "session.execution.interrupted": ("sessionID", "reason"),
    "session.step.started": ("sessionID", "assistantMessageID", "agent", "model", "started"),
    "session.step.streamed": ("sessionID", "assistantMessageID"),
    "session.step.ended": ("sessionID", "assistantMessageID", "finish", "tokens", "cost"),
    "session.step.failed": ("sessionID", "assistantMessageID", "error"),
    "http.request": ("sessionID", "agent", "model", "kind", "request"),
    "http.response": ("sessionID", "agent", "model", "kind", "request", "response"),
}


class RequestStandIn:
    """Only represents native Web Request *object identity*, not HTTP behavior."""


class ResponseStandIn:
    """Represents the native Web Response object's status field, not a stream result."""

    def __init__(self, status: int):
        self.status = status


def event(type_: str, **fields: object) -> dict:
    return {"type": type_, **fields}


def request(id_: str, account: str, kind: str = "primary") -> dict:
    return event("model.request", sessionID="ses-1", agent="general", model=MODEL,
                 kind=kind, _requestID=id_, _accountID=account)


def quota_retry(origin: str) -> dict:
    return event("retry", sessionID="ses-1", agent="general", model=MODEL,
                 error={"type": "provider.quota", "status": 429},
                 attempt=FIRST_RETRY_ORDINAL,
                 decision={"retry": True, "delay": 0}, _requestID=origin)


def observable(trace: list[dict]) -> list[dict]:
    """Drop private fixture ownership facts; leave public Request object identity intact."""
    return [dict(type=e["type"], **{name: e[name] for name in PUBLIC[e["type"]] if name in e})
            for e in trace]


def owner_account(trace: list[dict]) -> str:
    owners = {e["_requestID"]: e["_accountID"] for e in trace if e["type"] == "model.request"}
    return owners[trace[-1]["_requestID"]]


class NativeIdentityWitnesses(unittest.TestCase):
    def assert_indistinguishable(self, left: list[dict], right: list[dict]) -> None:
        self.assertEqual(observable(left), observable(right))

    def test_delayed_compaction_vs_new_primary_are_observationally_identical(self):
        prefix = [request("aux", "B", "compaction"), request("primary", "A")]
        from_aux = prefix + [quota_retry("aux")]
        from_primary = prefix + [quota_retry("primary")]
        self.assert_indistinguishable(from_aux, from_primary)
        self.assertEqual(owner_account(from_aux), "B")
        self.assertEqual(owner_account(from_primary), "A")
        self.assertEqual(from_aux[-1]["attempt"], 2)
        latest_primary = next(e["_accountID"] for e in reversed(prefix) if e["kind"] == "primary")
        self.assertNotEqual(latest_primary, owner_account(from_aux))

    def test_same_retry_ordinal_does_not_distinguish_primary_calls(self):
        prefix = [request("first", "A"), request("second", "B")]
        from_first = prefix + [quota_retry("first")]
        from_second = prefix + [quota_retry("second")]
        self.assert_indistinguishable(from_first, from_second)
        self.assertEqual(from_first[-1]["attempt"], FIRST_RETRY_ORDINAL)
        self.assertNotEqual(owner_account(from_first), owner_account(from_second))
        # This models unqualified host behavior; the Loom candidate already rejects
        # a different primary account while a same-Session route is pinned.

    def test_active_credential_record_does_not_bind_native_transport(self):
        prefix = [event("connection.active", providerID="example",
                        connection={"type": "credential", "id": "record-1"})]
        from_a = prefix + [request("r1", "A"), quota_retry("r1")]
        from_b = prefix + [request("r1", "B"), quota_retry("r1")]
        self.assert_indistinguishable(from_a, from_b)
        self.assertEqual(owner_account(from_a), "A")
        self.assertEqual(owner_account(from_b), "B")

    def test_late_session_execution_terminal_cannot_settle_a_specific_request(self):
        prefix = [request("old", "A"), request("new", "B")]
        first = prefix + [event("session.execution.succeeded", sessionID="ses-1", _requestID="old")]
        second = prefix + [event("session.execution.succeeded", sessionID="ses-1", _requestID="new")]
        self.assert_indistinguishable(first, second)
        self.assertNotEqual(first[-1]["_requestID"], second[-1]["_requestID"])

    def test_assistant_step_message_id_is_not_a_transport_attempt_id(self):
        prefix = [
            request("before-tool", "A"),
            event("session.step.started", sessionID="ses-1", assistantMessageID="msg-1",
                  agent="general", model=MODEL, started=100),
            event("session.step.ended", sessionID="ses-1", assistantMessageID="msg-1",
                  finish="tool-calls", tokens={}, cost=0),
            request("after-tool", "A"),
        ]
        before = prefix + [quota_retry("before-tool")]
        after = prefix + [quota_retry("after-tool")]
        self.assert_indistinguishable(before, after)
        self.assertEqual(before[-1]["attempt"], after[-1]["attempt"])

    def test_cancellation_terminal_does_not_name_failed_attempt(self):
        prefix = [request("old", "A"), request("new", "B")]
        old = prefix + [event("session.execution.interrupted", sessionID="ses-1",
                              reason="user", _requestID="old")]
        new = prefix + [event("session.execution.interrupted", sessionID="ses-1",
                              reason="user", _requestID="new")]
        self.assert_indistinguishable(old, new)
        self.assertNotEqual(old[-1]["_requestID"], new[-1]["_requestID"])

    def test_restart_drops_local_attribution_of_a_previously_sent_request(self):
        before_restart = [request("old", "A"), quota_retry("old")]
        # A newly initialized plugin has no earlier pending reservation/attempt ID.
        after_restart = observable(before_restart[1:])
        self.assertEqual(after_restart[0]["type"], "retry")
        self.assertEqual(after_restart[0]["attempt"], FIRST_RETRY_ORDINAL)
        self.assertFalse(any(item["type"] == "model.request" for item in after_restart))
        # A late callback cannot be tied to A by this *public* trace alone.
        self.assertEqual(len(observable(before_restart)), 2)

    def test_http_200_can_precede_both_finished_and_failed_model_stream(self):
        req = RequestStandIn()
        headers = [
            request("r1", "A"),
            event("http.request", sessionID="ses-1", agent="general",
                  model=MODEL, kind="primary", request=req),
            event("http.response", sessionID="ses-1", agent="general",
                  model=MODEL, kind="primary", request=req, response=ResponseStandIn(200)),
        ]
        finished = headers + [
            event("session.step.streamed", sessionID="ses-1", assistantMessageID="msg-1"),
            event("session.step.ended", sessionID="ses-1", assistantMessageID="msg-1",
                  finish="stop", tokens={}, cost=0),
        ]
        failed = headers + [
            event("session.step.failed", sessionID="ses-1", assistantMessageID="msg-1",
                  error={"type": "provider.error", "status": 502}),
        ]
        visible_headers = observable(headers)
        self.assertEqual(visible_headers, observable(finished)[:len(headers)])
        self.assertEqual(visible_headers, observable(failed)[:len(headers)])
        self.assertIs(visible_headers[1]["request"], visible_headers[2]["request"])
        self.assertEqual(visible_headers[2]["response"].status, 200)
        self.assertEqual(finished[-1]["type"], "session.step.ended")
        self.assertEqual(failed[-1]["type"], "session.step.failed")
        # Neither response status nor Session step event carries a native
        # request/attempt ID or independently confirmed effective billing account.
        self.assertNotIn("attemptID", visible_headers[2])
        self.assertNotIn("billingAccount", visible_headers[2])


if __name__ == "__main__":
    unittest.main()
