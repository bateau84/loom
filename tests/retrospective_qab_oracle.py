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
    """Pair native trace starts/results without assigning ambiguous Code Mode IDs.

    OpenCode Code Mode may reuse one outer call ID for several *concurrent*
    loom_trace invocations. When results overlap, only accept a complete group
    whose returned operation/source and Session identity uniquely identify
    each request. Error results have no reliable target identity and remain
    unpaired in an overlapping group. Sequential reuse still works.
    """

    def identifies(start, terminal):
        if terminal.get("status") != "completed":
            return False
        result = terminal.get("trace_result")
        request = start.get("trace")
        if not isinstance(result, dict) or result.get("parse") != "ok" or not isinstance(request, dict):
            return False
        if request.get("operation") == "timeline":
            return (
                isinstance(request.get("session_id"), str)
                and request["session_id"] == result.get("session_id")
                and result.get("source") == (
                    "provided-export" if request.get("export_path") else "native-context")
            )
        if request.get("operation") == "children":
            # A children response is not a timeline. The old audit retained
            # child_ids but not parent_session_id; exactly one compatible
            # pending children request is needed to recover that older bundle.
            # New audits include parent_session_id for stronger attribution.
            parent = result.get("parent_session_id")
            return (
                isinstance(result.get("child_ids"), list)
                and result.get("source") is None
                and result.get("session_id") is None
                and (parent is None or parent == request.get("session_id"))
            )
        return False

    pending = {}
    for event in audit:
        if event.get("type") not in ("tool-before", "tool-after"):
            continue
        data = event.get("data")
        if not isinstance(data, dict) or data.get("sessionID") != session:
            continue
        tool, call_id = data.get("tool"), data.get("callID")
        if tool not in ("loom_trace", "loom.trace") or not isinstance(call_id, str) or not call_id:
            continue
        # A distinct native message can reuse a Code Mode outer call ID.
        # Keep it separate when the host supplies messageID.
        key = (session, tool, call_id, data.get("messageID"))
        if event["type"] == "tool-before":
            group = pending.setdefault(key, {"starts": [], "terminals": []})
            group["starts"].append(data)
            continue
        group = pending.get(key)
        if group is None:
            continue
        group["terminals"].append(data)
        starts, terminals = group["starts"], group["terminals"]
        if len(terminals) < len(starts):
            continue
        del pending[key]
        if len(terminals) != len(starts):
            continue
        if len(starts) == 1:
            # Preserve sequential reuse and normal error correlation.
            yield starts[0], terminals[0]
            continue
        # A concurrent group is all-or-nothing: an unidentified error or
        # a duplicate plausible target invalidates the complete group.
        pairs, assigned = [], set()
        for terminal in terminals:
            matches = [i for i, start in enumerate(starts)
                       if identifies(start, terminal)]
            if len(matches) != 1 or matches[0] in assigned:
                break
            assigned.add(matches[0])
            pairs.append((starts[matches[0]], terminal))
        else:
            if len(assigned) == len(starts):
                yield from pairs


def _paired_traces(audit, session):
    yield from paired_trace_events(audit, session)


def source_call_aliases(audit, worker, required_events, worker_messages):
    """Derive valid call IDs from native worker messages AND completed host hooks.

    Message IDs remain sufficient. Call-ID alternatives are admitted only for
    the observed failed edit, recovered edit and post-correction verification,
    never merely because a model wrote a plausible-looking identifier.
    """
    if not isinstance(worker_messages, list) or not isinstance(required_events, dict):
        return {}
    if not all(isinstance(m, dict) and isinstance(m.get("id"), str)
               and isinstance(m.get("time"), dict)
               and isinstance(m["time"].get("created"), int)
               for m in worker_messages):
        return {}
    ordered = sorted(worker_messages, key=lambda m: m["time"]["created"])
    by_id = {m["id"]: m for m in ordered}
    if len(by_id) != len(ordered):
        return {}

    def audited(message_id, part, expected, *, verification=False):
        call, tool, state = part.get("id"), part.get("name"), part.get("state")
        if (not isinstance(call, str) or not call or
                tool not in ("edit", "patch", "execute", "shell", "bash") or
                not isinstance(state, dict) or state.get("status") != expected):
            return False
        identity = {"sessionID": worker, "messageID": message_id,
                    "callID": call, "tool": tool}
        def matching(kind):
            return [e.get("data") for e in audit if e.get("type") == kind
                    and isinstance(e.get("data"), dict)
                    and all(e["data"].get(k) == v for k, v in identity.items())]
        before, after = matching("tool-before"), matching("tool-after")
        if len(before) != 1 or len(after) != 1 or after[0].get("status") != expected:
            return False
        if not verification:
            return True
        inputs, metadata = state.get("input"), state.get("metadata")
        return (tool in ("shell", "bash")
                and before[0].get("verification_command") is True
                and isinstance(inputs, dict)
                and "test_settings.py" in str(inputs.get("command", ""))
                and isinstance(metadata, dict) and metadata.get("exit") == 0)

    aliases = {}
    for kind, status in (("failure", "error"), ("retry", "completed")):
        message = by_id.get(required_events.get(kind))
        if not message or message.get("type") != "assistant":
            continue
        parts = message.get("content", [])
        calls = [part["id"] for part in parts if isinstance(part, dict)
                 and part.get("type") == "tool"
                 and audited(message["id"], part, status)] if isinstance(parts, list) else []
        if len(calls) == 1:
            aliases[kind] = calls[0]

    verified = next((i for i, m in enumerate(ordered)
                     if m["id"] == required_events.get("verified")
                     and m.get("type") == "assistant"), None)
    if verified is None:
        return aliases
    previous_user = next((i for i in range(verified - 1, -1, -1)
                          if ordered[i].get("type") == "user"), None)
    if previous_user is None or "QA_B_SOURCE_PHASE:worker-verify" not in str(
            ordered[previous_user].get("text", "")):
        return aliases
    calls = []
    for message in ordered[previous_user + 1:verified]:
        parts = message.get("content", [])
        if message.get("type") != "assistant" or not isinstance(parts, list):
            continue
        calls.extend(part["id"] for part in parts if isinstance(part, dict)
                     and part.get("type") == "tool"
                     and audited(message["id"], part, "completed", verification=True))
    if len(calls) == 1:
        aliases["verified"] = calls[0]
    return aliases


