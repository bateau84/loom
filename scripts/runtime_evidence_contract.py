# Consumer-only subset of bateau84/opencode-eval-runner/container/runtime_evidence.py

# Source: fd9da10cbe2a8182fc8910ec199a221250deb3ca (PR #45).

# Definitions below are verbatim; no producer, capture, or observer code is vendored.

# Update from the reviewed upstream contract, not by changing local accounting semantics.

from __future__ import annotations

import json

from collections.abc import Iterable, Mapping

from typing import Any

RUNTIME_EVIDENCE_SCHEMA = "opencode-eval-runner/runtime-evidence/v1"

STATUSES = frozenset({"complete", "incomplete", "unsupported", "invalid"})

FIELD_STATES = frozenset({"available", "redacted", "omitted", "unsupported"})

MODES = frozenset({"native", "code_mode"})

OUTCOMES = frozenset({"success", "error", "missing"})

PROCESS_STATES = frozenset({"completed", "timeout", "interrupted", "unsupported"})

EVENT_KINDS = frozenset({"start", "terminal"})

BOUNDARY_NATIVE = "native"

BOUNDARY_CODE_MODE_EXECUTION = "code_mode_execution"

BOUNDARY_CODE_MODE_FINALITY = "code_mode_finality"

CODE_MODE_FINALITY_REASON = "stock_codemode_final_boundary_not_exposed"

TOP_LEVEL_KEYS = {"schema", "status", "evidence_eligible", "observations", "coverage"}

OBSERVATION_KEYS = {
    "invocation_id",
    "tool",
    "mode",
    "actor",
    "session_id",
    "message_id",
    "call_id",
    "parent",
    "input",
    "outcome",
    "result",
    "error",
    "start_sequence",
    "terminal_sequence",
}

COVERAGE_KEYS = {
    "observation_closed",
    "process_state",
    "starts",
    "terminals",
    "missing_terminals",
    "observer_failures",
    "callback_failures",
    "losses",
    "unsupported",
    "boundaries",
}

BOUNDARY_KEYS = {
    "status",
    "evidence_eligible",
    "starts",
    "terminals",
    "missing_terminals",
    "issues",
}

class RuntimeEvidenceError(ValueError):
    """The runtime-evidence object is not safe to consume as contracted evidence."""

def _require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeEvidenceError(message)

def _exact_object(value: Any, keys: set[str], where: str) -> dict[str, Any]:
    _require(type(value) is dict, f"{where} must be an object")
    _require(set(value) == keys, f"{where} keys must be exactly {sorted(keys)}")
    return value

def _string(value: Any, where: str) -> str:
    _require(type(value) is str and bool(value.strip()), f"{where} must be a non-empty string")
    return value

def _json_value(value: Any, where: str) -> None:
    try:
        json.dumps(value, ensure_ascii=False, allow_nan=False)
    except (TypeError, ValueError, OverflowError) as exc:
        raise RuntimeEvidenceError(f"{where} must be a finite JSON value") from exc

def _field(
    raw: Any,
    where: str,
    *,
    value_type: type | None = None,
) -> tuple[str, Any | None]:
    _require(type(raw) is dict, f"{where} must be a field-state object")
    state = raw.get("state")
    _require(state in FIELD_STATES, f"{where}.state is invalid")

    if state == "available":
        _require(set(raw) == {"state", "value"}, f"{where} available state requires state/value")
        value = raw["value"]
        _json_value(value, f"{where}.value")
        if value_type is int:
            _require(type(value) is int, f"{where}.value must be an integer")
        elif value_type is str:
            _string(value, f"{where}.value")
        return state, value

    _require(set(raw) == {"state", "reason"}, f"{where} unavailable state requires state/reason")
    _string(raw["reason"], f"{where}.reason")
    return state, None

def _count(raw: Any, where: str) -> tuple[str, int | None]:
    state, value = _field(raw, where, value_type=int)
    _require(state in {"available", "omitted", "unsupported"}, f"{where} count state is invalid")
    if state == "available":
        _require(value >= 0, f"{where}.value must be >= 0")
    return state, value

