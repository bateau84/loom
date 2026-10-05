"""Integrity-check pinned normal-invoke hook diagnostics; never evidence."""
from __future__ import annotations

import json
import math
from typing import Any

DIAGNOSTIC_SCHEMA = "loom-normal-invoke-diagnostic/v1"
NATIVE_SCHEMA = "opencode-native-observation/v2"
LOCAL_SCHEMA = "opencode-local-observation/v1"
MAX_BYTES = 4_000_000
MAX_EVENTS = 4096
_ALLOWED = {NATIVE_SCHEMA, LOCAL_SCHEMA}
_PAYLOAD_POLICIES = {"omit-opaque-payloads/v1", "synthetic-secret-free-fixture/v1"}
MAX_JSON_DEPTH = 64
MAX_JSON_NODES = 100_000


def _invalid_constant(value: str) -> None:
    raise ValueError(f"non-JSON numeric constant: {value}")


def _nonempty(value: Any) -> bool:
    return isinstance(value, str) and bool(value)


def _counter(value: Any) -> bool:
    return type(value) is int and value >= 0


def _exact_keys(value: Any, expected: set[str]) -> bool:
    return isinstance(value, dict) and set(value) == expected


def _finite_json(value: Any) -> bool:
    pending = [(value, 0)]
    visited = 0
    while pending:
        current, depth = pending.pop()
        visited += 1
        if visited > MAX_JSON_NODES or depth > MAX_JSON_DEPTH:
            return False
        if current is None or isinstance(current, (str, bool)):
            continue
        if type(current) is int:
            try:
                if not math.isfinite(float(current)):
                    return False
            except OverflowError:
                return False
            continue
        if type(current) is float:
            if not math.isfinite(current):
                return False
            continue
        if isinstance(current, list):
            pending.extend((item, depth + 1) for item in current)
            continue
        if isinstance(current, dict):
            if any(not isinstance(key, str) for key in current):
                return False
            pending.extend((item, depth + 1) for item in current.values())
            continue
        return False
    return True


def _actor(value: Any) -> bool:
    return isinstance(value, dict) and all(
        _nonempty(value.get(field)) for field in ("agent", "session_id", "message_id")
    )


def _parent(value: Any) -> bool:
    return isinstance(value, dict) and all(
        _nonempty(value.get(field))
        for field in ("invocation_id", "session_id", "message_id", "call_id")
    )


def _field(value: Any, *, available: bool) -> bool:
    if not isinstance(value, dict):
        return False
    if available:
        return _exact_keys(value, {"state", "value"}) and value.get("state") == "available"
    return (_exact_keys(value, {"state", "reason"}) and value.get("state") == "omitted" and
            value.get("reason") in {"sensitive_value", "unsupported_event_field", "oversized_event",
                                    "opaque_payload_unverified", "unknown_payload_policy"})


def _valid_event_shape(event: Any, schema: str) -> bool:
    if not isinstance(event, dict) or not isinstance(event.get("kind"), str):
        return False
    common = {"schema", "sequence", "actor", "observer_failures", "kind"}
    if schema == NATIVE_SCHEMA:
        shapes = {
            "call_start": common | {"invocation_id", "call_id", "tool", "mode", "parent", "input", "boundary"},
            "call_end": common | {"invocation_id", "call_id", "boundary", "unavailable_fields", "outcome"},
        }
    elif schema == LOCAL_SCHEMA:
        shapes = {
            "parent_start": common | {"parent", "boundary", "mode"},
            "parent_end": common | {"parent", "admitted", "dispatched", "terminals",
                                    "missing_terminals", "unsupported_dispatches", "unavailable_fields",
                                    "scope", "evidence_eligible"},
            "call_start": common | {"parent", "invocation_id", "tool", "catalog_path", "input", "boundary"},
            "call_end": common | {"parent", "invocation_id", "dispatched", "boundary", "outcome"},
        }
    else:
        return False
    expected = shapes.get(event["kind"])
    if expected is None:
        return False
    if event["kind"] == "call_end":
        outcome = event.get("outcome")
        if outcome == "returned":
            expected = expected | {"result"}
        elif outcome == "threw":
            expected = expected | {"error", "error_representation"}
        elif schema == LOCAL_SCHEMA and outcome == "interrupted":
            pass
        else:
            return False
        # Native call_end may include unavailable_fields; local call_end does not.
        if schema == NATIVE_SCHEMA:
            expected = expected | {"unavailable_fields"}
    return set(event) == expected


