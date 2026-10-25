"""The trace oracle must reject intentionally corrupt installed-host traces."""
from __future__ import annotations

import unittest

from routing_acceptance_oracle import (
    expect_transport, expect_blocked, expect_single_native_tool, run_mutation_controls,
)


class RoutingAcceptanceOracleTest(unittest.TestCase):
    def test_paid_transport_leak_is_rejected(self):
        with self.assertRaises(AssertionError):
            expect_blocked([{"type": "provider-request", "data": {"providerID": "route-metered"}}])

    def test_wrong_route_is_rejected_even_if_request_count_matches(self):
        with self.assertRaises(AssertionError):
            expect_transport([{"type": "provider-request", "data": {"providerID": "route-secondary"}}],
                             "route-primary")

    def test_duplicate_tool_is_rejected(self):
        events = [
            {"type": "provider-request", "data": {"providerID": "route-primary", "afterTool": False}},
            *[{"type": "tool-before", "data": {"tool": "execute", "sessionID": "s"}}] * 2,
            {"type": "tool-after", "data": {"tool": "execute", "sessionID": "s", "status": "completed"}},
            {"type": "provider-request", "data": {"providerID": "route-primary", "afterTool": True}},
        ]
        with self.assertRaises(AssertionError):
            expect_single_native_tool(events, "route-primary")

    def test_wrong_continuation_provider_is_rejected(self):
        events = [
            {"type": "provider-request", "data": {"providerID": "route-primary", "afterTool": False}},
            {"type": "tool-before", "data": {"tool": "execute", "sessionID": "s"}},
            {"type": "tool-after", "data": {"tool": "execute", "sessionID": "s", "status": "completed"}},
            {"type": "provider-request", "data": {"providerID": "route-metered", "afterTool": True}},
        ]
        with self.assertRaises(AssertionError):
            expect_single_native_tool(events, "route-primary")

    def test_mutation_controls_must_all_reject_counterexamples(self):
        proof = run_mutation_controls()
        self.assertEqual(proof["status"], "PASS")
        self.assertEqual(len(proof["cases"]), 4)


if __name__ == "__main__":
    unittest.main()