def _codes(raw: Any, where: str) -> list[str]:
    _require(type(raw) is list, f"{where} must be a list")
    values = [_string(item, f"{where}[{index}]") for index, item in enumerate(raw)]
    _require(len(values) == len(set(values)), f"{where} must not contain duplicates")
    return values

_GLOBAL_INVALID = frozenset({
    "invalid_accounting_input",
    "malformed_observation",
    "duplicate_sequence",
    "duplicate_invocation",
    "ambiguous_invocation",
})

_GLOBAL_INCOMPLETE = frozenset({
    "observation_not_closed",
    "observer_failure",
    "callback_failure",
    "observation_loss",
    "runtime_timeout",
    "process_interrupted",
})

def _counter(value: Any) -> int | None:
    return value if type(value) is int and value >= 0 else None

def _name(value: Any) -> str | None:
    if isinstance(value, str) and 0 < len(value) <= 256:
        return value
    return None

def _new_boundary(*, declared_supported: bool = False, declared_unsupported: bool = False) -> dict[str, Any]:
    return {
        "status": "unsupported" if declared_unsupported else "complete",
        "evidence_eligible": not declared_unsupported,
        "declared_supported": declared_supported,
        "declared_unsupported": declared_unsupported,
        "starts": 0,
        "terminals": 0,
        "missing_terminals": 0,
        "required_fields_omitted": 0,
        "required_fields_unsupported": 0,
        "issues": ["unsupported_boundary"] if declared_unsupported else [],
    }

def _add_issue(target: list[str], code: str) -> None:
    if code not in target:
        target.append(code)

def _set_boundary_status(boundary: dict[str, Any], status: str, issue: str) -> None:
    priority = {"complete": 0, "unsupported": 1, "incomplete": 2, "invalid": 3}
    if priority[status] > priority[boundary["status"]]:
        boundary["status"] = status
    boundary["evidence_eligible"] = boundary["status"] == "complete"
    _add_issue(boundary["issues"], issue)

def _invalid_result(issues: list[str], coverage: dict[str, Any]) -> dict[str, Any]:
    return {
        "status": "invalid",
        "evidence_eligible": False,
        "issues": issues or ["invalid_accounting_input"],
        "coverage": coverage,
    }

