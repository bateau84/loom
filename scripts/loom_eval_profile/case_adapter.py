"""Loom-owned case discovery and target workspace preparation.

This adapter migrates only normal, non-ablation behavioral cases. Generic
selection, scheduling, retries, evidence readiness, judging, classification,
and artifact persistence remain owned by opencode-eval-runner.
"""

from __future__ import annotations

import json
import re
import shutil
import tempfile
from collections.abc import Iterator, Mapping, Sequence
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from runner.eval_api import InvocationSpec, JsonValue, NormalizedCase

from ._shared import PreparedLoomCase, compatibility_env_names


ROOT = Path(__file__).resolve().parents[2]
EVALS_DIR = "evals"
VALID_EXECUTIONS = {"role-decision", "conversation-response", "runtime"}
DEFAULT_TARGET_TIMEOUT_SECONDS = 240
DEFAULT_CONTAINER_TIMEOUT_SECONDS = 300
TARGET_MODEL_OVERRIDE_REQUIRED = "invalid/loom-target-model-override-required"
RUNTIME_NODE_MODULES_TARGET = "/seed/opencode-config/node_modules"


def _strip_frontmatter(text: str) -> str:
    if not text.startswith("---\n"):
        return text
    _, marker, body = text.partition("\n---\n")
    return body if marker else text


def _promote_agent(text: str) -> str:
    if text.startswith("---\n"):
        marker = "\n---\n"
        end = text.find(marker, 4)
        if end != -1:
            head = text[:end]
            tail = text[end:]
            if "mode: subagent" in head:
                head = head.replace("mode: subagent", "mode: primary", 1)
            elif "mode: primary" not in head and "mode: all" not in head:
                head += "\nmode: primary"
            return head + tail
    return "---\nmode: primary\n---\n\n" + text


def _decision_agent(text: str, agent: str) -> str:
    return """---
description: Behavioral evaluation wrapper for Loom %s
mode: primary
permissions:
  - action: "*"
    resource: "*"
    effect: deny
---

%s

## Isolated behavioral-evaluation boundary

This is a fresh-context decision test, not an active Loom workflow. Apply your production authority and judgment rules to the scenario, but do not fabricate tool results, workflow state, or successful completion. State the exact decision/action you would take and why. Do not discuss the fact that this is an evaluation.
""" % (agent, _strip_frontmatter(text))


def _conversation_response_agent(text: str, agent: str) -> str:
    return """---
description: Conversational response evaluation wrapper for Loom %s
mode: primary
permissions:
  - action: "*"
    resource: "*"
    effect: deny
---

%s

## Isolated conversational-response evaluation boundary

This is a fresh-context conversation test with all external tools intentionally unavailable. Treat supplied specialist output, repository facts, and source references in the prompt as already-returned context. Answer the user normally and usefully from that context, preserving evidence, uncertainty, and authority boundaries. Do not turn the response into a production-decision-only statement, do not fabricate additional tool results, and do not discuss the fact that this is an evaluation.
""" % (agent, _strip_frontmatter(text))