def verify_primary(audit, investigator, model, parent, worker, reviewer, required_events, report, *, worker_messages=None):
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
    # A caller-only timeline is useful but cannot prove authorization for
    # related Session exports. Require at least one observed, successful
    # cross-Session read, matching requested and returned source identity.
    cross_session_reads = [(call, result) for call, result in good
                           if call.get("operation") == "timeline" and (
                               call.get("session_id") != investigator or
                               result.get("session_id") != investigator)]
    checks["tool-arguments-authorized"] = ("PASS" if cross_session_reads and all(
        call.get("session_id") == result.get("session_id")
        and isinstance(call.get("export_path"), str) and bool(call["export_path"])
        and result.get("source") == "provided-export"
        for call, result in cross_session_reads) else "UNPROVEN")
    # loom_trace exposes original message AND call IDs. Permit a call ID only
    # when original worker records and native audit independently prove it.
    aliases = source_call_aliases(audit, worker, required_events, worker_messages)
    checks["source-linked-retrospective"] = ("PASS" if complete_oracle and report and all(
        (source_id in report) or
        (source_id in observed_sources and isinstance(aliases.get(kind), str)
         and aliases[kind] in report)
        for kind, source_id in required_events.items()) else "UNPROVEN")
    checks["history-limits-visible"] = ("PASS" if timelines and all(
        entry.get("coverage", {}).get("full_history") in (False, None) and
        entry.get("coverage", {}).get("delegation_complete") is False
        for entry in timelines) else "UNPROVEN")
    # The report must explicitly dispute the first-try claim, not merely
    # quote General's false handoff or say the claim is uncertain. Normalize
    # lightweight Markdown so "does **not** support" stays recognizable.
    lower = " ".join(report.lower().replace("**", "").replace("`", "").split())
    named_challenge = (
        "not first" in lower or "first try was false" in lower or
        ("first-try claim" in lower and "false" in lower) or
        ("handoff" in lower and ("misleading" in lower or "contradicted" in lower)))
    evidence_challenge = (
        "does not support" in lower and
        "succeeded on the first try" in lower and
        "no user corrections" in lower and
        ("first failure" in lower or "edit failure" in lower or "retry" in lower) and
        "user correction" in lower)
    # Another valid explicit rebuttal: the report explains a failed
    # first attempt and later retry, and identifies the "no corrections"
    # statement as contradicted by the Session record. Do not infer this
    # from a bare quote of the handoff or an uncertain outcome.
    reconstructed_challenge = (
        ("first edit attempt failed" in lower or "first edit failed" in lower or
         "first attempt failed" in lower)
        and ("retry" in lower or "retried" in lower)
        and "no user corrections" in lower
        and ("contradict" in lower or "false" in lower or "not true" in lower)
    )
    # Separate evidence for BOTH false claims is required. The investigator
    # may describe the contradiction rather than using a fixed verdict phrase.
    observed_challenge = (
        ("first-attempt failure" in lower or "first attempt failed" in lower or
         "first edit attempt failed" in lower)
        and "edit" in lower and "error" in lower
        and "retry" in lower and "completed" in lower
        and "this conflicts with" in lower and
        "succeeded on the first try" in lower
        and "user correction" in lower and "no user corrections" in lower
        and "contradict" in lower
    )
    checks["handoff-challenged"] = ("PASS" if report and
                                   (named_challenge or evidence_challenge or
                                    reconstructed_challenge or observed_challenge)
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