def account_runtime_evidence(
    observations: Iterable[Mapping[str, Any]],
    *,
    observation_closed: bool,
    supported_boundaries: Iterable[str] = (),
    unsupported_boundaries: Iterable[str] = (),
    observer_failures: int = 0,
    callback_failures: int = 0,
    losses: int = 0,
    process_state: str = "completed",
) -> dict[str, Any]:
    """Account for normalized runtime observation starts and terminals.

    Each observation must contain kind, sequence, invocation_id,
    boundary, and required_fields. required_fields maps semantic
    field names to available, redacted, omitted, or unsupported.
    Adapters decide which fields are required; this layer only
    accounts for their explicit states.

    observation_closed is an ordinary correctness signal from the capture
    adapter that no more in-scope observations are expected. It is not a
    cryptographic seal. Without it, absence is never complete evidence.
    """
    coverage: dict[str, Any] = {
        "observation_closed": observation_closed if type(observation_closed) is bool else False,
        "starts": 0,
        "terminals": 0,
        "missing_terminals": 0,
        "observer_failures": 0,
        "callback_failures": 0,
        "losses": 0,
        "malformed_observations": 0,
        "duplicate_invocations": 0,
        "ambiguous_invocations": 0,
        "duplicate_sequences": 0,
        "required_fields_omitted": 0,
        "required_fields_unsupported": 0,
        "process_state": process_state if process_state in PROCESS_STATES else "invalid",
        "supported_boundaries": [],
        "unsupported_boundaries": [],
        "by_boundary": {},
    }
    issues: list[str] = []

    failures = _counter(observer_failures)
    callback_failure_count = _counter(callback_failures)
    loss_count = _counter(losses)
    if (
        type(observation_closed) is not bool
        or failures is None
        or callback_failure_count is None
        or loss_count is None
        or process_state not in PROCESS_STATES
    ):
        _add_issue(issues, "invalid_accounting_input")
        return _invalid_result(issues, coverage)
    coverage["observer_failures"] = failures
    coverage["callback_failures"] = callback_failure_count
    coverage["losses"] = loss_count

    supported: set[str] = set()
    unsupported: set[str] = set()
    for raw, target in ((supported_boundaries, supported), (unsupported_boundaries, unsupported)):
        try:
            values = list(raw)
        except TypeError:
            _add_issue(issues, "invalid_accounting_input")
            return _invalid_result(issues, coverage)
        for value in values:
            name = _name(value)
            if name is None:
                _add_issue(issues, "invalid_accounting_input")
                return _invalid_result(issues, coverage)
            target.add(name)
    if supported & unsupported:
        _add_issue(issues, "invalid_accounting_input")
        return _invalid_result(issues, coverage)

    coverage["supported_boundaries"] = sorted(supported)
    coverage["unsupported_boundaries"] = sorted(unsupported)
    boundaries: dict[str, dict[str, Any]] = {
        name: _new_boundary(declared_supported=True) for name in sorted(supported)
    }
    for name in sorted(unsupported):
        boundaries[name] = _new_boundary(declared_unsupported=True)

    calls: dict[str, dict[str, Any]] = {}
    seen_sequences: set[int] = set()

    try:
        stream = list(observations)
    except TypeError:
        _add_issue(issues, "invalid_accounting_input")
        return _invalid_result(issues, coverage)

    for item in stream:
        if not isinstance(item, Mapping):
            coverage["malformed_observations"] += 1
            _add_issue(issues, "malformed_observation")
            continue

        kind = item.get("kind")
        sequence = item.get("sequence")
        invocation_id = _name(item.get("invocation_id"))
        boundary_name = _name(item.get("boundary"))
        fields = item.get("required_fields")
        valid_sequence = type(sequence) is int and sequence >= 0
        valid_fields = isinstance(fields, Mapping)
        if (
            kind not in EVENT_KINDS
            or not valid_sequence
            or invocation_id is None
            or boundary_name is None
            or not valid_fields
        ):
            coverage["malformed_observations"] += 1
            _add_issue(issues, "malformed_observation")
            continue

        field_states: dict[str, str] = {}
        malformed_field = False
        for field_name, state in fields.items():
            safe_name = _name(field_name)
            if safe_name is None or state not in FIELD_STATES:
                malformed_field = True
                break
            field_states[safe_name] = state
        if malformed_field:
            coverage["malformed_observations"] += 1
            _add_issue(issues, "malformed_observation")
            continue

        boundary = boundaries.setdefault(boundary_name, _new_boundary())
        if boundary_name not in supported and boundary_name not in unsupported:
            _set_boundary_status(boundary, "unsupported", "undeclared_boundary")

        if sequence in seen_sequences:
            coverage["duplicate_sequences"] += 1
            _add_issue(issues, "duplicate_sequence")
            _set_boundary_status(boundary, "invalid", "duplicate_sequence")
            continue
        seen_sequences.add(sequence)

        for state in field_states.values():
            if state == "omitted":
                coverage["required_fields_omitted"] += 1
                boundary["required_fields_omitted"] += 1
                _set_boundary_status(boundary, "incomplete", "required_field_omitted")
            elif state == "unsupported":
                coverage["required_fields_unsupported"] += 1
                boundary["required_fields_unsupported"] += 1
                _set_boundary_status(boundary, "unsupported", "required_field_unsupported")

        if kind == "start":
            if invocation_id in calls:
                coverage["duplicate_invocations"] += 1
                _add_issue(issues, "duplicate_invocation")
                _set_boundary_status(boundary, "invalid", "duplicate_invocation")
                continue
            calls[invocation_id] = {
                "boundary": boundary_name,
                "start_sequence": sequence,
                "terminal_sequence": None,
            }
            coverage["starts"] += 1
            boundary["starts"] += 1
            continue

        call = calls.get(invocation_id)
        if call is None:
            coverage["ambiguous_invocations"] += 1
            _add_issue(issues, "ambiguous_invocation")
            _set_boundary_status(boundary, "invalid", "terminal_without_start")
            continue
        start_boundary = boundaries[call["boundary"]]
        if call["boundary"] != boundary_name or call["terminal_sequence"] is not None or sequence <= call["start_sequence"]:
            coverage["ambiguous_invocations"] += 1
            _add_issue(issues, "ambiguous_invocation")
            _set_boundary_status(boundary, "invalid", "ambiguous_terminal")
            _set_boundary_status(start_boundary, "invalid", "ambiguous_terminal")
            continue
        call["terminal_sequence"] = sequence
        coverage["terminals"] += 1
        boundary["terminals"] += 1

    for call in calls.values():
        if call["terminal_sequence"] is None:
            coverage["missing_terminals"] += 1
            boundary = boundaries[call["boundary"]]
            boundary["missing_terminals"] += 1
            _set_boundary_status(boundary, "incomplete", "missing_terminal")

    if not observation_closed:
        _add_issue(issues, "observation_not_closed")
    if failures:
        _add_issue(issues, "observer_failure")
    if callback_failure_count:
        _add_issue(issues, "callback_failure")
    if loss_count:
        _add_issue(issues, "observation_loss")
    if process_state == "timeout":
        _add_issue(issues, "runtime_timeout")
    elif process_state == "interrupted":
        _add_issue(issues, "process_interrupted")

    if coverage["missing_terminals"]:
        _add_issue(issues, "missing_terminal")
    if coverage["required_fields_omitted"]:
        _add_issue(issues, "required_field_omitted")
    if coverage["required_fields_unsupported"]:
        _add_issue(issues, "required_field_unsupported")
    if unsupported:
        _add_issue(issues, "unsupported_boundary")
    undeclared = sorted(name for name in boundaries if name not in supported and name not in unsupported)
    if undeclared:
        _add_issue(issues, "undeclared_boundary")

    global_invalid = any(code in _GLOBAL_INVALID for code in issues)
    global_incomplete = any(code in _GLOBAL_INCOMPLETE for code in issues)
    for boundary in boundaries.values():
        if global_invalid:
            _set_boundary_status(boundary, "invalid", "global_invalid_capture")
        elif global_incomplete:
            _set_boundary_status(boundary, "incomplete", "global_incomplete_capture")

    coverage["by_boundary"] = {name: boundaries[name] for name in sorted(boundaries)}

    if global_invalid or any(boundary["status"] == "invalid" for boundary in boundaries.values()):
        status = "invalid"
    elif global_incomplete or any(boundary["status"] == "incomplete" for boundary in boundaries.values()):
        status = "incomplete"
    elif any(boundary["status"] == "complete" for boundary in boundaries.values()):
        status = "complete"
    else:
        status = "unsupported"

    return {
        "status": status,
        "evidence_eligible": status == "complete",
        "issues": issues,
        "coverage": coverage,
    }