def _write_project_config(project: Path, agent: str) -> None:
    (project / "opencode.json").write_text(
        json.dumps(
            {
                "$schema": "https://opencode.ai/config.json",
                "default_agent": agent,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


def _safe_fixture_path(project: Path, value: object) -> Path:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("fixture path must be a non-empty string")
    relative = Path(value)
    if relative.is_absolute() or ".." in relative.parts:
        raise ValueError(f"unsafe fixture path: {value}")
    target = (project / relative).resolve()
    if not target.is_relative_to(project.resolve()):
        raise ValueError(f"fixture path escapes project: {value}")
    return target


def _case_data(case: NormalizedCase) -> dict[str, Any]:
    value = case.project_data
    if not isinstance(value, dict):
        raise TypeError(f"Loom case {case.id!r} project_data must be an object")
    return value


def _require_string(data: Mapping[str, object], field: str, label: str) -> str:
    value = data.get(field)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label}: {field} must be a non-empty string")
    return value


def _target_kind(data: Mapping[str, object]) -> str:
    return "skill" if data.get("skill") else "agent"


def _target_name(data: Mapping[str, object]) -> str:
    if data.get("skill"):
        return str(data["skill"])
    return str(data["agent"])


def _target_prompt(data: Mapping[str, object]) -> str:
    prompt = str(data["prompt"])
    if data["execution"] in {"runtime", "conversation-response"}:
        return prompt
    return (
        prompt
        + "\n\nRespond with the production decision/action for this scenario. "
        "Do not claim to have executed unavailable tools."
    )


class LoomCaseWorkspaceAdapter:
    """Normal Loom case/profile adapter over the runner's frozen public API."""

    def __init__(self, root: Path | None = None):
        self._root = (ROOT if root is None else root).resolve()

    @property
    def root(self) -> Path:
        return self._root

    def discover_cases(self) -> Sequence[NormalizedCase]:
        eval_root = self._root / EVALS_DIR
        if not eval_root.is_dir():
            raise RuntimeError(f"Loom eval directory not found: {eval_root}")

        normalized: list[NormalizedCase] = []
        seen_ids: dict[str, str] = {}
        for source in sorted(eval_root.glob("*.json")):
            raw_suite = json.loads(source.read_text(encoding="utf-8"))
            if not isinstance(raw_suite, dict):
                raise ValueError(f"{source.name}: suite must be a JSON object")
            if raw_suite.get("version") != 1:
                raise ValueError(f"{source.name}: suite version must be 1")
            suite_name = _require_string(raw_suite, "name", source.name)
            suite_default = raw_suite.get("default", True)
            if type(suite_default) is not bool:
                raise ValueError(f"{source.name}: suite default must be a boolean")
            raw_cases = raw_suite.get("cases")
            if not isinstance(raw_cases, list) or not raw_cases:
                raise ValueError(f"{source.name}: suite needs at least one case")

            for raw_case in raw_cases:
                case = self._normalize_case(
                    raw_case,
                    source=source,
                    suite_name=suite_name,
                    suite_default=suite_default,
                )
                prior = seen_ids.get(case.id)
                if prior is not None:
                    raise ValueError(
                        f"duplicate Loom eval case id {case.id!r}: {prior}, {source.name}"
                    )
                seen_ids[case.id] = source.name
                normalized.append(case)
        return tuple(normalized)

    def _normalize_case(
        self,
        raw_case: object,
        *,
        source: Path,
        suite_name: str,
        suite_default: bool,
    ) -> NormalizedCase:
        if not isinstance(raw_case, dict):
            raise ValueError(f"{source.name}: case must be a JSON object")
        case_id = _require_string(raw_case, "id", source.name)
        agent = _require_string(raw_case, "agent", case_id)
        execution = _require_string(raw_case, "execution", case_id)
        if execution not in VALID_EXECUTIONS:
            raise ValueError(
                f"{case_id}: execution must be role-decision, conversation-response, or runtime"
            )
        _require_string(raw_case, "prompt", case_id)

        case_default = raw_case.get("default", True)
        if type(case_default) is not bool:
            raise ValueError(f"{case_id}: default must be a boolean when present")

        skill = raw_case.get("skill")
        if skill is not None and (not isinstance(skill, str) or not skill.strip()):
            raise ValueError(f"{case_id}: skill must be a non-empty string when present")
        if skill and execution != "runtime":
            raise ValueError(f"{case_id}: skill evals require runtime execution")

        target_timeout = raw_case.get("target_timeout_seconds")
        if target_timeout is not None and (
            type(target_timeout) is not int or not 30 <= target_timeout <= 600
        ):
            raise ValueError(
                f"{case_id}: target_timeout_seconds must be an integer from 30 to 600"
            )

        source_path = source.relative_to(self._root).as_posix()
        target_kind = _target_kind(raw_case)
        target_name = _target_name(raw_case)
        selectors = list(
            dict.fromkeys(
                (
                    case_id,
                    f"suite:{suite_name}",
                    f"agent:{agent}",
                    f"execution:{execution}",
                    f"target-kind:{target_kind}",
                    f"target:{target_kind}:{target_name}",
                    *([f"skill:{skill}"] if skill else []),
                )
            )
        )
        metadata: dict[str, JsonValue] = {
            "schema": "loom-eval-case-metadata/v1",
            "source_suite": suite_name,
            "source_path": source_path,
            "suite_default": suite_default,
            "case_default": case_default,
            "default_enabled": suite_default and case_default,
            "agent": agent,
            "execution": execution,
            "target_kind": target_kind,
            "target_name": target_name,
            "skill": skill,
        }
        return NormalizedCase(
            id=case_id,
            selectors=tuple(selectors),
            lane="runtime" if execution == "runtime" else "standard",
            project_data=raw_case,
            metadata=metadata,
        )

    @contextmanager
    def prepare(
        self,
        case: NormalizedCase,
        iteration: int,
    ) -> Iterator[PreparedLoomCase]:
        if type(iteration) is not int or iteration < 1:
            raise ValueError("iteration must be an integer >= 1")
        data = _case_data(case)
        agent = _require_string(data, "agent", case.id)
        execution = _require_string(data, "execution", case.id)
        if execution not in VALID_EXECUTIONS:
            raise ValueError(f"{case.id}: unsupported execution mode {execution!r}")

        slug = re.sub(r"[^a-z0-9_.-]+", "-", case.id.lower()).strip("-") or "case"
        with tempfile.TemporaryDirectory(prefix=f"loom-eval-{slug}-") as temp:
            temp_root = Path(temp)
            target = temp_root / "target"
            judge = temp_root / "judge"
            target_agents = target / ".opencode" / "agents"
            target_skills = target / ".opencode" / "skills"
            judge_agents = judge / ".opencode" / "agents"
            target_agents.mkdir(parents=True)
            judge_agents.mkdir(parents=True)

            skill_source = self._root / "skills"
            if not skill_source.is_dir():
                raise RuntimeError(f"Loom skills directory not found: {skill_source}")
            shutil.copytree(skill_source, target_skills)

            agents_root = self._root / "agents"
            selected_agent = agents_root / f"{agent}.md"
            if not selected_agent.is_file():
                raise RuntimeError(f"Loom agent not found: {selected_agent}")

            if execution == "runtime":
                for path in sorted(agents_root.glob("*.md")):
                    body = path.read_text(encoding="utf-8")
                    if path.stem == agent:
                        body = _promote_agent(body)
                    (target_agents / path.name).write_text(body, encoding="utf-8")
                self._prepare_runtime_dependencies(target)
            else:
                body = selected_agent.read_text(encoding="utf-8")
                if execution == "role-decision":
                    body = _decision_agent(body, agent)
                else:
                    body = _conversation_response_agent(body, agent)
                (target_agents / f"{agent}.md").write_text(body, encoding="utf-8")

            fixture_files = data.get("fixture_files", [])
            if fixture_files is None:
                fixture_files = []
            if not isinstance(fixture_files, list):
                raise ValueError(f"{case.id}: fixture_files must be an array")
            for fixture in fixture_files:
                if not isinstance(fixture, dict):
                    raise ValueError(f"{case.id}: fixture entry must be an object")
                path = _safe_fixture_path(target, fixture.get("path"))
                content = fixture.get("content")
                if not isinstance(content, str):
                    raise ValueError(f"{case.id}: fixture content must be a string")
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content, encoding="utf-8")

            _write_project_config(target, agent)
            # Worker B owns the eval-judge instructions. Worker A only creates
            # the fresh judge project and selects the stable judge agent name.
            _write_project_config(judge, "eval-judge")

            yield PreparedLoomCase(
                iteration=iteration,
                target_workspace=target,
                judge_workspace=judge,
            )

    def _prepare_runtime_dependencies(self, target: Path) -> None:
        source = self._root / "node_modules"
        if not source.is_dir():
            raise RuntimeError("runtime eval requires node_modules; run bun install first")

        # Task 6 froze InvocationSpec without arbitrary mount entries. Runtime
        # config_root is nevertheless mounted read-only at this stable runner
        # path. Expose the same repository dependency tree at
        # /workspace/node_modules without copying it into the writable runtime
        # workspace or reintroducing direct-container execution.
        (target / "node_modules").symlink_to(
            RUNTIME_NODE_MODULES_TARGET,
            target_is_directory=True,
        )

    def target_spec(
        self,
        case: NormalizedCase,
        prepared: PreparedLoomCase,
    ) -> InvocationSpec:
        data = _case_data(case)
        agent = _require_string(data, "agent", case.id)
        execution = _require_string(data, "execution", case.id)
        if execution not in VALID_EXECUTIONS:
            raise ValueError(f"{case.id}: unsupported execution mode {execution!r}")

        timeout = data.get("target_timeout_seconds", DEFAULT_TARGET_TIMEOUT_SECONDS)
        if type(timeout) is not int or not 30 <= timeout <= 600:
            raise ValueError(
                f"{case.id}: target_timeout_seconds must be an integer from 30 to 600"
            )
        container_timeout = max(DEFAULT_CONTAINER_TIMEOUT_SECONDS, timeout + 60)

        system: str | None = None
        if execution != "runtime":
            wrapped_agent = (
                prepared.target_workspace / ".opencode" / "agents" / f"{agent}.md"
            )
            system = _strip_frontmatter(wrapped_agent.read_text(encoding="utf-8"))

        skill = data.get("skill")
        if skill is not None and not isinstance(skill, str):
            raise ValueError(f"{case.id}: skill must be a string")

        return InvocationSpec(
            transport="opencode",
            # The old Loom CLI required --model. The generic CLI applies its
            # explicit --target-model override after this profile hook. Keep a
            # deliberately invalid placeholder rather than silently choosing a
            # provider/model that the old interface never chose for the user.
            model=TARGET_MODEL_OVERRIDE_REQUIRED,
            reasoning=None,
            agent=agent,
            skill=skill or None,
            workspace=prepared.target_workspace,
            workspace_mode="rw" if execution == "runtime" else "ro",
            prompt=_target_prompt(data),
            system=system,
            expected_plugin="loom" if execution == "runtime" else None,
            engine="auto",
            network=None,
            image=None,
            # None delegates established OPENCODE_EVAL_RUNNER_* and normal
            # auth/database/model-catalog discovery to runner invoke.
            auth=None,
            database=None,
            models_catalog=None,
            config=None,
            config_root=self._root if execution == "runtime" else None,
            env_names=compatibility_env_names(),
            timeout_seconds=timeout,
            container_timeout=container_timeout,
        )

    def artifact_metadata(
        self,
        case: NormalizedCase,
        prepared: PreparedLoomCase,
    ) -> Mapping[str, JsonValue]:
        data = _case_data(case)
        execution = _require_string(data, "execution", case.id)
        requirements = data.get("requirements")
        if not isinstance(requirements, list) or not all(
            isinstance(item, str) for item in requirements
        ):
            raise ValueError(f"{case.id}: requirements must be a string array")

        return {
            "schema": "loom-normal-eval/v1",
            "evaluation_mode": "normal",
            "case": case.id,
            "iteration": prepared.iteration,
            "source_suite": case.metadata.get("source_suite"),
            "source_path": case.metadata.get("source_path"),
            "default_enabled": case.metadata.get("default_enabled"),
            "agent": data.get("agent"),
            "target_kind": _target_kind(data),
            "target_name": _target_name(data),
            "skill": data.get("skill"),
            "execution": execution,
            "requirements": list(requirements),
            "workspace_mode": "rw" if execution == "runtime" else "ro",
            "expected_plugin": "loom" if execution == "runtime" else None,
            "config_root": "loom-repository" if execution == "runtime" else None,
            "node_modules": (
                "config-root-readonly-bridge" if execution == "runtime" else None
            ),
        }


CASE_ADAPTER = LoomCaseWorkspaceAdapter()
