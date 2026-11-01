"""Source-modeled 2.2.0 host-hook counterexamples for issue #205.

These are deterministic impossibility witnesses, not live host/provider tests.
Only the documented public callback fields are observable; _ fields model
private host facts and must not be used for Loom quota accounting.
"""
from __future__ import annotations

import copy
import unittest

MODEL = {"providerID": "example", "id": "same-model"}
PUBLIC = {
    "model.request": ("sessionID", "agent", "model", "kind"),
    "retry": ("sessionID", "agent", "model", "error", "attempt", "decision"),
    "connection.active": ("providerID", "connection"),  # separate plugin lookup, not a native request hook
    "session.execution.succeeded": ("sessionID",),
    "session.execution.failed": ("sessionID", "error"),
    "session.execution.interrupted": ("sessionID", "reason"),
    "session.step.started": ("sessionID", "assistantMessageID", "agent", "model", "started"),
    "session.step.ended": ("sessionID", "assistantMessageID", "finish", "tokens", "cost"),
    "http.request": ("sessionID", "agent", "model", "kind", "requestRef"),
    "http.response": ("sessionID", "agent", "model", "kind", "requestRef", "status"),
}


def event(type_: str, **fields: object) -> dict:
    return {"type": type_, **fields}


def request(id_: str, account: str, kind: str = "primary") -> dict:
    return event("model.request", sessionID="ses-1", agent="general", model=MODEL,
                 kind=kind, _requestID=id_, _accountID=account)


def quota_retry(origin: str) -> dict:
    return event("retry", sessionID="ses-1", agent="general", model=MODEL,
                 error={"type": "provider.quota", "status": 429}, attempt=1,
                 decision={"retry": True, "delay": 0}, _requestID=origin)


def observable(trace: list[dict]) -> list[dict]:
    """Project exactly the fields relevant to these public 2.2.0 callback shapes."""
    return [dict(type=e["type"], **{field: copy.deepcopy(e[field]) for field in PUBLIC[e["type"]]
                                    if field in e}) for e in trace]


def owner_account(trace: list[dict]) -> str:
    owners = {e["_requestID"]: e["_accountID"] for e in trace
              if e["type"] == "model.request"}
    return owners[trace[-1]["_requestID"]]


class NativeIdentityWitnesses(unittest.TestCase):
    def assert_indistinguishable(self, left: list[dict], right: list[dict]) -> None:
        self.assertEqual(observable(left), observable(right))

    def test_late_compaction_retry_and_new_primary_have_identical_public_events(self):
        prefix = [request("aux", "B", "compaction"), request("primary", "A")]
        old_auxiliary = prefix + [quota_retry("aux")]
        new_primary = prefix + [quota_retry("primary")]
        self.assert_indistinguishable(old_auxiliary, new_primary)
        self.assertEqual(owner_account(old_auxiliary), "B")
        self.assertEqual(owner_account(new_primary), "A")
        # Deliberately failing *policy*: "charge the latest primary" poisons A
        # when the failure actually came from B. The test must stay green as a
        # counterexample, never enable the policy.
        latest_primary = next(e["_accountID"] for e in reversed(prefix) if e["kind"] == "primary")
        self.assertNotEqual(latest_primary, owner_account(old_auxiliary))

    def test_two_same_session_primary_attempts_cannot_be_distinguished_by_attempt_number(self):
        prefix = [request("first", "A"), request("second", "B")]
        old = prefix + [quota_retry("first")]
        new = prefix + [quota_retry("second")]
        self.assert_indistinguishable(old, new)
        self.assertNotEqual(owner_account(old), owner_account(new))
        # The candidate adapter blocks changing primary account; this witness
        # describes what an unqualified native host must NOT be trusted to do.

    def test_active_connection_lookup_does_not_bind_native_transport(self):
        prefix = [event("connection.active", providerID="example",
                        connection={"type": "credential", "id": "A"})]
        old = prefix + [request("r1", "A"), quota_retry("r1")]
        raced = prefix + [request("r1", "B"), quota_retry("r1")]
        self.assert_indistinguishable(old, raced)
        self.assertEqual(owner_account(old), "A")
        self.assertEqual(owner_account(raced), "B")
        # Resolver may have captured B before plugin active() sampled A;
        # no callback exposes which resolved credential was actually used.

    def test_execution_terminal_event_does_not_identify_newer_request(self):
        prefix = [request("old", "A"), request("new", "B")]
        old = prefix + [event("session.execution.succeeded", sessionID="ses-1", _requestID="old")]
        new = prefix + [event("session.execution.succeeded", sessionID="ses-1", _requestID="new")]
        self.assert_indistinguishable(old, new)
        self.assertNotEqual(old[-1]["_requestID"], new[-1]["_requestID"])

    def test_tool_continuation_step_id_is_not_a_retry_request_id(self):
        prefix = [request("before-tool", "A"),
                  event("session.step.started", sessionID="ses-1", assistantMessageID="msg-1",
                        agent="general", model=MODEL, started=100),
                  event("session.step.ended", sessionID="ses-1", assistantMessageID="msg-1",
                        finish="tool-calls", tokens={}, cost=0),
                  request("after-tool", "A")]
        old = prefix + [quota_retry("before-tool")]
        new = prefix + [quota_retry("after-tool")]
        self.assert_indistinguishable(old, new)
        self.assertEqual(old[-1]["attempt"], new[-1]["attempt"])

    def test_cancellation_does_not_prove_which_request_settled(self):
        prefix = [request("old", "A"), request("new", "B")]
        old = prefix + [event("session.execution.interrupted", sessionID="ses-1",
                              reason="user", _requestID="old")]
        new = prefix + [event("session.execution.interrupted", sessionID="ses-1",
                              reason="user", _requestID="new")]
        self.assert_indistinguishable(old, new)
        self.assertNotEqual(old[-1]["_requestID"], new[-1]["_requestID"])

    def test_restart_with_no_matching_dispatch_must_not_record_failure(self):
        # A new plugin process sees this retry but has no prior native permit.
        observed = observable([quota_retry("before-restart")])
        self.assertEqual(observed[0]["type"], "retry")
        self.assertFalse(any(e["type"] == "model.request" for e in observed))

    def test_http_response_headers_are_not_completed_stream_or_account_proof(self):
        # The request object can be shared inside one HTTP call, but contains
        # no stable credential metadata, nor does 200 prove body/stream success.
        partial = [request("r1", "A"),
                   event("http.request", sessionID="ses-1", agent="general",
                         model=MODEL, kind="primary", requestRef="request-object-1"),
                   event("http.response", sessionID="ses-1", agent="general",
                         model=MODEL, kind="primary", requestRef="request-object-1", status=200)]
        self.assertEqual(observable(partial)[-2]["requestRef"],
                         observable(partial)[-1]["requestRef"])
        self.assertFalse(any(e["type"] in ("session.step.ended", "session.execution.succeeded")
                             for e in observable(partial)))


if __name__ == "__main__":
    unittest.main()
