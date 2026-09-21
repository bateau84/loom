#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sqlite3
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_IMAGES = {
    "opencode": "ghcr.io/bateau84/opencode-eval-runner:opencode-edge",
    "github-copilot-cli": "ghcr.io/bateau84/opencode-eval-runner:copilot-edge",
}
DEFAULT_SUITES = [
    ROOT / "evals" / "authority.json",
    ROOT / "evals" / "everyday.json",
    ROOT / "evals" / "front-door.json",
    ROOT / "evals" / "verification.json",
]
PROVIDER_ENVS = ("OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY")
COPILOT_ENVS = ("COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN")

JUDGE_AGENT = """---
description: Strict semantic judge for Loom behavioral evals
mode: primary
permissions:
  - action: "*"
    resource: "*"
    effect: deny
---

You are a strict behavioral evaluator.

Judge only whether the observed assistant behavior satisfies the supplied expectations and avoids each forbidden behavior.

Execution-mode rule:
- role-decision: mutation and subagent tools are intentionally unavailable. Grade the exact production decision/action the assistant states. A clear present-tense decision such as "Dispatch Diagnostic now" counts; do not require impossible tool execution or completed side effects.
- runtime: grade what actually happened. Do not credit promised or hypothetical tool use when the case requires an observed action.

Do not reward vague intent or plausible future behavior that was neither expressed as the current production decision nor observed as a runtime action.

Return STRICT JSON only:
{
  "passed": true,
  "expectations": [
    {"expectation":"...", "met":true, "reason":"brief evidence"}
  ],
  "violations": [
    {"rule":"...", "violated":false, "reason":"brief evidence"}
  ],
  "summary":"one concise sentence"
}

Every supplied expectation and forbidden rule must appear exactly once in the corresponding array.
"""


def strip_frontmatter(text: str) -> str:
    if not text.startswith("---\n"):
        return text
    end = text.find("\n---\n", 4)
    return text if end < 0 else text[end + 5 :]


def promote_agent(text: str) -> str:
    if re.search(r"^mode:\s*subagent\s*$", text, flags=re.M):
        return re.sub(r"^mode:\s*subagent\s*$", "mode: primary", text, count=1, flags=re.M)
    if re.search(r"^mode:\s*(primary|all)\s*$", text, flags=re.M):
        return text
    if text.startswith("---\n"):
        return text.replace("---\n", "---\nmode: primary\n", 1)
    return "---\nmode: primary\ndescription: Loom behavioral eval target\n---\n\n" + text