def _capture_issue_kind(code: str) -> str:
    if code in {
        "malformed_capture",
        "malformed_observation",
        "duplicate_sequence",
        "wrong_schema",
        "ambiguous_order",
        "records_after_capture_end",
        "invalid_capture_start",
        "invalid_capture_end",
        "invalid_record",
        "count_mismatch",
        "unterminated_capture",
    }:
        return "invalid"
    return "incomplete"

def _validate_boundary(raw: Any, where: str) -> tuple[str, dict[str, Any]]:
    boundary = _exact_object(raw, BOUNDARY_KEYS, where)
    status = boundary["status"]
    _require(status in STATUSES, f"{where}.status is invalid")
    _require(type(boundary["evidence_eligible"]) is bool, f"{where}.evidence_eligible must be boolean")
    _require(boundary["evidence_eligible"] == (status == "complete"), f"{where}.evidence_eligible is inconsistent")
    for key in ("starts", "terminals", "missing_terminals"):
        _count(boundary[key], f"{where}.{key}")
    _codes(boundary["issues"], f"{where}.issues")
    return status, boundary

def validate_runtime_evidence(raw: Any) -> dict[str, Any]:
    evidence = _exact_object(raw, TOP_LEVEL_KEYS, "runtime_evidence")
    _require(evidence["schema"] == RUNTIME_EVIDENCE_SCHEMA, "unsupported runtime_evidence schema")
    status = evidence["status"]
    _require(status in STATUSES, "runtime_evidence.status is invalid")
    _require(type(evidence["evidence_eligible"]) is bool, "runtime_evidence.evidence_eligible must be boolean")
    _require(evidence["evidence_eligible"] == (status == "complete"), "runtime_evidence.evidence_eligible is inconsistent")
    _require(type(evidence["observations"]) is list, "runtime_evidence.observations must be a list")
    coverage = _exact_object(evidence["coverage"], COVERAGE_KEYS, "runtime_evidence.coverage")
    process_state = coverage["process_state"]
    _require(process_state in PROCESS_STATES, "runtime_evidence.coverage.process_state is invalid")
    closed_state, closed = _field(coverage["observation_closed"], "runtime_evidence.coverage.observation_closed")
    starts_state, starts = _count(coverage["starts"], "runtime_evidence.coverage.starts")
    terminals_state, terminals = _count(coverage["terminals"], "runtime_evidence.coverage.terminals")
    missing_state, missing = _count(coverage["missing_terminals"], "runtime_evidence.coverage.missing_terminals")
    observer_state, observer_failures = _count(coverage["observer_failures"], "runtime_evidence.coverage.observer_failures")
    callback_state, callback_failures = _count(coverage["callback_failures"], "runtime_evidence.coverage.callback_failures")
    losses = _codes(coverage["losses"], "runtime_evidence.coverage.losses")
    unsupported = _codes(coverage["unsupported"], "runtime_evidence.coverage.unsupported")
    boundaries = coverage["boundaries"]
    _require(type(boundaries) is dict, "runtime_evidence.coverage.boundaries must be an object")

    expected_names = {BOUNDARY_NATIVE, BOUNDARY_CODE_MODE_EXECUTION, BOUNDARY_CODE_MODE_FINALITY}
    _require(set(boundaries) == expected_names, "runtime_evidence.coverage.boundaries has unexpected names")
    boundary_status: dict[str, str] = {}
    for name in expected_names:
        boundary_status[name], _ = _validate_boundary(
            boundaries[name], f"runtime_evidence.coverage.boundaries.{name}"
        )

    if process_state == "unsupported":
        _require(status == "unsupported" and not evidence["observations"], "unsupported transport cannot carry observations")
        _require(closed_state == "unsupported", "unsupported transport requires unsupported closure")
        _require(starts_state == terminals_state == missing_state == "unsupported", "unsupported transport requires unknown counts")
        _require(observer_state == callback_state == "unsupported", "unsupported transport requires unknown failure counts")
        _require(bool(unsupported), "unsupported transport requires a reason")
        return evidence

    _require(closed_state == "available" and type(closed) is bool, "observed capture requires explicit closure")
    aggregate_available = starts_state == terminals_state == missing_state == "available"
    aggregate_unknown = starts_state == terminals_state == missing_state == "omitted"
    _require(aggregate_available or aggregate_unknown, "coverage counts must be uniformly available or omitted")
    if aggregate_available:
        _require(starts >= terminals and missing == starts - terminals, "aggregate coverage counts are inconsistent")
    else:
        _require(status in {"incomplete", "invalid"}, "complete evidence cannot have unknown coverage")
        _require(bool(losses), "unknown coverage requires an explicit loss")

    seen_ids: set[str] = set()
    seen_sequences: set[int] = set()
    previous_start = -1
    terminal_count = 0
    reconstructed: list[dict[str, Any]] = []
    validated_by_id: dict[str, Mapping[str, Any]] = {}

    for index, observation in enumerate(evidence["observations"]):
        where = f"runtime_evidence.observations[{index}]"
        observation = _exact_object(observation, OBSERVATION_KEYS, where)
        invocation_id = _string(observation["invocation_id"], f"{where}.invocation_id")
        _require(invocation_id not in seen_ids, f"{where}.invocation_id must be unique")
        seen_ids.add(invocation_id)
        mode = observation["mode"]
        _require(mode in MODES, f"{where}.mode is invalid")
        required = {}
        for key in ("tool", "actor", "session_id", "message_id", "call_id", "input"):
            state, _ = _field(observation[key], f"{where}.{key}")
            required[key] = state
        parent_state, parent = _field(observation["parent"], f"{where}.parent")
        if parent_state == "available" and parent is not None:
            parent = _exact_object(parent, {"kind", "id"}, f"{where}.parent.value")
            _require(parent["kind"] in {"invocation", "session"}, f"{where}.parent.value.kind is invalid")
            _string(parent["id"], f"{where}.parent.value.id")
        if mode == "code_mode":
            required["parent"] = parent_state
            if status != "invalid":
                _require(
                    parent_state == "available"
                    and isinstance(parent, dict)
                    and parent.get("kind") == "invocation",
                    f"{where}.parent must identify an observed outer invocation",
                )
                outer = validated_by_id.get(parent["id"])
                _require(
                    isinstance(outer, Mapping) and outer.get("mode") == "native",
                    f"{where}.parent must reference an earlier native observation",
                )
                outer_tool_state, outer_tool = _field(outer.get("tool"), f"{where}.parent.outer.tool")
                if outer_tool_state == "available":
                    _require(outer_tool == "execute", f"{where}.parent must reference outer execute")
                for identity_name in ("actor", "session_id", "message_id", "call_id"):
                    _require(
                        outer.get(identity_name) == observation.get(identity_name),
                        f"{where}.parent outer identity does not match {identity_name}",
                    )

        start_sequence = observation["start_sequence"]
        _require(type(start_sequence) is int and start_sequence >= 0, f"{where}.start_sequence must be >= 0")
        _require(start_sequence > previous_start and start_sequence not in seen_sequences, "start sequences must be unique and ordered")
        previous_start = start_sequence
        seen_sequences.add(start_sequence)
        boundary = BOUNDARY_NATIVE if mode == "native" else BOUNDARY_CODE_MODE_EXECUTION
        reconstructed.append({
            "kind": "start",
            "sequence": start_sequence,
            "invocation_id": invocation_id,
            "boundary": boundary,
            "required_fields": required,
        })

        outcome = observation["outcome"]
        _require(outcome in OUTCOMES, f"{where}.outcome is invalid")
        result_state, _ = _field(observation["result"], f"{where}.result")
        error_state, _ = _field(observation["error"], f"{where}.error")
        terminal_state, terminal_sequence = _field(
            observation["terminal_sequence"], f"{where}.terminal_sequence", value_type=int
        )
        if outcome == "missing":
            _require(terminal_state == result_state == error_state == "omitted", f"{where} missing terminal must be explicit")
            validated_by_id[invocation_id] = observation
            continue
        _require(terminal_state == "available" and terminal_sequence > start_sequence, f"{where}.terminal_sequence must follow start")
        _require(terminal_sequence not in seen_sequences, f"{where}.terminal_sequence must be unique")
        seen_sequences.add(terminal_sequence)
        terminal_count += 1
        if mode == "code_mode":
            if outcome == "success":
                _require(result_state == "unsupported" and error_state == "omitted", f"{where} final result must be unsupported")
            else:
                _require(error_state == "unsupported" and result_state == "omitted", f"{where} final error must be unsupported")
            terminal_required = {"outcome": "available"}
        elif outcome == "success":
            _require(error_state == "omitted", f"{where}.error must be omitted on success")
            terminal_required = {"outcome": "available", "result_or_error": result_state}
        else:
            _require(result_state == "omitted", f"{where}.result must be omitted on error")
            terminal_required = {"outcome": "available", "result_or_error": error_state}
        reconstructed.append({
            "kind": "terminal",
            "sequence": terminal_sequence,
            "invocation_id": invocation_id,
            "boundary": boundary,
            "required_fields": terminal_required,
        })
        validated_by_id[invocation_id] = observation

    if aggregate_available:
        _require(starts == len(evidence["observations"]), "coverage starts does not match observations")
        _require(terminals == terminal_count, "coverage terminals does not match observations")

    _require(boundary_status[BOUNDARY_CODE_MODE_FINALITY] == "unsupported", "code_mode_finality must be unsupported")
    _require(CODE_MODE_FINALITY_REASON in unsupported, "Code Mode finality limitation must be explicit")

    if any(_capture_issue_kind(code) == "invalid" for code in losses):
        reconstructed.append({})

    accounting = account_runtime_evidence(
        reconstructed,
        observation_closed=closed,
        supported_boundaries=(BOUNDARY_NATIVE, BOUNDARY_CODE_MODE_EXECUTION),
        unsupported_boundaries=(BOUNDARY_CODE_MODE_FINALITY,),
        observer_failures=observer_failures if observer_state == "available" else 0,
        callback_failures=callback_failures if callback_state == "available" else 0,
        losses=sum(
            code in {
                "missing_capture",
                "empty_capture",
                "unterminated_capture",
                "missing_capture_end",
                "capture_io_error",
            }
            for code in losses
        ),
        process_state=process_state,
    )
    _require(status == accounting["status"], "runtime_evidence.status does not match canonical accounting")
    _require(evidence["evidence_eligible"] == accounting["evidence_eligible"], "runtime_evidence eligibility does not match canonical accounting")
    for name in (BOUNDARY_NATIVE, BOUNDARY_CODE_MODE_EXECUTION):
        _require(boundary_status[name] == accounting["coverage"]["by_boundary"][name]["status"], f"{name} status does not match canonical accounting")
    return evidence

