"""The trace oracle must reject intentionally corrupt installed-host traces."""
from __future__ import annotations

import unittest

from routing_acceptance_oracle import (
    expect_transport, expect_blocked, expect_single_native_tool,
    expect_failed_local_provider, run_mutation_controls,
)


class RoutingAcceptanceOracleTest(unittest.TestCase):
    def test_paid_transport_leak_is_rejected(self):
        with self.assertRaises(AssertionError):
            expect_blocked([{"type": "provider-request", "data": {"providerID": "route-metered"}}])

    def test_wrong_route_is_rejected_even_if_request_count_matches(self):
        with self.assertRaises(AssertionError):
            expect_transport([{"type": "provider-request", "data": {"providerID": "route-secondary", "modelID": "sol"}}],
                             "route-primary")

    def test_duplicate_tool_is_rejected(self):
        events = [
            {"type": "provider-request", "data": {"providerID": "route-primary", "modelID": "sol", "afterTool": False}},
            *[{"type": "tool-before", "data": {"tool": "execute", "sessionID": "s"}}] * 2,
            {"type": "tool-after", "data": {"tool": "execute", "sessionID": "s", "status": "completed"}},
            {"type": "provider-request", "data": {"providerID": "route-primary", "modelID": "sol", "afterTool": True}},
        ]
        with self.assertRaises(AssertionError):
            expect_single_native_tool(events, "route-primary")

    def test_wrong_continuation_provider_is_rejected(self):
        events = [
            {"type": "provider-request", "data": {"providerID": "route-primary", "modelID": "sol", "afterTool": False}},
            {"type": "tool-before", "data": {"tool": "execute", "sessionID": "s"}},
            {"type": "tool-after", "data": {"tool": "execute", "sessionID": "s", "status": "completed"}},
            {"type": "provider-request", "data": {"providerID": "route-metered", "modelID": "sol", "afterTool": True}},
        ]
        with self.assertRaises(AssertionError):
            expect_single_native_tool(events, "route-primary")

    def test_provider_error_after_tool_requires_same_route_and_one_tool(self):
        trace = [
            {"type": "provider-request", "data": {"providerID": "route-primary", "modelID": "sol", "afterTool": False}},
            {"type": "tool-before", "data": {"sessionID": "s", "tool": "execute"}},
            {"type": "tool-after", "data": {"sessionID": "s", "tool": "execute", "status": "completed"}},
            {"type": "provider-request", "data": {"providerID": "route-primary", "modelID": "sol", "afterTool": True}},
        ]
        expect_failed_local_provider(trace, "route-primary", after_tool=True)
        with self.assertRaises(AssertionError):
            expect_failed_local_provider(trace + [trace[1]], "route-primary", after_tool=True)
        with self.assertRaises(AssertionError):
            expect_failed_local_provider(trace[:-1] + [{"type": "provider-request",
                "data": {"providerID": "route-metered", "modelID": "sol", "afterTool": True}}],
                "route-primary", after_tool=True)

    def test_wrong_continuation_model_is_rejected_even_on_same_provider(self):
        events = [
            {"type": "provider-request", "data": {"providerID": "route-primary",
                "modelID": "sol", "afterTool": False}},
            {"type": "tool-before", "data": {"sessionID": "s", "tool": "execute"}},
            {"type": "tool-after", "data": {"sessionID": "s", "tool": "execute", "status": "completed"}},
            {"type": "provider-request", "data": {"providerID": "route-primary",
                "modelID": "astra", "afterTool": True}},
        ]
        with self.assertRaises(AssertionError):
            expect_single_native_tool(events, "route-primary")

    def test_mutation_controls_must_all_reject_counterexamples(self):
        proof = run_mutation_controls()
        self.assertEqual(proof["status"], "PASS")
        self.assertEqual(len(proof["cases"]), 5)


if __name__ == "__main__":
    unittest.main()
