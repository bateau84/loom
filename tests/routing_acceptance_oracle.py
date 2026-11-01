"""Independent trace checks for the installed model-routing acceptance harness.

The oracles inspect provider transport and native tool hook observations.
They do not invoke the planner, quota manager, or adapter under test.
"""
from __future__ import annotations


def records(events, kind, *, provider=None):
    found = [event for event in events if event.get("type") == kind]
    if provider is not None:
        found = [event for event in found if event.get("data", {}).get("providerID") == provider]
    return found


def expect_transport(events, provider, count=1):
    calls = records(events, "provider-request")
    routes = [r["data"].get("providerID") for r in calls]
    if routes != [provider] * count:
        raise AssertionError(f"Expected {count} local requests to {provider}; actual providers: {routes}")
    return calls


def expect_blocked(events):
    calls = records(events, "provider-request")
    if calls:
        raise AssertionError("A protected request reached the local provider transport: " +
                             repr([r["data"].get("providerID") for r in calls]))
    if records(events, "tool-before"):
        raise AssertionError("A protected request executed a native tool")


def expect_single_native_tool(events, provider, model="sol"):
    requests = records(events, "provider-request")
    if len(requests) != 2 or any((r["data"].get("providerID"), r["data"].get("modelID")) !=
                                  (provider, model) for r in requests):
        raise AssertionError("Native tool continuation changed provider/model or made unexpected requests")
    if [bool(r["data"].get("afterTool")) for r in requests] != [False, True]:
        raise AssertionError("Native continuation did not provide a real tool result")
    before = [r for r in records(events, "tool-before") if r["data"].get("tool") == "execute"]
    after = [r for r in records(events, "tool-after") if r["data"].get("tool") == "execute"]
    if len(before) != 1 or len(after) != 1 or after[0]["data"].get("status") != "completed":
        raise AssertionError(f"Expected exactly one completed native execute, got {len(before)} before/{len(after)} after")
    if before[0]["data"].get("sessionID") != after[0]["data"].get("sessionID"):
        raise AssertionError("Tool hooks recorded different native Sessions")



def expect_failed_local_provider(events, provider, *, after_tool=False, model="sol"):
    """Provider faults must not change either provider or model or replay tools."""
    calls = records(events, "provider-request")
    if not calls or any((event["data"].get("providerID"), event["data"].get("modelID")) !=
                        (provider, model) for event in calls):
        raise AssertionError("Provider error caused an unexpected provider/model route")
    before = [event for event in records(events, "tool-before")
              if event["data"].get("tool") == "execute"]
    after = [event for event in records(events, "tool-after")
             if event["data"].get("tool") == "execute"]
    if after_tool:
        if len(before) != 1 or len(after) != 1 or after[0]["data"].get("status") != "completed":
            raise AssertionError("Provider failure replayed, skipped or duplicated the native tool")
        if len(calls) < 2 or calls[0]["data"].get("afterTool") or not all(
                e["data"].get("afterTool") for e in calls[1:]):
            raise AssertionError("Post-tool failure resumed without the native tool result")
    elif before or after:
        raise AssertionError("A provider error caused native tool execution")



def run_mutation_controls():
    """Each deliberate counterexample MUST be rejected by the same production oracle."""
    blocked = [{"type": "provider-request", "data": {"providerID": "route-metered", "modelID": "sol"}}]
    tool = [
        {"type": "provider-request", "data": {"providerID": "route-primary", "modelID": "sol", "afterTool": False}},
        {"type": "tool-before", "data": {"sessionID": "s", "tool": "execute"}},
        {"type": "tool-after", "data": {"sessionID": "s", "tool": "execute", "status": "completed"}},
        {"type": "provider-request", "data": {"providerID": "route-primary", "modelID": "sol", "afterTool": True}},
    ]
    def must_reject(fn, events):
        try:
            fn(events)
        except AssertionError:
            return
        raise AssertionError("Oracle accepted deliberate negative-control corruption")
    must_reject(expect_blocked, blocked)
    must_reject(lambda e: expect_single_native_tool(e, "route-primary"),
                tool + [tool[1], tool[2]])
    must_reject(lambda e: expect_single_native_tool(e, "route-primary"),
                tool[:3] + [{"type": "provider-request", "data": {"providerID": "route-secondary",
                    "modelID": "sol", "afterTool": True}}])
    must_reject(lambda e: expect_single_native_tool(e, "route-primary"),
                tool[:3] + [{"type": "provider-request", "data": {"providerID": "route-primary",
                    "modelID": "astra", "afterTool": True}}])
    must_reject(lambda e: expect_transport(e, "route-primary", 1),
                [{"type": "provider-request", "data": {"providerID": "route-metered"}}])
    return {"status": "PASS", "kind": "oracle-mutation-controls",
            "cases": ["paid transport leaks through guard", "duplicate native tool execution",
                      "provider changes after tool", "model changes after tool", "unexpected provider selection"],
            "evidence": "synthetic oracle negative controls, not installed-host execution"}


if __name__ == "__main__":
    import json
    print(json.dumps(run_mutation_controls(), indent=2))
