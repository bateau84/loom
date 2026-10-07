"""Deterministic Loom assertions over canonical runtime_evidence/v1."""
from __future__ import annotations

import json
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from runner.eval_api import AttemptRecord, CheckOutcome, JsonValue, NormalizedCase


@dataclass(frozen=True)
class RuntimeAssertionRequirement:
    boundaries: tuple[str, ...]
    fields: tuple[str, ...]


_RUNTIME = ("native", "code_mode_execution")
RUNTIME_ASSERTION_REQUIREMENTS = {
    "runtime_semantics": RuntimeAssertionRequirement(
        _RUNTIME, ("tool", "input", "outcome", "start_sequence", "terminal_sequence")
    ),
    "tools": RuntimeAssertionRequirement(_RUNTIME, ("tool",)),
    "actions": RuntimeAssertionRequirement(_RUNTIME, ("tool", "input")),
    "tool_results": RuntimeAssertionRequirement(
        _RUNTIME,
        ("tool", "input", "outcome", "start_sequence", "terminal_sequence", "result_or_error"),
    ),
}

_ALIASES = {
    "skill": {"name": ("name", "id"), "id": ("id", "name")},
    "read": {"filePath": ("filePath", "path"), "path": ("path", "filePath")},
}
_MISSING = object()


def case_data(case: NormalizedCase) -> Mapping[str, Any]:
    data = case.project_data
    if not isinstance(data, Mapping):
        raise TypeError("Loom normalized case project_data must be an object")
    for key in ("case", "raw_case", "source_case"):
        nested = data.get(key)
        if isinstance(nested, Mapping) and ("execution" in nested or "expectations" in nested):
            return nested
    return data


def execution(case: NormalizedCase) -> str:
    value = case_data(case).get("execution", "runtime")
    if value not in {"role-decision", "conversation-response", "runtime"}:
        raise ValueError(f"unsupported Loom execution mode: {value!r}")
    return str(value)


def _obj(data: Mapping[str, Any], key: str) -> Mapping[str, Any]:
    value = data.get(key)
    if value is None:
        return {}
    if not isinstance(value, Mapping):
        raise ValueError(f"{key} assertions must be an object")
    return value


def _nonempty(value: object) -> bool:
    return isinstance(value, list) and bool(value)


def runtime_assertion_families(case: NormalizedCase) -> tuple[str, ...]:
    data = case_data(case)
    families: list[str] = []
    if execution(case) == "runtime":
        families.append("runtime_semantics")
    tools = _obj(data, "tools")
    if _nonempty(tools.get("requires")) or _nonempty(tools.get("forbids")):
        families.append("tools")
    actions = _obj(data, "actions")
    if any(_nonempty(actions.get(k)) for k in ("requires", "any_of", "forbids")):
        families.append("actions")
    results = _obj(data, "tool_results")
    if _nonempty(results.get("requires")) or _nonempty(results.get("forbids")):
        families.append("tool_results")
    return tuple(families)


def required_boundaries(case: NormalizedCase) -> tuple[str, ...]:
    result: list[str] = []
    for family in runtime_assertion_families(case):
        for boundary in RUNTIME_ASSERTION_REQUIREMENTS[family].boundaries:
            if boundary not in result:
                result.append(boundary)
    return tuple(result)


def normalize_tool(value: str) -> str:
    match = re.fullmatch(r"mcp__([^_]+)__(.+)", value)
    if match:
        value = match.group(1) + "_" + match.group(2)
    match = re.fullmatch(r"loom\.code\.([A-Za-z0-9_-]+)", value)
    if match:
        value = "loom_" + match.group(1)
    return value.replace(".", "_")


def _field(raw: object) -> tuple[str, Any, str]:
    if not isinstance(raw, Mapping):
        return "invalid", None, "field is not an object"
    state = raw.get("state")
    if state == "available":
        if set(raw) != {"state", "value"}:
            return "invalid", None, "available field has invalid shape"
        try:
            json.dumps(raw["value"], ensure_ascii=False, allow_nan=False)
        except (TypeError, ValueError, OverflowError):
            return "invalid", None, "available field is not strict JSON"
        return "ready", raw["value"], ""
    if state in {"redacted", "omitted", "unsupported"}:
        if set(raw) != {"state", "reason"} or not isinstance(raw.get("reason"), str):
            return "invalid", None, f"{state} field has invalid shape"
        status = "unsupported" if state == "unsupported" else "incomplete"
        return status, None, f"field_{state}:{raw['reason']}"
    return "invalid", None, "field has invalid state"