def _valid_start(event: dict[str, Any], schema: str) -> bool:
    if schema == NATIVE_SCHEMA:
        return (
            event.get("kind") == "call_start" and _nonempty(event.get("invocation_id")) and
            _nonempty(event.get("call_id")) and _nonempty(event.get("tool")) and
            event.get("mode") == "native" and event.get("parent") is None and
            event.get("boundary") == "executable-input" and _actor(event.get("actor")) and
            _field(event.get("input"), available=True)
        )
    return (
        event.get("kind") == "call_start" and _nonempty(event.get("invocation_id")) and
        _nonempty(event.get("tool")) and _nonempty(event.get("catalog_path")) and
        event.get("boundary") == "executable-input" and _actor(event.get("actor")) and
        _parent(event.get("parent")) and
        event["actor"].get("session_id") == event["parent"].get("session_id") and
        event["actor"].get("message_id") == event["parent"].get("message_id") and
        _field(event.get("input"), available=True)
    )


def _valid_terminal(event: dict[str, Any], schema: str) -> bool:
    outcome = event.get("outcome")
    if schema == NATIVE_SCHEMA:
        common = (
            event.get("kind") == "call_end" and _nonempty(event.get("invocation_id")) and
            _nonempty(event.get("call_id")) and event.get("boundary") == "session-tool-terminal" and
            _actor(event.get("actor"))
        )
        if outcome == "returned":
            return common and _field(event.get("result"), available=True) and "error" not in event
        if outcome == "threw":
            return (common and _field(event.get("error"), available=True) and
                    _nonempty(event.get("error_representation")) and "result" not in event)
        return False
    common = (
        event.get("kind") == "call_end" and _nonempty(event.get("invocation_id")) and
        event.get("boundary") == "codemode-json-return" and event.get("dispatched") is True and
        _actor(event.get("actor")) and _parent(event.get("parent")) and
        event["actor"].get("session_id") == event["parent"].get("session_id") and
        event["actor"].get("message_id") == event["parent"].get("message_id")
    )
    if outcome == "returned":
        return common and _field(event.get("result"), available=True) and "error" not in event
    if outcome == "threw":
        return (common and _field(event.get("error"), available=True) and
                _nonempty(event.get("error_representation")) and "result" not in event)
    if outcome == "interrupted":
        return common and "result" not in event and "error" not in event
    return False


