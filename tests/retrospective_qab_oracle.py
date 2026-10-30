"""QA-B's provider-free evidence oracle.

This is NOT a model evaluator: it checks whether real host audit evidence *could*
support an integrated PASS. The installed real-model driver supplies the audit,
native source oracle, final text and five control outcomes. No self-report alone
may satisfy tool or model execution gates.
"""
from __future__ import annotations

VALID = {"PASS", "FAIL", "UNPROVEN"}
CONTROLS = ("foreign-parent-ancestry", "read-denied", "child-inaccessible",
            "compaction-gap", "privacy")


def _items(audit, kind, session):
    return [e["data"] for e in audit if e.get("type") == kind
            and e.get("data", {}).get("sessionID") == session]


def _paired_traces(audit, session):
    before = {e.get("callID"): e for e in _items(audit, "tool-before", session)
              if e.get("tool") in ("loom_trace", "loom.trace") and e.get("callID")}
    for result in _items(audit, "tool-after", session):
        call = before.get(result.get("callID"))
        if not call or result.get("tool") not in ("loom_trace", "loom.trace"):
            continue
        yield call, result


def verify_primary(audit, investigator, model, parent, worker, reviewer, required_events, report):
    """Return separate infrastructure/behavioral checks, never an assumed pass."""
    checks = {}
    actual_model = [e for e in _items(audit, "model-request", investigator)
                    if e.get("kind") == "primary" and
                    e.get("providerID") + "/" + e.get("modelID") == model]
    checks["real-model-primary"] = "PASS" if actual_model and not model.startswith("question-fixture/") else "UNPROVEN"
    pairs = list(_paired_traces(audit, investigator))
    good = [(before.get("trace", {}), after.get("trace_result", {})) for before, after in pairs
            if after.get("status") == "completed" and
            after.get("trace_result", {}).get("parse") == "ok"]
    child_inventories = [result for call, result in good if call.get("operation") == "children"
                         and call.get("session_id") == parent]
    children = {item for result in child_inventories for item in result.get("child_ids", [])}
    checks["model-discovered-children"] = "PASS" if {worker, reviewer} <= children else "UNPROVEN"
    timelines = [result for call, result in good if call.get("operation") == "timeline"]
    observed_sources = {id for entry in timelines for id in entry.get("event_ids", [])}
    evidence = set(required_events.values())
    checks["model-read-source-events"] = "PASS" if evidence and evidence <= observed_sources else "UNPROVEN"
    checks["tool-arguments-authorized"] = "PASS" if (timelines and all(
        any(before.get("trace", {}).get("export_path") for before, after in pairs
            if after.get("status") == "completed" and after.get("trace_result") is entry)
        for entry in timelines if entry.get("session_id") != investigator)) else "UNPROVEN"
    checks["source-linked-retrospective"] = ("PASS" if report and all(
        source_id in report for source_id in required_events.values()) else "UNPROVEN")
    checks["handoff-challenged"] = ("PASS" if report and
        any(word in report.lower() for word in ("not first", "not accurate", "contradict", "correction"))
        else "UNPROVEN")
    checks["no-private-dump"] = ("PASS" if report and len(report.encode("utf-8")) <= 16000
                                 and "PRIVATE KEY" not in report and "sk-proj-" not in report
                                 else "UNPROVEN")
    # A zero-observation situation is UNPROVEN rather than a false PASS.
    infra = "PASS" if checks["real-model-primary"] == "PASS" and timelines else "UNPROVEN"
    behavior = "PASS" if all(x == "PASS" for x in checks.values()) else "UNPROVEN"
    return {"infrastructure": infra, "agent": behavior, "checks": checks,
            "observed_event_ids": sorted(observed_sources),
            "observed_trace_call_ids": [b.get("callID") for b, _ in pairs]}


def grade_controls(controls):
    """An omitted/handwaved control can never accidentally pass."""
    result = {}
    for name in CONTROLS:
        evidence = controls.get(name, {})
        result[name] = ("PASS" if evidence.get("executed") is True
                        and evidence.get("observed") is True
                        and evidence.get("model") == "real"
                        and evidence.get("native_tool_call_id")
                        else evidence.get("status", "UNPROVEN")
                        if evidence.get("status") == "FAIL" else "UNPROVEN")
    return result


def verdict(primary, controls):
    if any(x == "FAIL" for x in controls.values()):
        return "FAIL"
    if primary["infrastructure"] == "PASS" and primary["agent"] == "PASS" and all(
        x == "PASS" for x in controls.values()
    ):
        return "PASS"
    return "UNPROVEN"