def _observations(target: AttemptRecord) -> tuple[list[Mapping[str, Any]] | None, str]:
    if not isinstance(target.result, Mapping):
        return None, "target result unavailable"
    evidence = target.result.get("runtime_evidence")
    if not isinstance(evidence, Mapping):
        return None, "authoritative runtime_evidence/v1 unavailable"
    observations = evidence.get("observations")
    if not isinstance(observations, list) or not all(isinstance(v, Mapping) for v in observations):
        return None, "runtime_evidence observations invalid"
    return list(observations), ""


def target_text(target: AttemptRecord) -> tuple[str | None, str]:
    if not isinstance(target.result, Mapping) or not isinstance(target.result.get("text"), str):
        return None, "complete assistant text unavailable"
    return str(target.result["text"]), ""


def _outcome(name: str, status: str, reason: str, family: str, assertion: object = None) -> CheckOutcome:
    metadata: dict[str, JsonValue] = {"family": family}
    if assertion is not None:
        try:
            metadata["assertion"] = json.loads(json.dumps(assertion, ensure_ascii=False, allow_nan=False))
        except (TypeError, ValueError, OverflowError):
            metadata["assertion"] = str(assertion)
    return CheckOutcome(name=name, status=status, reason=reason, metadata=metadata)


def _tool_state(obs: Mapping[str, Any], expected: str) -> tuple[bool | None, str]:
    state, actual, reason = _field(obs.get("tool"))
    if state != "ready":
        return None, reason
    if not isinstance(actual, str):
        return None, "tool identity is not a string"
    return normalize_tool(actual) == normalize_tool(expected), ""


def _arg(tool: str, args: Mapping[str, Any], dotted: str) -> Any:
    value: Any = args
    for index, part in enumerate(dotted.split(".")):
        if not isinstance(value, Mapping):
            return _MISSING
        names = (part,)
        if index == 0:
            names = _ALIASES.get(normalize_tool(tool), {}).get(part, names)
        for name in names:
            if name in value:
                value = value[name]
                break
        else:
            return _MISSING
    return value


def _equal(actual: Any, expected: Any) -> bool:
    if actual is _MISSING:
        return False
    if isinstance(actual, bool) or isinstance(expected, bool):
        return type(actual) is bool and type(expected) is bool and actual == expected
    return actual == expected


def _args_match(tool: str, args: Mapping[str, Any], assertion: Mapping[str, Any]) -> bool:
    expected = assertion.get("args")
    if expected is not None:
        return isinstance(expected, Mapping) and all(_equal(_arg(tool, args, str(k)), v) for k, v in expected.items())
    if "arg" not in assertion:
        return True
    value = _arg(tool, args, str(assertion["arg"]))
    if "equals" in assertion:
        return _equal(value, assertion["equals"])
    if "ends_with" in assertion:
        return isinstance(value, str) and value.endswith(str(assertion["ends_with"]))
    if "contains" in assertion:
        return isinstance(value, str) and str(assertion["contains"]) in value
    if "contains_all" in assertion:
        parts = assertion["contains_all"]
        return isinstance(value, str) and isinstance(parts, list) and all(str(p) in value for p in parts)
    return False


def _call_state(obs: Mapping[str, Any], assertion: Mapping[str, Any]) -> tuple[bool | None, str]:
    tool = str(assertion.get("tool") or "")
    matched, reason = _tool_state(obs, tool)
    if matched is not True or ("args" not in assertion and "arg" not in assertion):
        return matched, reason
    state, args, reason = _field(obs.get("input"))
    if state != "ready":
        return None, reason
    if not isinstance(args, Mapping):
        return None, "tool input is not an object"
    return _args_match(tool, args, assertion), ""


def _existence_check(
    observations: Sequence[Mapping[str, Any]], assertion: object, *, family: str, forbidden: bool, name: str
) -> CheckOutcome:
    if family == "tools":
        expected = str(assertion)
        states = [_tool_state(obs, expected) for obs in observations]
        described = expected
    else:
        if not isinstance(assertion, Mapping):
            return _outcome(name, "non-evidence", "action assertion malformed", family, assertion)
        states = [_call_state(obs, assertion) for obs in observations]
        described = str(assertion.get("tool"))
    matched = any(state is True for state, _ in states)
    unknown = next((reason for state, reason in states if state is None), None)
    if forbidden:
        status = "fail" if matched else "non-evidence" if unknown else "pass"
        reason = f"forbidden {family[:-1]} {'observed' if matched else 'not observed'}: {described}"
    else:
        status = "pass" if matched else "non-evidence" if unknown else "fail"
        reason = f"required {family[:-1]} {'observed' if matched else 'not observed'}: {described}"
    if unknown and not matched:
        reason += f"; {unknown}"
    return _outcome(name, status, reason, family, assertion)