def parse_diagnostic_capture(raw: str | bytes) -> dict[str, Any]:
    result: dict[str, Any] = {
        "schema": DIAGNOSTIC_SCHEMA,
        "diagnostic_only": True,
        "evidence_eligible": False,
        "capture_valid": False,
        "runwide_complete": False,
        "upstream_clipping_coverage": "unattested",
        "payload_policy": "unknown",
        "events": [],
        "omitted_events": 0,
        "reasons": ["missing_or_incomplete_capture"],
    }
    if isinstance(raw, bytes):
        if len(raw) > MAX_BYTES:
            result["reasons"] = ["oversized_capture"]
            return result
        try:
            raw = raw.decode("utf-8", errors="strict")
        except UnicodeDecodeError:
            result["reasons"] = ["invalid_utf8"]
            return result
    if not isinstance(raw, str):
        result["reasons"] = ["invalid_capture_type"]
        return result
    try:
        raw_size = len(raw.encode("utf-8", errors="strict"))
    except UnicodeEncodeError:
        result["reasons"] = ["invalid_unicode"]
        return result
    if raw_size > MAX_BYTES:
        result["reasons"] = ["oversized_capture"]
        return result
    lines = raw.splitlines()
    if not 2 <= len(lines) <= MAX_EVENTS + 2:
        return result
    try:
        records = [json.loads(line, parse_constant=_invalid_constant) for line in lines]
    except (ValueError, RecursionError):
        result["reasons"] = ["malformed_json"]
        return result
    if not all(_finite_json(record) for record in records):
        result["reasons"] = ["nonfinite_or_nonjson_value"]
        return result
    header, footer = records[0], records[-1]
    payload_policy = header.get("payload_policy") if isinstance(header, dict) else None
    if (not _exact_keys(header, {"kind", "schema", "payload_policy", "diagnostic_only", "evidence_eligible"}) or
            header.get("kind") != "header" or
            header.get("schema") != DIAGNOSTIC_SCHEMA or header.get("diagnostic_only") is not True or
            header.get("evidence_eligible") is not False or
            not isinstance(payload_policy, str) or payload_policy not in _PAYLOAD_POLICIES or
            not _exact_keys(footer, {"kind", "schema", "payload_policy", "event_count", "omitted_events",
                                     "writes_complete", "diagnostic_only", "evidence_eligible"}) or
            footer.get("kind") != "footer" or
            footer.get("schema") != DIAGNOSTIC_SCHEMA or footer.get("diagnostic_only") is not True or
            footer.get("evidence_eligible") is not False or footer.get("writes_complete") is not True or
            footer.get("payload_policy") != payload_policy or
            not _counter(footer.get("event_count")) or footer["event_count"] != len(records) - 2 or
            not _counter(footer.get("omitted_events"))):
        result["reasons"] = ["invalid_header_footer_or_count"]
        return result
    result["payload_policy"] = payload_policy

    event_records = records[1:-1]
    result["events"] = event_records
    sequences: dict[int, tuple[str, dict[str, Any]]] = {}
    starts: dict[tuple[str, str], tuple[int, dict[str, Any]]] = {}
    terminals: dict[tuple[str, str], tuple[int, dict[str, Any]]] = {}
    local_parents: dict[str, dict[str, Any]] = {}
    local_children: dict[str, list[tuple[int, dict[str, Any]]]] = {}
    native_call_scopes: set[tuple[str, str, str]] = set()
    reasons: set[str] = set()
    last_sequence = 0

    for record in event_records:
        if not isinstance(record, dict):
            reasons.add("invalid_record_type")
            continue
        if record.get("event_omitted") is True:
            if not _exact_keys(record, {"schema", "payload_policy", "diagnostic_only", "evidence_eligible",
                                        "event_omitted", "omission_reason"}):
                reasons.add("invalid_omission_record_shape")
                continue
            result["omitted_events"] += 1
            reasons.add(str(record.get("omission_reason") or "event_omitted"))
            continue
        schema = record.get("schema")
        if (record.get("diagnostic_only") is not True or record.get("evidence_eligible") is not False or
                record.get("payload_policy") != payload_policy or
                not isinstance(schema, str) or schema not in _ALLOWED or
                not _exact_keys(record, {"schema", "payload_policy", "diagnostic_only", "evidence_eligible", "event"}) or
                not isinstance(record.get("event"), dict)):
            reasons.add("invalid_event_or_schema")
            continue
        event = record["event"]
        if not _valid_event_shape(event, schema):
            reasons.add("invalid_event_shape")
            continue
        if (payload_policy == "omit-opaque-payloads/v1" and
                isinstance(event.get("kind"), str) and event.get("kind") in {"call_start", "call_end"}):
            reasons.add("opaque_payload_persisted_under_omit_policy")
        sequence = event.get("sequence")
        if (event.get("schema") != schema or type(sequence) is not int or sequence < 1 or
                sequence in sequences):
            reasons.add("invalid_or_duplicate_sequence")
            continue
        if sequence <= last_sequence:
            reasons.add("nonmonotonic_capture_order")
        else:
            last_sequence = sequence
        sequences[sequence] = (schema, event)
        if not _counter(event.get("observer_failures")) or event["observer_failures"] != 0:
            reasons.add("runtime_observer_failures")
        if schema == NATIVE_SCHEMA:
            kind = event.get("kind")
            if kind == "call_start":
                if not _valid_start(event, schema):
                    reasons.add("invalid_native_start")
                    continue
                key = (schema, event["invocation_id"])
                if key in starts:
                    reasons.add("duplicate_native_start")
                else:
                    actor = event["actor"]
                    call_scope = (actor["session_id"], actor["message_id"], event["call_id"])
                    if call_scope in native_call_scopes:
                        reasons.add("duplicate_native_runtime_call_identity")
                    else:
                        native_call_scopes.add(call_scope)
                        starts[key] = (sequence, event)
            elif kind == "call_end":
                if (not _valid_terminal(event, schema) or not _counter(event.get("unavailable_fields")) or
                        event.get("unavailable_fields") != 0):
                    reasons.add("invalid_native_terminal_or_unavailable_fields")
                    continue
                key = (schema, event["invocation_id"])
                if key in terminals:
                    reasons.add("duplicate_native_terminal")
                else:
                    terminals[key] = (sequence, event)
            else:
                reasons.add("unknown_native_event_kind")
            continue

        kind = event.get("kind")
        actor = event.get("actor")
        parent = event.get("parent")
        if (not _actor(actor) or not _parent(parent) or
                actor["session_id"] != parent["session_id"] or actor["message_id"] != parent["message_id"]):
            reasons.add("invalid_inner_actor_or_parent")
            continue
        parent_id = parent["invocation_id"]
        if isinstance(kind, str) and kind in {"parent_start", "parent_end"}:
            if kind == "parent_start":
                if (parent_id in local_parents or event.get("boundary") != "codemode-engine" or
                        event.get("mode") != "code_mode"):
                    reasons.add("duplicate_parent_start")
                else:
                    local_parents[parent_id] = {"start_sequence": sequence, "actor": actor, "parent": parent}
                    local_children[parent_id] = []
            else:
                prior = local_parents.get(parent_id)
                counters = ("admitted", "dispatched", "terminals", "missing_terminals",
                            "unsupported_dispatches", "unavailable_fields")
                if (prior is None or "end_sequence" in prior or sequence <= prior["start_sequence"] or
                        prior["actor"] != actor or prior["parent"] != parent or
                        any(not _counter(event.get(name)) for name in counters) or
                        event.get("missing_terminals") != 0 or event.get("unsupported_dispatches") != 0 or
                        event.get("unavailable_fields") != 0 or
                        event.get("scope") != "one-codemode-engine-invocation" or
                        event.get("evidence_eligible") is not False or
                        event.get("admitted") != event.get("dispatched") or
                        event.get("dispatched") != len(local_children.get(parent_id, [])) or
                        event.get("terminals") != event.get("dispatched")):
                    reasons.add("invalid_parent_accounting_or_identity")
                else:
                    prior["end_sequence"] = sequence
            continue
        if kind == "call_start":
            if (not _valid_start(event, schema) or event.get("invocation_id") == parent_id or
                    parent_id not in local_parents):
                reasons.add("invalid_inner_start_or_orphan_parent")
                continue
            parent_state = local_parents[parent_id]
            if (sequence <= parent_state["start_sequence"] or parent_state["actor"] != actor or
                    parent_state["parent"] != parent):
                reasons.add("inner_start_parent_mismatch")
                continue
            key = (schema, event["invocation_id"])
            if key in starts:
                reasons.add("duplicate_inner_start")
            else:
                starts[key] = (sequence, event)
                local_children[parent_id].append((sequence, event))
            continue
        if kind == "call_end":
            if (not _valid_terminal(event, schema) or
                    not _counter(event.get("unavailable_fields", 0)) or event.get("unavailable_fields", 0) != 0):
                reasons.add("invalid_inner_terminal_or_unavailable_fields")
                continue
            key = (schema, event["invocation_id"])
            if key in terminals:
                reasons.add("duplicate_inner_terminal")
            else:
                terminals[key] = (sequence, event)
            continue
        reasons.add("unknown_inner_event_kind")

    for key, (start_sequence, start) in starts.items():
        terminal = terminals.get(key)
        if terminal is None:
            reasons.add("unfinished_invocation")
            continue
        terminal_sequence, end = terminal
        identity_fields = ("invocation_id", "call_id", "actor") if key[0] == NATIVE_SCHEMA else (
            "invocation_id", "actor", "parent"
        )
        if (terminal_sequence <= start_sequence or
                any(start.get(field) != end.get(field) for field in identity_fields)):
            reasons.add("terminal_identity_or_order_mismatch")
        if key[0] == LOCAL_SCHEMA:
            parent_id = start["parent"]["invocation_id"]
            parent_state = local_parents.get(parent_id)
            if parent_state is None or ("end_sequence" in parent_state and terminal_sequence >= parent_state["end_sequence"]):
                reasons.add("inner_terminal_outside_parent")
    for key in terminals:
        if key not in starts:
            reasons.add("orphan_terminal")

    native_executes = {
        invocation_id: (sequence, event)
        for (schema, invocation_id), (sequence, event) in starts.items()
        if schema == NATIVE_SCHEMA and event.get("tool") == "execute"
    }
    for parent_id, parent_state in local_parents.items():
        native = native_executes.get(parent_id)
        native_terminal = terminals.get((NATIVE_SCHEMA, parent_id))
        if native is None:
            reasons.add("inner_parent_not_bound_to_native_execute")
            continue
        if "end_sequence" not in parent_state or native_terminal is None:
            reasons.add("unfinished_native_parent_binding")
            continue
        native_sequence, native_event = native
        native_terminal_sequence, _ = native_terminal
        parent = parent_state["parent"]
        actor = parent_state["actor"]
        if (native_sequence >= parent_state["start_sequence"] or
                parent_state["end_sequence"] >= native_terminal_sequence or
                native_event.get("call_id") != parent.get("call_id") or
                native_event.get("actor", {}).get("session_id") != parent.get("session_id") or
                native_event.get("actor", {}).get("message_id") != parent.get("message_id") or
                native_event.get("actor", {}).get("agent") != actor.get("agent")):
            reasons.add("native_execute_parent_binding_mismatch")

    footer_omitted = footer.get("omitted_events")
    if footer_omitted != result["omitted_events"]:
        reasons.add("omission_count_mismatch")
    if reasons:
        result["reasons"] = sorted(reasons)
        result["capture_valid"] = False
    else:
        result["reasons"] = []
        result["capture_valid"] = True
    return result
