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


def paired_trace_events(audit, session):
    """Correlate traces by event order, call ID AND tool name.

    Code Mode can reuse its outer call ID for separate nested tools. Sequential
    reuse is safe, but overlapping starts with the same key have no reliable
    identity and MUST NOT be attributed to any completion.
    """
    pending = {}
    for event in audit:
        if event.get("type") not in ("tool-before", "tool-after"):
            continue
        data = event.get("data")
        if not isinstance(data, dict) or data.get("sessionID") != session:
            continue
        tool = data.get("tool")
        call_id = data.get("callID")
        if tool not in ("loom_trace", "loom.trace") or not isinstance(call_id, str) or not call_id:
            continue
        key = (session, tool, call_id)
        if event["type"] == "tool-before":
            state = pending.get(key)
            if state is None:
                pending[key] = {"start": data, "count": 1, "ambiguous": False}
            else:
                state["count"] += 1
                state["ambiguous"] = True
            continue
        state = pending.get(key)
        if state is None:
            continue
        state["count"] -= 1
        if state["count"] > 0:
            continue
        del pending[key]
        if not state["ambiguous"]:
            yield state["start"], data


def _paired_traces(audit, session):
    yield from paired_trace_events(audit, session)


def verify_primary(audit, investigator, model, parent, worker, reviewer, required_events, report):
    """Return separate infrastructure/behavioral checks, never an assumed pass."""
    checks = {}
    actual_model = [e for e in _items(audit, "model-request", investigator)
                    if e.get("kind") == "primary" and
                    isinstance(e.get("providerID"), str) and isinstance(e.get("modelID"), str)
                    and e["providerID"] + "/" + e["modelID"] == model]
    checks["real-model-primary"] = "PASS" if actual_model and not model.startswith("question-fixture/") else "UNPROVEN"
    pairs = list(_paired_traces(audit, investigator))
    good = [(before.get("trace", {}), after.get("trace_result", {})) for before, after in pairs
            if after.get("status") == "completed" and
            after.get("trace_result", {}).get("parse") == "ok"]
    child_inventories = [result for call, result in good if call.get("operation") == "children"
                         and call.get("session_id") == parent]
    children = {item for result in child_inventories for item in result.get("child_ids", [])}
    checks["model-discovered-children"] = "PASS" if {worker, reviewer} <= children else "UNPROVEN"
    loaded = {e.get("callID") for e in _items(audit, "tool-before", investigator)
              if e.get("tool") == "skill" and e.get("skill_id") == "retrospective"}
    checks["retrospective-skill-loaded"] = ("PASS" if loaded and any(
        e.get("callID") in loaded and e.get("tool") == "skill" and e.get("status") == "completed"
        for e in _items(audit, "tool-after", investigator)) else "UNPROVEN")
    timelines = [result for call, result in good if call.get("operation") == "timeline"]
    observed_sources = {id for entry in timelines for id in entry.get("event_ids", [])}
    evidence = {value for value in required_events.values() if isinstance(value, str) and value}
    complete_oracle = len(evidence) == len(required_events)
    checks["model-read-source-events"] = "PASS" if complete_oracle and evidence <= observed_sources else "UNPROVEN"
    checks["tool-arguments-authorized"] = "PASS" if (timelines and all(
        any(before.get("trace", {}).get("export_path") for before, after in pairs
            if after.get("status") == "completed" and after.get("trace_result") is entry)
        for entry in timelines if entry.get("session_id") != investigator)) else "UNPROVEN"
    checks["source-linked-retrospective"] = ("PASS" if complete_oracle and report and all(
        source_id in report for source_id in evidence) else "UNPROVEN")
    checks["history-limits-visible"] = ("PASS" if timelines and all(
        entry.get("coverage", {}).get("full_history") in (False, None) and
        entry.get("coverage", {}).get("delegation_complete") is False
        for entry in timelines) else "UNPROVEN")
    # The report must explicitly dispute the first-try claim, not merely repeat
    # General's phrase "no corrections" as if it were established fact.
    lower = report.lower()
    checks["handoff-challenged"] = ("PASS" if report and (
        "not first" in lower or "first try was false" in lower or
        "first-try claim" in lower and "false" in lower or
        "handoff" in lower and ("misleading" in lower or "contradicted" in lower))
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
        # Observed policy/privacy bypasses must never be converted to PASS
        # merely because they have a matching native tool-call ID.
        if evidence.get("status") == "FAIL":
            result[name] = "FAIL"
        elif (evidence.get("status") in (None, "PASS")
              and evidence.get("executed") is True
              and evidence.get("observed") is True
              and evidence.get("model") == "real"
              and evidence.get("native_tool_call_id")):
            result[name] = "PASS"
        else:
            result[name] = "UNPROVEN"
    return result


def verdict(primary, controls):
    if any(x == "FAIL" for x in controls.values()):
        return "FAIL"
    if primary["infrastructure"] == "PASS" and primary["agent"] == "PASS" and all(
        x == "PASS" for x in controls.values()
    ):
        return "PASS"
    return "UNPROVEN"