def decision_agent(text: str, agent: str) -> str:
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
""" % (agent, strip_frontmatter(text))


def load_cases(suite_paths: list[Path]) -> list[dict[str, Any]]:
    cases: list[dict[str, Any]] = []
    for path in suite_paths:
        data = json.loads(path.read_text(encoding="utf-8"))
        cases.extend(data["cases"])
    return cases


def safe_fixture_path(project: Path, value: str) -> Path:
    if not value or value.startswith("/") or ".." in Path(value).parts:
        raise RuntimeError("unsafe fixture path: " + value)
    target = (project / value).resolve()
    target.relative_to(project.resolve())
    return target


def write_project_config(project: Path, agent: str) -> None:
    (project / "opencode.json").write_text(
        json.dumps({"$schema": "https://opencode.ai/config.json", "default_agent": agent}, indent=2) + "\n",
        encoding="utf-8",
    )


def setup_projects(case: dict[str, Any]) -> tuple[Path, Path, Path]:
    temp = Path(tempfile.mkdtemp(prefix="loom-eval-" + case["id"].lower() + "-"))
    target_project = temp / "target"
    judge_project = temp / "judge"

    target_oc = target_project / ".opencode"
    judge_oc = judge_project / ".opencode"
    (target_oc / "agents").mkdir(parents=True)
    (target_oc / "skills").mkdir(parents=True)
    (judge_oc / "agents").mkdir(parents=True)

    shutil.copytree(ROOT / "skills", target_oc / "skills", dirs_exist_ok=True)

    source_agent = (ROOT / "agents" / (case["agent"] + ".md")).read_text(encoding="utf-8")
    target_agent = (
        promote_agent(source_agent)
        if case["execution"] == "runtime"
        else decision_agent(source_agent, case["agent"])
    )
    (target_oc / "agents" / (case["agent"] + ".md")).write_text(target_agent, encoding="utf-8")
    (judge_oc / "agents" / "eval-judge.md").write_text(JUDGE_AGENT, encoding="utf-8")

    for fixture in case.get("fixture_files", []):
        path = safe_fixture_path(target_project, fixture["path"])
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(fixture["content"], encoding="utf-8")

    write_project_config(target_project, case["agent"])
    write_project_config(judge_project, "eval-judge")
    return temp, target_project, judge_project


def resolve_engine(requested: str) -> str:
    if requested != "auto":
        if not shutil.which(requested):
            raise RuntimeError("container engine not found: " + requested)
        return requested
    for candidate in ("podman", "docker"):
        if shutil.which(candidate):
            return candidate
    raise RuntimeError("no supported container engine found; install podman or docker")


def default_auth_path() -> Path:
    base = Path(os.environ.get("XDG_DATA_HOME", str(Path.home() / ".local" / "share")))
    return base / "opencode" / "auth.json"


def default_models_path() -> Path:
    base = Path(os.environ.get("XDG_CACHE_HOME", str(Path.home() / ".cache")))
    return base / "opencode" / "models.json"


def default_database_path() -> Path:
    base = Path(os.environ.get("XDG_DATA_HOME", str(Path.home() / ".local" / "share")))
    return base / "opencode" / "opencode.db"


def sanitize_database_seed(source: Path, destination: Path) -> Path:
    source = source.expanduser().resolve()
    destination = destination.resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.unlink(missing_ok=True)

    def quote(identifier: str) -> str:
        return '"' + identifier.replace('"', '""') + '"'

    try:
        with sqlite3.connect(f"file:{source}?mode=ro", uri=True) as src_db, sqlite3.connect(destination) as dst_db:
            schema = src_db.execute(
                "SELECT type, name, sql FROM sqlite_master "
                "WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' "
                "ORDER BY CASE type "
                "WHEN 'table' THEN 0 WHEN 'index' THEN 1 "
                "WHEN 'view' THEN 2 WHEN 'trigger' THEN 3 ELSE 4 END, name"
            ).fetchall()
            tables = {name for object_type, name, _ in schema if object_type == "table"}
            if "credential" not in tables or "session" not in tables:
                raise RuntimeError("OpenCode V2 database is missing credential/session schema")

            dst_db.execute("PRAGMA foreign_keys=OFF")
            for object_type, _, sql in schema:
                if object_type == "table":
                    dst_db.execute(sql)

            for table in ("credential", "migration", "__drizzle_migrations"):
                if table not in tables:
                    continue
                columns = [row[1] for row in src_db.execute(f"PRAGMA table_info({quote(table)})")]
                if not columns:
                    continue
                column_sql = ", ".join(quote(column) for column in columns)
                placeholders = ", ".join("?" for _ in columns)
                rows = src_db.execute(f"SELECT {column_sql} FROM {quote(table)}").fetchall()
                if rows:
                    dst_db.executemany(
                        f"INSERT INTO {quote(table)} ({column_sql}) VALUES ({placeholders})",
                        rows,
                    )

            for object_type, _, sql in schema:
                if object_type != "table":
                    dst_db.execute(sql)

            dst_db.commit()
            dst_db.execute("PRAGMA journal_mode=DELETE")
            dst_db.execute("VACUUM")
    except sqlite3.Error as exc:
        destination.unlink(missing_ok=True)
        raise RuntimeError(f"failed to prepare sanitized OpenCode database: {exc}") from exc
    except RuntimeError:
        destination.unlink(missing_ok=True)
        raise

    destination.chmod(0o600)
    return destination


def resolve_optional_file(explicit: str | None, env_name: str, fallback: Path | None = None) -> Path | None:
    raw = explicit or os.environ.get(env_name)
    if raw:
        path = Path(raw).expanduser().resolve()
        if not path.is_file():
            raise RuntimeError(f"{env_name} file not found: {path}")
        return path
    if fallback and fallback.is_file():
        return fallback.resolve()
    return None


def volume(source: Path, target: str, readonly: bool) -> list[str]:
    return ["--volume", f"{source.resolve()}:{target}:{'ro' if readonly else 'rw'}"]


def host_environment_for_transport(transport: str) -> dict[str, str]:
    env = dict(os.environ)
    if transport != "github-copilot-cli" or any(env.get(name, "").strip() for name in COPILOT_ENVS):
        return env

    gh = shutil.which("gh")
    if not gh:
        return env

    try:
        proc = subprocess.run(
            [gh, "auth", "token"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return env

    token = proc.stdout.strip() if proc.returncode == 0 else ""
    if token:
        env["COPILOT_GITHUB_TOKEN"] = token
    return env


def pass_env(command: list[str], names: tuple[str, ...] | list[str], host_env: dict[str, str]) -> None:
    for name in names:
        if host_env.get(name):
            command += ["--env", name]


def image_for_transport(args: argparse.Namespace, transport: str) -> str:
    if args.image:
        return args.image
    if transport == "opencode":
        return (
            args.opencode_image
            or os.environ.get("OPENCODE_EVAL_RUNNER_OPENCODE_IMAGE")
            or DEFAULT_IMAGES["opencode"]
        )
    return (
        args.copilot_image
        or os.environ.get("OPENCODE_EVAL_RUNNER_COPILOT_IMAGE")
        or DEFAULT_IMAGES["github-copilot-cli"]
    )


def invoke_container(
    *,
    engine: str,
    image: str,
    transport: str,
    model: str,
    agent: str,
    prompt: str,
    system: str,
    project: Path,
    auth: Path | None,
    config: Path | None,
    models_catalog: Path | None,
    database_seed: Path | None,
    config_root: Path | None,
    expected_plugin: str | None,
    timeout: int,
    container_timeout: int,
    mount_node_modules: bool,
    extra_envs: list[str],
) -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="loom-eval-invoke-") as tmp:
        root = Path(tmp)
        input_dir = root / "input"
        input_dir.mkdir()
        (input_dir / "prompt.txt").write_text(prompt, encoding="utf-8")
        (input_dir / "system.txt").write_text(system, encoding="utf-8")

        command = [
            engine,
            "run",
            "--rm",
            "--read-only",
            "--tmpfs",
            "/tmp:rw,exec,nosuid,nodev,size=1g",
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges",
        ]
        if engine == "podman":
            # The eval-runner image uses dedicated UID/GID 1000. Map the
            # invoking host user onto that identity so private read-only seed
            # files remain readable without running the container as root.
            command += ["--userns", "keep-id:uid=1000,gid=1000"]
            # Avoid SELinux bind-mount denial without mutating labels on the
            # user's repository, node_modules, or auth/config seed files.
            command += ["--security-opt", "label=disable"]
        elif hasattr(os, "getuid") and os.getuid() != 0:
            # Rootful Docker preserves numeric ownership on bind mounts.
            # Match the non-root host caller so private seed files stay
            # readable. A root caller leaves the image's non-root USER intact.
            command += ["--user", f"{os.getuid()}:{os.getgid()}"]
        command += [
            "--workdir",
            "/workspace",
        ]
        command += volume(project, "/workspace", True)
        command += volume(input_dir, "/input", True)

        if mount_node_modules:
            node_modules = ROOT / "node_modules"
            if not node_modules.is_dir():
                raise RuntimeError("runtime eval requires node_modules; run bun install first")
            command += volume(node_modules, "/workspace/node_modules", True)

        if auth:
            command += volume(auth, "/seed/auth.json", True)
        if config:
            command += volume(config, "/seed/opencode.json", True)
        if models_catalog:
            command += volume(models_catalog, "/seed/models.json", True)
        if database_seed:
            command += volume(database_seed, "/seed/opencode.db", True)
        if config_root:
            command += volume(config_root, "/seed/opencode-config", True)

        command += [
            "--env",
            f"EVAL_TRANSPORT={transport}",
            "--env",
            f"EVAL_MODEL={model}",
            "--env",
            f"EVAL_AGENT={agent}",
            "--env",
            "EVAL_PROMPT_FILE=/input/prompt.txt",
            "--env",
            "EVAL_SYSTEM_FILE=/input/system.txt",
            "--env",
            f"EVAL_TIMEOUT_SECONDS={timeout}",
        ]
        if expected_plugin:
            command += ["--env", f"EVAL_EXPECT_PLUGIN={expected_plugin}"]
        host_env = host_environment_for_transport(transport)
        pass_env(command, PROVIDER_ENVS, host_env)
        if transport == "github-copilot-cli":
            pass_env(command, COPILOT_ENVS, host_env)
        pass_env(command, extra_envs, host_env)
        command.append(image)

        proc = subprocess.run(
            command,
            cwd=ROOT,
            env=host_env,
            capture_output=True,
            text=True,
            timeout=container_timeout,
            check=False,
        )
        try:
            result = json.loads(proc.stdout)
        except json.JSONDecodeError as exc:
            detail = " | ".join(part.strip() for part in (proc.stderr, proc.stdout) if part.strip())
            return {
                "exit_code": proc.returncode,
                "text": "",
                "tools": [],
                "stderr": (
                    "container result was invalid JSON: " + str(exc)
                    + (": " + detail[:4000] if detail else "")
                ),
                "stdout": proc.stdout[:100000],
                "infrastructure_error": True,
            }
        if not isinstance(result, dict):
            return {
                "exit_code": proc.returncode,
                "text": "",
                "tools": [],
                "stderr": "container result was not an object",
                "stdout": "",
                "infrastructure_error": True,
            }
        return result


def normalize_tool(value: str) -> str:
    match = re.fullmatch(r"mcp__([^_]+)__(.+)", value)
    if match:
        value = match.group(1) + "_" + match.group(2)
    return value.replace(".", "_")


def extract_observed_actions(raw_stdout: str) -> list[dict[str, Any]]:
    actions: list[dict[str, Any]] = []
    for raw in raw_stdout.splitlines():
        try:
            event = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if not isinstance(event, dict) or event.get("type") != "tool_use":
            continue
        part = event.get("part")
        if not isinstance(part, dict) or part.get("type") != "tool" or not isinstance(part.get("tool"), str):
            continue
        state = part.get("state")
        args = state.get("input") if isinstance(state, dict) and isinstance(state.get("input"), dict) else {}
        actions.append({"tool": part["tool"], "args": args})
    return actions


def normalized_target_actions(target: dict[str, Any]) -> list[dict[str, Any]]:
    value = target.get("actions")
    if isinstance(value, list):
        normalized: list[dict[str, Any]] = []
        for item in value:
            if not isinstance(item, dict) or not isinstance(item.get("tool"), str):
                continue
            args = item.get("args")
            normalized.append({
                "tool": item["tool"],
                "args": args if isinstance(args, dict) else {},
            })
        if normalized:
            return normalized
    return extract_observed_actions(str(target.get("stdout") or ""))


def resolve_action_arg(args: dict[str, Any], dotted: str) -> Any:
    value: Any = args
    for segment in dotted.split("."):
        if not isinstance(value, dict) or segment not in value:
            return None
        value = value[segment]
    return value


def action_matches(action: dict[str, Any], assertion: dict[str, Any]) -> bool:
    if normalize_tool(str(action.get("tool") or "")) != normalize_tool(str(assertion.get("tool") or "")):
        return False
    value = resolve_action_arg(action.get("args") if isinstance(action.get("args"), dict) else {}, str(assertion.get("arg") or ""))
    if "equals" in assertion:
        return value == assertion["equals"]
    if "ends_with" in assertion:
        return isinstance(value, str) and value.endswith(str(assertion["ends_with"]))
    return False


def describe_action(assertion: dict[str, Any]) -> str:
    comparator = "equals" if "equals" in assertion else "ends_with"
    return "%s %s %s %r" % (
        assertion.get("tool"),
        assertion.get("arg"),
        comparator,
        assertion.get(comparator),
    )


def deterministic_failures(
    case: dict[str, Any],
    tools: list[str],
    actions: list[dict[str, Any]] | None = None,
) -> list[str]:
    failures: list[str] = []
    assertions = case.get("tools") or {}
    normalized = {normalize_tool(tool) for tool in tools}
    for required in assertions.get("requires", []):
        if normalize_tool(required) not in normalized:
            failures.append("required tool not observed: " + required)
    for forbidden in assertions.get("forbids", []):
        if normalize_tool(forbidden) in normalized:
            failures.append("forbidden tool observed: " + forbidden)

    observed_actions = actions or []
    action_assertions = case.get("actions") or {}
    for required in action_assertions.get("requires", []):
        if not any(action_matches(action, required) for action in observed_actions):
            failures.append("required action not observed: " + describe_action(required))
    for forbidden in action_assertions.get("forbids", []):
        if any(action_matches(action, forbidden) for action in observed_actions):
            failures.append("forbidden action observed: " + describe_action(forbidden))
    return failures


def judge_prompt(case: dict[str, Any], text: str, tools: list[str]) -> str:
    lines = [
        "Evaluate this Loom behavioral case.",
        "",
        "CASE: " + case["id"],
        "EXECUTION MODE: " + case["execution"],
        "TRAP: " + case["trap"],
        "",
        "POSITIVE EXPECTATIONS:",
    ]
    lines += [str(i + 1) + ". " + value for i, value in enumerate(case["expectations"])]
    lines += ["", "FORBIDDEN BEHAVIOR:"]
    lines += [str(i + 1) + ". " + value for i, value in enumerate(case["must_not"])]
    lines += [
        "",
        "OBSERVED TOOLS:",
        ", ".join(tools) if tools else "(none)",
        "",
        "OBSERVED ASSISTANT TEXT:",
        text[:30000] if text else "(no assistant text observed)",
        "",
        "Return the required strict JSON judgment.",
    ]
    return "\n".join(lines)


def parse_judge(text: str) -> dict[str, Any]:
    cleaned = text.strip()
    cleaned = re.sub(r"^~~~(?:json)?\s*", "", cleaned, flags=re.I)
    cleaned = re.sub(r"\s*~~~$", "", cleaned)
    cleaned = re.sub(r"^\`\`\`(?:json)?\s*", "", cleaned, flags=re.I)
    cleaned = re.sub(r"\s*\`\`\`$", "", cleaned)
    value = json.loads(cleaned)
    if not isinstance(value, dict) or not isinstance(value.get("passed"), bool):
        raise ValueError("judge result missing boolean passed")
    if not isinstance(value.get("expectations"), list) or not isinstance(value.get("violations"), list):
        raise ValueError("judge result missing expectation/violation arrays")
    return value


def target_prompt(case: dict[str, Any]) -> str:
    if case["execution"] == "runtime":
        return case["prompt"]
    return case["prompt"] + "\n\nRespond with the production decision/action for this scenario. Do not claim to have executed unavailable tools."


def transport_error(result: dict[str, Any]) -> str | None:
    if result.get("infrastructure_error") is True:
        return str(result.get("stderr") or "container infrastructure failure")
    if result.get("exit_code") != 0:
        detail = str(result.get("stderr") or result.get("stdout") or "").strip()
        return "transport exited %s%s" % (
            result.get("exit_code"),
            (": " + detail[:2000].replace("\n", " | ")) if detail else "",
        )
    if not str(result.get("text") or "").strip():
        return "transport produced no usable assistant text"
    return None


def run_case(
    case: dict[str, Any],
    args: argparse.Namespace,
    engine: str,
    iteration: int = 1,
) -> dict[str, Any]:
    if case["execution"] == "runtime" and args.target_transport != "opencode":
        raise RuntimeError(f"{case['id']} is runtime mode and requires --target-transport opencode")

    temp, target_project, judge_project = setup_projects(case)
    auth = resolve_optional_file(args.auth, "OPENCODE_EVAL_RUNNER_AUTH", default_auth_path())
    config = resolve_optional_file(args.provider_config, "OPENCODE_EVAL_RUNNER_CONFIG")
    models_catalog = resolve_optional_file(
        args.models_catalog,
        "OPENCODE_EVAL_RUNNER_MODELS",
        default_models_path(),
    )
    database_source = resolve_optional_file(
        args.database,
        "OPENCODE_EVAL_RUNNER_DB",
        default_database_path(),
    )
    database_seed = (
        sanitize_database_seed(database_source, temp / "opencode-credentials.db")
        if database_source and "opencode" in {args.target_transport, args.judge_transport}
        else None
    )
    judge_model = args.judge_model or args.model

    if args.judge_transport != args.target_transport and not args.judge_model:
        raise RuntimeError("--judge-model is required when target and judge transports differ")

    try:
        target_system = ""
        if args.target_transport == "github-copilot-cli":
            target_agent_text = (target_project / ".opencode" / "agents" / (case["agent"] + ".md")).read_text(encoding="utf-8")
            target_system = strip_frontmatter(target_agent_text)

        target_image = image_for_transport(args, args.target_transport)
        judge_image = image_for_transport(args, args.judge_transport)

        target = invoke_container(
            engine=engine,
            image=target_image,
            transport=args.target_transport,
            model=args.model,
            agent=case["agent"],
            prompt=target_prompt(case),
            system=target_system,
            project=target_project,
            auth=auth,
            config=config,
            models_catalog=models_catalog,
            database_seed=database_seed,
            config_root=ROOT if case["execution"] == "runtime" and args.target_transport == "opencode" else None,
            expected_plugin="loom" if case["execution"] == "runtime" and args.target_transport == "opencode" else None,
            timeout=args.timeout_seconds,
            container_timeout=args.container_timeout,
            mount_node_modules=case["execution"] == "runtime",
            extra_envs=args.env,
        )
        target_error = transport_error(target)
        observed_actions = normalized_target_actions(target) if not target_error else []
        deterministic = (
            deterministic_failures(case, list(target.get("tools") or []), observed_actions)
            if not target_error
            else []
        )

        judge_result: dict[str, Any] | None = None
        judge: dict[str, Any] | None = None
        judge_error: str | None = None

        if not target_error:
            judge_result = invoke_container(
                engine=engine,
                image=judge_image,
                transport=args.judge_transport,
                model=judge_model,
                agent="eval-judge",
                prompt=judge_prompt(case, str(target.get("text") or ""), list(target.get("tools") or [])),
                system=strip_frontmatter(JUDGE_AGENT) if args.judge_transport == "github-copilot-cli" else "",
                project=judge_project,
                auth=auth,
                config=config,
                models_catalog=models_catalog,
                database_seed=database_seed,
                config_root=None,
                expected_plugin=None,
                timeout=args.timeout_seconds,
                container_timeout=args.container_timeout,
                mount_node_modules=False,
                extra_envs=args.env,
            )
            judge_error = transport_error(judge_result)
            if not judge_error:
                try:
                    judge = parse_judge(str(judge_result.get("text") or ""))
                except Exception as exc:
                    judge_error = "judge parse failed: " + str(exc)

        non_evidence = target_error is not None or judge_error is not None
        passed = (
            not non_evidence
            and not deterministic
            and isinstance(judge, dict)
            and judge.get("passed") is True
        )
        classification = "pass" if passed else "non-evidence" if non_evidence else "behavioral-fail"

        artifact = {
            "case": case["id"],
            "iteration": iteration,
            "agent": case["agent"],
            "execution": case["execution"],
            "target_image": target_image,
            "judge_image": judge_image,
            "container_engine": engine,
            "target_transport": args.target_transport,
            "judge_transport": args.judge_transport,
            "model": args.model,
            "judge_model": judge_model,
            "classification": classification,
            "passed": passed,
            "target": target,
            "target_error": target_error,
            "observed_actions": observed_actions,
            "deterministic_failures": deterministic,
            "judge_transport_result": judge_result,
            "semantic": judge,
            "judge_error": judge_error,
        }
        artifact_dir = Path(args.artifact_dir)
        artifact_dir.mkdir(parents=True, exist_ok=True)
        artifact_name = (
            case["id"] + ".json"
            if args.iterations == 1
            else f"{case['id']}.iteration-{iteration}.json"
        )
        (artifact_dir / artifact_name).write_text(
            json.dumps(artifact, indent=2) + "\n",
            encoding="utf-8",
        )
        return artifact
    finally:
        if args.keep_temp:
            label = case["id"] if args.iterations == 1 else f"{case['id']}#{iteration}"
            print("KEEP %s: %s" % (label, temp))
        else:
            shutil.rmtree(temp, ignore_errors=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Run Loom behavioral evals in isolated OCI model invocations.")
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--cases", default="")
    parser.add_argument("--suite", action="append", default=[])
    parser.add_argument("--model")
    parser.add_argument("--judge-model")
    parser.add_argument("--target-transport", choices=("opencode", "github-copilot-cli"), default="opencode")
    parser.add_argument("--judge-transport", choices=("opencode", "github-copilot-cli"), default="opencode")
    parser.add_argument("--engine", choices=("auto", "podman", "docker"), default="auto")
    parser.add_argument("--image", help="Override both transport images with one explicit image.")
    parser.add_argument("--opencode-image")
    parser.add_argument("--copilot-image")
    parser.add_argument("--auth")
    parser.add_argument("--provider-config")
    parser.add_argument("--models-catalog")
    parser.add_argument("--database")
    parser.add_argument("--env", action="append", default=[], metavar="NAME")
    parser.add_argument("--artifact-dir", default=str(ROOT / ".loom-evals"))
    parser.add_argument("--timeout-seconds", type=int, default=240)
    parser.add_argument("--container-timeout", type=int, default=300)
    parser.add_argument(
        "--iterations",
        type=int,
        default=1,
        help="Run each selected case N times (default: 1).",
    )
    parser.add_argument(
        "--parallel",
        nargs="?",
        const=0,
        type=int,
        default=1,
        metavar="N",
        help="Run cases concurrently. Without N, run the full case×iteration matrix in parallel; with N, cap concurrency.",
    )
    parser.add_argument("--keep-temp", action="store_true")
    parser.add_argument("--list", action="store_true")
    args = parser.parse_args()

    suite_paths = [Path(value).resolve() for value in args.suite] if args.suite else DEFAULT_SUITES
    cases = load_cases(suite_paths)

    if args.list:
        for case in cases:
            print("%s\t%s\t%s\t%s" % (
                case["id"],
                case["agent"],
                case["execution"],
                ",".join(case["requirements"]),
            ))
        return 0

    if not args.model:
        parser.error("live evals require --model")
    if args.iterations < 1:
        parser.error("--iterations must be >= 1")
    if args.parallel < 0:
        parser.error("--parallel must be >= 1 when a limit is supplied")

    selected_ids = {value.strip() for value in args.cases.split(",") if value.strip()}
    if not args.all and not selected_ids:
        parser.error("live evals spend model inference; pass --cases ID1,ID2 or --all explicitly")

    known = {case["id"] for case in cases}
    missing = sorted(selected_ids - known)
    if missing:
        parser.error("unknown case id(s): " + ", ".join(missing))

    engine = resolve_engine(args.engine)
    selected = [case for case in cases if args.all or case["id"] in selected_ids]
    jobs = [
        (case, iteration)
        for case in selected
        for iteration in range(1, args.iterations + 1)
    ]
    concurrency = len(jobs) if args.parallel == 0 else min(args.parallel, len(jobs))
    mode = "parallel=%d" % concurrency if concurrency > 1 else "sequential"
    print(
        "Running %d Loom live behavioral eval run(s) (%d case(s) x %d iteration(s)) via %s "
        "(%s target / %s judge, %s)..."
        % (
            len(jobs),
            len(selected),
            args.iterations,
            engine,
            args.target_transport,
            args.judge_transport,
            mode,
        )
    )

    def label(case: dict[str, Any], iteration: int) -> str:
        return case["id"] if args.iterations == 1 else f"{case['id']}#{iteration}"

    def execute(job: tuple[dict[str, Any], int]) -> tuple[dict[str, Any], int, dict[str, Any] | None, str | None]:
        case, iteration = job
        try:
            return case, iteration, run_case(case, args, engine, iteration), None
        except subprocess.TimeoutExpired:
            return case, iteration, None, "target or judge container timed out"
        except Exception as exc:
            return case, iteration, None, str(exc)

    def report(case: dict[str, Any], iteration: int, result: dict[str, Any] | None, error: str | None) -> bool:
        prefix = "%s [%s/%s]" % (label(case, iteration), case["agent"], case["execution"])
        if error is not None:
            print(prefix + " ... ERROR")
            print("  - " + error)
            return False
        assert result is not None
        if result["classification"] == "pass":
            print(prefix + " ... PASS")
            return True
        if result["classification"] == "non-evidence":
            print(prefix + " ... ERROR")
            if result.get("target_error"):
                print("  - target: " + str(result["target_error"]))
            if result.get("judge_error"):
                print("  - judge: " + str(result["judge_error"]))
            return False

        print(prefix + " ... FAIL")
        for item in result["deterministic_failures"]:
            print("  - " + item)
        observed_tools = list((result.get("target") or {}).get("tools") or [])
        if observed_tools:
            print("  - observed tools: " + ", ".join(observed_tools))
        observed_actions = list(result.get("observed_actions") or [])
        if observed_actions:
            preview = ", ".join(
                "%s(%s)" % (
                    action.get("tool"),
                    json.dumps(action.get("args") or {}, sort_keys=True),
                )
                for action in observed_actions[:12]
            )
            print("  - observed actions: " + preview)
        semantic = result.get("semantic")
        if isinstance(semantic, dict) and semantic.get("passed") is False:
            print("  - " + str(semantic.get("summary", "semantic judge failed")))
        return False

    passed = 0
    if concurrency == 1:
        for job in jobs:
            case, iteration, result, error = execute(job)
            if report(case, iteration, result, error):
                passed += 1
    else:
        with ThreadPoolExecutor(max_workers=concurrency) as pool:
            futures = [pool.submit(execute, job) for job in jobs]
            for future in as_completed(futures):
                case, iteration, result, error = future.result()
                if report(case, iteration, result, error):
                    passed += 1

    print("%d/%d passed" % (passed, len(jobs)))
    return 0 if passed == len(jobs) else 1


if __name__ == "__main__":
    raise SystemExit(main())