def _any_of(observations: Sequence[Mapping[str, Any]], group: object, name: str) -> CheckOutcome:
    if not isinstance(group, list) or not group or not all(isinstance(v, Mapping) for v in group):
        return _outcome(name, "non-evidence", "action alternatives malformed", "actions", group)
    unknown: str | None = None
    for assertion in group:
        for obs in observations:
            state, reason = _call_state(obs, assertion)
            if state is True:
                return _outcome(name, "pass", f"required action alternative observed: {assertion.get('tool')}", "actions", group)
            if state is None and unknown is None:
                unknown = reason
    status = "non-evidence" if unknown else "fail"
    reason = "cannot establish action alternatives" if unknown else "no required action alternative observed"
    return _outcome(name, status, reason + (f"; {unknown}" if unknown else ""), "actions", group)


def _before(candidate: Mapping[str, Any], earlier: Mapping[str, Any]) -> bool:
    a, b = earlier.get("start_sequence"), candidate.get("start_sequence")
    return type(a) is int and type(b) is int and a < b


def _after_state(candidate: Mapping[str, Any], observations: Sequence[Mapping[str, Any]], selector: Mapping[str, Any]) -> tuple[bool | None, str]:
    unknown: str | None = None
    for obs in observations:
        if not _before(candidate, obs):
            continue
        state, reason = _call_state(obs, selector)
        if state is True:
            return True, ""
        if state is None and unknown is None:
            unknown = reason
    return (None, unknown) if unknown else (False, "predecessor call not observed earlier")


def _path(value: Any, dotted: str) -> tuple[bool, Any]:
    for part in dotted.split("."):
        if isinstance(value, list) and part.isdecimal() and int(part) < len(value):
            value = value[int(part)]
        elif isinstance(value, Mapping) and part in value:
            value = value[part]
        else:
            return False, None
    return True, value


def _candidates(value: Any) -> list[Any]:
    result = [value]
    if isinstance(value, str):
        try:
            result.append(json.loads(value))
        except (ValueError, TypeError, RecursionError):
            pass
    for item in list(result):
        if isinstance(item, Mapping):
            for key in ("output", "content", "result"):
                if key in item:
                    result.append(item[key])
                    if isinstance(item[key], str):
                        try:
                            result.append(json.loads(item[key]))
                        except (ValueError, TypeError, RecursionError):
                            pass
    return result


def _value_matches(value: Any, assertion: Mapping[str, Any]) -> bool:
    if "json_path" in assertion:
        for candidate in _candidates(value):
            found, actual = _path(candidate, str(assertion["json_path"]))
            if found:
                return _equal(actual, assertion.get("equals"))
        return False
    rendered = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, sort_keys=True)
    if "output_contains" in assertion and str(assertion["output_contains"]) not in rendered:
        return False
    parts = assertion.get("output_contains_all")
    return not isinstance(parts, list) or all(str(part) in rendered for part in parts)


def _result_state(obs: Mapping[str, Any], assertion: Mapping[str, Any]) -> tuple[bool | None, str]:
    outcome = obs.get("outcome")
    if outcome == "missing":
        return None, "terminal outcome missing"
    if outcome not in {"success", "error"}:
        return None, "tool outcome invalid"
    if "status" in assertion:
        status = "completed" if outcome == "success" else "error"
        if assertion["status"] not in {status, outcome}:
            return False, ""
    field_name = "result" if outcome == "success" else "error"
    state, value, reason = _field(obs.get(field_name))
    if state != "ready":
        if state == "unsupported" and obs.get("mode") == "code_mode":
            reason = "Code Mode exact final result/error unsupported; " + reason
        return None, reason
    return _value_matches(value, assertion), ""