def assertion_status(
    evidence: Mapping[str, Any],
    required_boundaries: Iterable[str],
    required_fields: Iterable[tuple[str, str]] = (),
) -> str:
    try:
        coverage = evidence["coverage"]
        boundaries = coverage["boundaries"]
        process_state = coverage["process_state"]
    except (KeyError, TypeError):
        return "invalid"
    if evidence.get("status") == "invalid":
        return "invalid"
    if evidence.get("status") == "incomplete" or process_state in {"timeout", "interrupted"}:
        return "incomplete"
    try:
        names = list(required_boundaries)
    except TypeError:
        return "invalid"
    statuses = []
    for name in names:
        if not isinstance(name, str) or not name:
            return "invalid"
        boundary = boundaries.get(name) if isinstance(boundaries, Mapping) else None
        if not isinstance(boundary, Mapping):
            return "unsupported"
        boundary_status = boundary.get("status")
        if boundary_status not in STATUSES:
            return "invalid"
        statuses.append(boundary_status)
    if "invalid" in statuses:
        return "invalid"
    if "incomplete" in statuses:
        return "incomplete"
    if "unsupported" in statuses:
        return "unsupported"

    observations = evidence.get("observations")
    if not isinstance(observations, list):
        return "invalid"
    by_id = {
        item.get("invocation_id"): item
        for item in observations
        if isinstance(item, Mapping) and isinstance(item.get("invocation_id"), str)
    }
    try:
        field_requirements = list(required_fields)
    except TypeError:
        return "invalid"
    for requirement in field_requirements:
        if (
            not isinstance(requirement, tuple)
            or len(requirement) != 2
            or not all(isinstance(value, str) and value for value in requirement)
        ):
            return "invalid"
        invocation_id, field_name = requirement
        item = by_id.get(invocation_id)
        if not isinstance(item, Mapping) or field_name not in OBSERVATION_KEYS:
            return "unsupported"
        raw = item.get(field_name)
        if field_name in {"mode", "outcome", "start_sequence"}:
            continue
        state = raw.get("state") if isinstance(raw, Mapping) else None
        if state == "unsupported":
            return "unsupported"
        if state in {"redacted", "omitted"}:
            return "incomplete"
        if state != "available":
            return "invalid"
    return "complete"