def _result_check(observations: Sequence[Mapping[str, Any]], assertion: object, *, forbidden: bool, name: str) -> CheckOutcome:
    if not isinstance(assertion, Mapping):
        return _outcome(name, "non-evidence", "tool-result assertion malformed", "tool_results", assertion)
    states = [_call_state(obs, assertion) for obs in observations]
    matches = [obs for obs, (state, _) in zip(observations, states, strict=True) if state is True]
    unknown_calls = next((reason for state, reason in states if state is None), None)
    occurrence = assertion.get("occurrence")
    if occurrence is not None:
        if type(occurrence) is not int or occurrence < 1:
            return _outcome(name, "non-evidence", "invalid occurrence selector", "tool_results", assertion)
        if unknown_calls:
            return _outcome(name, "non-evidence", "occurrence ambiguous; " + unknown_calls, "tool_results", assertion)
        matches = [matches[occurrence - 1]] if len(matches) >= occurrence else []
    selected: list[Mapping[str, Any]] = []
    unknown: str | None = None
    after = assertion.get("after")
    if after is not None and not isinstance(after, Mapping):
        return _outcome(name, "non-evidence", "after selector malformed", "tool_results", assertion)
    for obs in matches:
        if isinstance(after, Mapping):
            state, reason = _after_state(obs, observations, after)
            if state is not True:
                if state is None and unknown is None:
                    unknown = reason
                continue
        selected.append(obs)
    result_states = [_result_state(obs, assertion) for obs in selected]
    matched = any(state is True for state, _ in result_states)
    unknown = unknown or next((reason for state, reason in result_states if state is None), None)
    if not matched and not selected:
        unknown = unknown or unknown_calls
    if forbidden:
        status = "fail" if matched else "non-evidence" if unknown else "pass"
        reason = "forbidden tool result observed" if matched else "forbidden tool result not observed"
    else:
        status = "pass" if matched else "non-evidence" if unknown else "fail"
        reason = "required tool result observed" if matched else "required tool result not observed"
    if unknown and not matched:
        reason += "; " + unknown
    return _outcome(name, status, reason, "tool_results", assertion)


def _urls(text: str) -> set[str]:
    return {v.rstrip(".,;:") for v in re.findall(r'https?://[^\s<>"\[\]()]+', text)}


def _output_checks(case: NormalizedCase, target: AttemptRecord) -> list[CheckOutcome]:
    data, assertions = case_data(case), _obj(case_data(case), "output")
    if not assertions:
        return []
    text, error = target_text(target)
    if text is None:
        return [_outcome("output.text", "non-evidence", error, "output")]
    result: list[CheckOutcome] = []
    minimum = assertions.get("min_source_urls", 0)
    if type(minimum) is not int or minimum < 0:
        return [_outcome("output.min_source_urls", "non-evidence", "invalid min_source_urls", "output")]
    if minimum:
        count = len(_urls(text) & _urls(str(data.get("prompt") or "")))
        result.append(_outcome("output.min_source_urls", "pass" if count >= minimum else "fail", f"source URLs: {count}/{minimum}", "output", minimum))
    for i, value in enumerate(assertions.get("contains", [])):
        result.append(_outcome(f"output.contains[{i}]", "pass" if str(value) in text else "fail", f"required output text {'' if str(value) in text else 'not '}observed", "output", value))
    for i, value in enumerate(assertions.get("forbids", [])):
        result.append(_outcome(f"output.forbids[{i}]", "fail" if str(value) in text else "pass", f"forbidden output text {'' if str(value) in text else 'not '}observed", "output", value))
    return result


def deterministic_checks(case: NormalizedCase, target: AttemptRecord) -> tuple[CheckOutcome, ...]:
    families = runtime_assertion_families(case)
    observations, error = _observations(target) if families else ([], "")
    if observations is None:
        return (_outcome("runtime_evidence", "non-evidence", error, "runtime_evidence"),)
    data = case_data(case)
    checks: list[CheckOutcome] = []
    tools = _obj(data, "tools")
    for i, value in enumerate(tools.get("requires", [])):
        checks.append(_existence_check(observations, value, family="tools", forbidden=False, name=f"tools.requires[{i}]"))
    for i, value in enumerate(tools.get("forbids", [])):
        checks.append(_existence_check(observations, value, family="tools", forbidden=True, name=f"tools.forbids[{i}]"))
    actions = _obj(data, "actions")
    for i, value in enumerate(actions.get("requires", [])):
        checks.append(_existence_check(observations, value, family="actions", forbidden=False, name=f"actions.requires[{i}]"))
    for i, value in enumerate(actions.get("any_of", [])):
        checks.append(_any_of(observations, value, f"actions.any_of[{i}]"))
    for i, value in enumerate(actions.get("forbids", [])):
        checks.append(_existence_check(observations, value, family="actions", forbidden=True, name=f"actions.forbids[{i}]"))
    results = _obj(data, "tool_results")
    for i, value in enumerate(results.get("requires", [])):
        checks.append(_result_check(observations, value, forbidden=False, name=f"tool_results.requires[{i}]"))
    for i, value in enumerate(results.get("forbids", [])):
        checks.append(_result_check(observations, value, forbidden=True, name=f"tool_results.forbids[{i}]"))
    checks.extend(_output_checks(case, target))
    return tuple(checks)
