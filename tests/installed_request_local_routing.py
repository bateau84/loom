"""Exact OpenCode 2.3.0 request-local selection with the packed Loom candidate.

Only local in-memory native providers are used. PASS qualifies the named hook
mechanics, never real account identity, included billing or production routing.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import subprocess
import tarfile
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path
from urllib.error import HTTPError

from installed_host_smoke import (
    PrivateHost, installed_plugin_inventory, isolated_environment, require, source_inventory,
)
from installed_questions import idle, request

VERSION = "2.3.0"
PROVIDER = "request-local"


def events(root: Path) -> list[dict]:
    path = root / "request-local-events.ndjson"
    return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []


def rows(trace: list[dict], event: str, *, kind: str | None = None) -> list[dict]:
    return [item["data"] for item in trace if item["type"] == event
            and (kind is None or item["data"].get("kind") == kind)]


def selected(trace: list[dict], model: str, variant: str, kind: str = "primary") -> None:
    """Independent oracle requires both hook approval and actual local transport."""
    approved = rows(trace, "request-approved", kind=kind)
    sent = rows(trace, "transport", kind=kind)
    require(approved and sent, f"Missing native {kind} guard/transport evidence")
    expected = (PROVIDER, model, variant)
    for row in [*approved, *sent]:
        require((row.get("providerID"), row.get("modelID"), row.get("variant")) == expected,
                f"Wrong native {kind} provider/model/variant: {row}")


def lifecycle_evidence(name: str, trace: list[dict]) -> dict:
    """Scenario-specific witnesses; hook presence alone cannot prove these paths."""
    def count(event: str, kind: str) -> int:
        return len(rows(trace, event, kind=kind))

    def native(event: str, reason: str | None = None) -> list[dict]:
        return [r for r in rows(trace, "native-lifecycle") if r["eventType"] == event
                and (reason is None or r.get("reason") == reason)]

    def indices(event: str, kind: str | None = None) -> list[int]:
        return [i for i, e in enumerate(trace) if e["type"] == event
                and (kind is None or e["data"].get("kind") == kind)]

    if name in ("native-title-preferred", "native-title-fallback"):
        # Both hooks must come from native selectTitle(), with distinguishable
        # initial refs and staged fixture policies; no manufactured resolve call.
        original = rows(trace, "resolve-input", kind="title")
        resolved = rows(trace, "resolve-output", kind="title")
        route = lambda r: (r.get("providerID"), r.get("modelID"), r.get("variant"))
        require([route(r) for r in original] == [(PROVIDER, "default", "medium"), (PROVIDER, "limited", "medium")],
                "Native title did not resolve the primary and configured preferred candidates")
        require([route(r) for r in resolved] == [(PROVIDER, "fast", "medium"), (PROVIDER, "sol", "high")],
                "Title fixture policies did not preserve distinct native candidate refs")
        expected = [(PROVIDER, "sol", "high")]
        if name.endswith("fallback"):
            expected.append((PROVIDER, "fast", "medium"))
            failure = indices("title-preferred-failure")
            sends = indices("transport", "title")
            require(len(failure) == 1 and len(sends) == 2 and sends[0] < failure[0] < sends[1],
                    "Native title fallback was not caused by a real preferred provider failure")
        else:
            require(not rows(trace, "title-preferred-failure"), "Successful preferred title unexpectedly failed")
        for event in ("request-approved", "transport"):
            require([route(r) for r in rows(trace, event, kind="title")] == expected,
                    "Native title approval/transport sequence differs from preferred/fallback selection")
        selected(trace, "fast", "medium", "primary")
        require(not rows(trace, "tool-before") and not rows(trace, "tool-after"), "Title selection invoked a tool")
        return {"title_resolutions": 2, "title_attempts": len(expected),
                "policy_source": "explicit staged fixture policies, not production authority"}
    if name == "native-automatic-compaction-reuse":
        selected(trace, "fast", "medium", "primary")
        selected(trace, "fast", "medium", "compaction")
        require(len(native("session.compaction.started", "auto")) == 1
                and len(native("session.compaction.ended", "auto")) == 1,
                "No completed native automatic compaction lifecycle")
        require(not native("session.compaction.started", "manual"), "Manual compaction cannot prove auto reuse")
        require(count("resolve-input", "compaction") == 0
                and count("request-approved", "compaction") == count("transport", "compaction") == 1,
                "Automatic compaction did not reuse the primary model with a fresh request guard")
        pressure, compacted = indices("fixture-context-pressure"), indices("transport", "compaction")
        require(len(pressure) == 1 and pressure[0] < compacted[0], "Automatic context pressure was not exercised")
        require(not rows(trace, "tool-before") and not rows(trace, "tool-after"), "Automatic compaction replayed a tool")
        return {"native_trigger": "auto", "compaction_resolutions": 0, "compaction_validations": 1,
                "compaction_attempts": 1, "trigger_source": "scripted provider reported 180000 input tokens"}
    if name == "native-compaction-prepared-retry-revocation":
        selected(trace, "fast", "medium", "compaction")
        require(count("resolve-input", "compaction") == 1
                and count("request-approved", "compaction") == 1 and count("transport", "compaction") == 2,
                "Prepared compaction retry resolve/guard/send counts changed")
        sent, failed = indices("transport", "compaction"), indices("transport-failure", "compaction")
        revoked = indices("fixture-policy-revoked")
        require(len(failed) == len(revoked) == 1 and sent[0] < failed[0] < revoked[0] < sent[1],
                "Policy was not revoked between the failed native send and prepared retry")
        require([r["fixtureQuota"] for r in rows(trace, "transport", kind="compaction")] == ["unknown", "exhausted"],
                "The second prepared compaction send did not observe revoked fixture eligibility")
        fresh = rows(trace, "fixture-policy-read", kind="generate")
        require(fresh and all(r["quota"] == "exhausted" for r in fresh)
                and count("resolve-input", "generate") == 1 and count("resolve-output", "generate") == 0
                and count("request-approved", "generate") == count("transport", "generate") == 0,
                "A fresh native request did not independently reject the revoked policy")
        require(not rows(trace, "tool-before") and not rows(trace, "tool-after"), "Prepared compaction retry replayed a tool")
        return {"compaction_resolutions": 1, "compaction_validations": 1, "compaction_attempts": 2,
                "retry_after_revocation": True, "fresh_request_after_revocation": "denied",
                "per_transport_guard_proven": False, "enforcement_status": "OBSERVED HOST GAP"}
    if name in ("native-cancellation-release-control", "native-cancellation-before-dispatch"):
        paused, released = indices("source-paused"), indices("source-released")
        require(len(paused) == len(released) == 1 and paused[0] < released[0], "Controlled source boundary was not reached and released")
        if name.endswith("release-control"):
            selected(trace, "fast", "medium", "primary")
            require(count("transport", "primary") == 1 and not native("session.execution.interrupted"),
                    "Uncancelled source-release control did not dispatch exactly once")
            return {"native_cancelled": False, "provider_attempts": 1}
        interrupted = [i for i, e in enumerate(trace) if e["type"] == "native-lifecycle"
                       and e["data"]["eventType"] == "session.execution.interrupted"]
        require(len(interrupted) == 1 and paused[0] < interrupted[0] < released[0],
                "Native interruption was not observed while policy loading was held")
        require(not rows(trace, "request-approved") and not rows(trace, "transport")
                and not rows(trace, "tool-before") and not rows(trace, "tool-after"),
                "Cancelled native work dispatched or produced tool effects after release")
        return {"native_cancelled": True, "boundary": "awaited policy source before resolution completes",
                "provider_attempts": 0, "tool_effects": 0,
                "scope": "controlled native pre-dispatch cancellation, not in-flight billing settlement"}
    return {}


def lifecycle_mutations(traces: dict[str, list[dict]]) -> list[str]:
    """Countercheck new witnesses using their real, complete native traces."""
    mutations: list[tuple[str, str, list[dict]]] = []
    title = copy.deepcopy(traces["native-title-fallback"])
    mutations.append(("title-missing-preferred-resolution", "native-title-fallback",
                      [e for e in title if not (e["type"] == "resolve-input" and e["data"].get("kind") == "title"
                                               and e["data"].get("modelID") == "limited")]))
    mutations.append(("title-missing-preferred-failure", "native-title-fallback",
                      [e for e in title if e["type"] != "title-preferred-failure"]))
    auto = copy.deepcopy(traces["native-automatic-compaction-reuse"])
    mutations.append(("auto-missing-native-trigger", "native-automatic-compaction-reuse",
                      [e for e in auto if not (e["type"] == "native-lifecycle"
                                               and e["data"]["eventType"] == "session.compaction.started")]))
    extra = copy.deepcopy(next(e for e in auto if e["type"] == "resolve-input"))
    extra["data"]["kind"] = "compaction"
    mutations.append(("auto-unexpected-compaction-resolution", "native-automatic-compaction-reuse", [*auto, extra]))
    retry = copy.deepcopy(traces["native-compaction-prepared-retry-revocation"])
    second = [i for i, e in enumerate(retry) if e["type"] == "transport" and e["data"].get("kind") == "compaction"][1]
    mutations.append(("retry-missing-second-send", "native-compaction-prepared-retry-revocation", retry[:second] + retry[second + 1:]))
    revoke = next(e for e in retry if e["type"] == "fixture-policy-revoked")
    mutations.append(("retry-revocation-after-send", "native-compaction-prepared-retry-revocation",
                      [e for e in retry if e is not revoke] + [revoke]))
    cancelled = copy.deepcopy(traces["native-cancellation-before-dispatch"])
    mutations.append(("cancel-missing-native-interruption", "native-cancellation-before-dispatch",
                      [e for e in cancelled if not (e["type"] == "native-lifecycle"
                                                    and e["data"]["eventType"] == "session.execution.interrupted")]))
    mutations.append(("cancel-unreleased-work", "native-cancellation-before-dispatch",
                      [e for e in cancelled if e["type"] != "source-released"]))
    sent = copy.deepcopy(next(e for e in traces["native-cancellation-release-control"] if e["type"] == "transport"))
    mutations.append(("cancel-late-provider-send", "native-cancellation-before-dispatch", [*cancelled, sent]))
    rejected = []
    for name, scenario, bad in mutations:
        try:
            lifecycle_evidence(scenario, bad)
        except RuntimeError:
            rejected.append(name)
        else:
            raise RuntimeError("Lifecycle oracle accepted mutation: " + name)
    return rejected


def oracle_controls() -> list[str]:
    good = [{"type": event, "data": {"kind": "primary", "providerID": PROVIDER,
             "modelID": "fast", "variant": "medium"}}
            for event in ("request-approved", "transport")]
    selected(good, "fast", "medium")
    rejected = []
    for name, bad in (
        ("missing-transport", good[:1]),
        ("missing-approval", good[1:]),
        ("wrong-transport-model", [good[0], {"type": "transport", "data": {**good[1]["data"], "modelID": "default"}}]),
        ("wrong-transport-variant", [good[0], {"type": "transport", "data": {**good[1]["data"], "variant": "low"}}]),
        ("wrong-provider", [good[0], {"type": "transport", "data": {**good[1]["data"], "providerID": "other"}}]),
    ):
        try:
            selected(bad, "fast", "medium")
        except RuntimeError:
            rejected.append(name)
        else:
            raise RuntimeError("Selection oracle accepted mutation: " + name)
    return rejected


def installed_runtime(artifact: Path, plugin: Path, repo: Path) -> dict[str, str]:
    """Bind all transitive runtime bytes to the archive, install and source."""
    paths = {"server.ts", *(str(path.relative_to(repo)) for path in (repo / "src").rglob("*") if path.is_file())}
    installed = {"server.ts", *(str(path.relative_to(plugin)) for path in (plugin / "src").rglob("*") if path.is_file())}
    require(installed == paths, "Installed runtime file inventory differs from source")
    hashes = {}
    with tarfile.open(artifact, "r:gz") as archive:
        packaged = {member.name.removeprefix("package/") for member in archive.getmembers()
                    if member.isfile() and (member.name == "package/server.ts" or member.name.startswith("package/src/"))}
        require(packaged == paths, "Packed runtime file inventory differs from source")
        for path in sorted(paths):
            member = archive.extractfile("package/" + path)
            require(member is not None, "Missing packed runtime file: " + path)
            source = (repo / path).read_bytes()
            require(member.read() == (plugin / path).read_bytes() == source,
                    "Packed/installed/source runtime mismatch: " + path)
            hashes[path] = hashlib.sha256(source).hexdigest()
    return hashes


@contextmanager
def fixture_root(output: Path):
    """Keep a sanitized audit even when an assertion fails; remove private state."""
    with tempfile.TemporaryDirectory(prefix="loom-request-local-") as temporary:
        root = Path(temporary).resolve()
        try:
            yield root
        finally:
            path = root / "request-local-events.ndjson"
            if path.exists():
                assignments = json.loads((root / "cases.json").read_text())
                labels = {sid: case["name"] for sid, case in assignments.items()}
                captured = events(root)
                safe = [{"type": event["type"], "data": {
                    key: labels.get(value, value) if key == "sessionID" else value
                    for key, value in event["data"].items()}} for event in captured]
                (output / "request-local-events.ndjson").write_text(
                    "".join(json.dumps(event, sort_keys=True) + "\n" for event in safe))


class Scenario:
    def __init__(self, host: PrivateHost, root: Path):
        self.host, self.root = host, root
        self.cases = json.loads((root / "cases.json").read_text())
        self.diagnostic_offsets: dict[str, int] = {}
        self.epoch_start = max(i for i, event in enumerate(events(root)) if event["type"] == "fixture-ready")

    def save(self) -> None:
        temp = self.root / "cases.next.json"
        temp.write_text(json.dumps(self.cases) + "\n")
        temp.replace(self.root / "cases.json")

    def create(self, name: str, *, explicit: dict | None = None,
               native_title: bool = False, **case) -> str:
        payload = {"agent": "architect", "location": {"directory": str(self.root / "project")}}
        if not native_title:
            payload["title"] = name
        if explicit is not None:
            payload["model"] = explicit
        session = request(self.host, "POST", "/api/session", payload)["id"]
        self.cases[session] = {"name": name, "nativeTitle": native_title, **case}
        self.save()
        return session

    def trace(self, session: str, start: int = 0) -> list[dict]:
        return [e for e in events(self.root)[start:] if e["data"].get("sessionID") == session]

    def wait_event(self, session: str, event: str, *, predicate=lambda row: True, timeout=10) -> None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if any(predicate(row) for row in rows(self.trace(session), event)):
                return
            time.sleep(.02)
        raise RuntimeError("Missing controlled native boundary " + event + ": " + self.cases[session]["name"])

    def prompt(self, session: str) -> tuple[int, dict]:
        start = len(events(self.root))
        before = request(self.host, "GET", f"/api/session/{session}")
        self.diagnostic_offsets[session] = Path(self.host.stderr.name).stat().st_size
        request(self.host, "POST", f"/api/session/{session}/prompt", {"text": "Exercise the private native selection fixture."})
        return start, before

    def terminal(self, session: str, start: int, before: dict) -> dict:
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            state = request(self.host, "GET", f"/api/session/{session}")
            trace = self.trace(session, start)
            if (trace and state.get("outcome") in ("succeeded", "failed", "interrupted")
                    and state.get("time", {}).get("idle") != before.get("time", {}).get("idle")):
                idle(self.host, [session])
                return state
            time.sleep(.05)
        raise RuntimeError("No new native terminal outcome for " + self.cases[session]["name"])

    def positive(self, session: str, model: str, variant: str) -> dict:
        start, before = self.prompt(session)
        result = self.terminal(session, start, before)
        require(result["outcome"] == "succeeded", "Positive native fixture failed: " + json.dumps(result))
        trace = self.trace(session, start)
        selected(trace, model, variant)
        require(result.get("model") == before.get("model"), "Resolver changed the persisted Session model")
        return self.summary(session, trace, result, model, variant)

    def negative(self, session: str, code: str) -> dict:
        start, before = self.prompt(session)
        result = self.terminal(session, start, before)
        trace = self.trace(session, start)
        require(result["outcome"] == "failed", "Expected native selection denial")
        require(not rows(trace, "transport") and not rows(trace, "tool-before"),
                "Denied request reached a provider or native tool")
        require(rows(trace, "resolve-input"), "Negative case never reached the native resolver")
        diagnostic = json.dumps(result) + Path(self.host.stderr.name).read_bytes()[
            self.diagnostic_offsets[session]:].decode(errors="replace")
        require(any(code in line and "sessionID=" + session in line for line in diagnostic.splitlines()),
                "Native denial had the wrong cause or Session: " + code)
        require(result.get("model") == before.get("model"), "Denied selection changed the Session model")
        return {**self.summary(session, trace, result), "expected_denial": code}

    def summary(self, session: str, trace: list[dict], result: dict,
                model: str | None = None, variant: str | None = None) -> dict:
        kinds = sorted({row["kind"] for row in rows(trace, "resolve-input") + rows(trace, "request-input")})
        if self.cases[session].get("nativeTitle"):
            kinds = ["primary", "title"]
        return {"name": self.cases[session]["name"], "status": "PASS",
                "evidence_kind": "installed-native-local-provider", "outcome": result.get("outcome"),
                "expected_model": model, "expected_variant": variant,
                "resolve_count": len(rows(trace, "resolve-input")),
                "request_count": len(rows(trace, "request-approved")),
                "transport_count": len(rows(trace, "transport")),
                "transport_kinds": sorted({r["kind"] for r in rows(trace, "transport")}),
                "native_tool_count": len(rows(trace, "tool-after")),
                "persisted_model": result.get("model"),
                "_session": session, "_epoch_start": self.epoch_start,
                "_from": events(self.root).index(trace[0], self.epoch_start), "_kinds": kinds}


def finalize_cases(cases: list[dict], captured: list[dict]) -> list[str]:
    """Recheck complete stopped-host traces; async tails cannot escape the oracle."""
    epochs = [i for i, event in enumerate(captured) if event["type"] == "fixture-ready"]
    lifecycle_traces = {}
    for case in cases:
        session = case.pop("_session")
        epoch = case.pop("_epoch_start")
        start = case.pop("_from")
        kinds = case.pop("_kinds")
        end = next((i for i in epochs if i > epoch), len(captured))
        all_session = [e for e in captured[epoch:end] if e["data"].get("sessionID") == session]
        trace = [e for e in captured[start:end] if e["data"].get("sessionID") == session
                 and ("kind" not in e["data"] or e["data"]["kind"] in kinds)]
        full_trace = [e for e in captured[start:end] if e["data"].get("sessionID") == session]
        evidence = lifecycle_evidence(case["name"], full_trace)
        if evidence:
            case["lifecycle_evidence"] = evidence
            lifecycle_traces[case["name"]] = full_trace
        elif "expected_denial" in case:
            require(not rows(all_session, "transport") and not rows(all_session, "tool-before")
                    and not rows(all_session, "tool-after") and not rows(all_session, "request-approved"),
                    "Denied Session acquired a later provider/tool effect: " + case["name"])
        else:
            for kind in kinds:
                selected(trace, case["expected_model"], case["expected_variant"], kind)
        case.update(resolve_count=len(rows(trace, "resolve-input")),
                    request_count=len(rows(trace, "request-approved")),
                    transport_count=len(rows(trace, "transport")),
                    transport_kinds=sorted({row["kind"] for row in rows(trace, "transport")}),
                    native_tool_count=len(rows(trace, "tool-after")), final_trace_revalidated=True)
    by_name = {case["name"]: case for case in cases}
    for name in ("native-title", "native-title-preferred-fallback"):
        entry = by_name[name]
        require(entry["transport_count"] == 2 and entry["request_count"] == 2
                and entry["resolve_count"] == 3,
                "Final title primary/preferred selection counts changed: " + name)
    require(len(rows(captured, "title-preferred-rejected", kind="title")) == 1,
            "Final title preferred/fallback rejection witness was lost")
    tool = by_name["native-tool-continuation"]
    require(tool["native_tool_count"] == 1 and tool["request_count"] == tool["transport_count"] == 2,
            "Final trace changed the single-tool continuation result")
    require(by_name["native-compaction-after-tool"]["native_tool_count"] == 0,
            "Final compaction trace contains a native tool replay")
    primary = by_name["native-primary-retry"]
    require(primary["resolve_count"] == primary["request_count"] == primary["transport_count"] == 2,
            "Final primary retry counts differ from native observation")
    compaction = by_name["native-compaction-prepared-retry"]
    require(compaction["request_count"] == 1 and compaction["transport_count"] == 2
            and compaction["native_tool_count"] == 0,
            "Final prepared-compaction retry counts or tool effects changed")
    require(len(rows(captured, "eligibility-changed", kind="compaction")) == 1,
            "Final trace lost the compaction policy-change witness")
    generated = by_name["native-generate-prepared-retry"]
    require(generated["resolve_count"] == generated["request_count"] == 1 and generated["transport_count"] == 2,
            "Final generate retry counts differ from native observation")
    require(not rows(captured, "lifecycle-observer-failure"), "Native lifecycle observer failed")
    return lifecycle_mutations(lifecycle_traces)


def agent_model(host: PrivateHost) -> dict:
    roster = json.loads(host.get("/api/agent", "agents"))["data"]
    architect = next(row for row in roster if row["id"] == "architect")
    return architect.get("model")


def start_host(cli: Path, repo: Path, plugin: Path, root: Path, env: dict,
               output: Path, label: str) -> PrivateHost:
    host = PrivateHost(str(cli), root / "project", env, output, label)
    try:
        require(json.loads(host.get("/api/info", "info")).get("version") == VERSION,
                "Wrong installed native CLI version")
        host.wait_roster("/api/plugin", "plugins", lambda plugins: all(any(
            row.get("id") == name and row.get("state", {}).get("status") == "active" for row in plugins)
            for name in ("loom", "loom.request-local.fixture")))
        return host
    except Exception:
        host.close()
        raise


def run(cli: Path, repo: Path, plugin: Path, artifact: Path, output: Path, expected_version: str) -> dict:
    output.mkdir(parents=True, exist_ok=True)
    report = {"kind": "request-local-model-selection-v230", "mechanics_status": "UNPROVEN",
              "live_routing_status": "BLOCKED", "real_account_billing_status": "UNPROVEN",
              "no_real_provider_credentials_used": True, "production_routing_activated": False,
              "host_version_required": VERSION, "sdk_version_required": VERSION,
              "cases": [], "limits": [
                  "The fixture supplies assessment and included inventory labels; these are not native authority or billing attestations.",
                  "model.request guards request preparation, not every physical retry; generate and compaction can reuse a Prepared request after eligibility changes.",
                  "Fresh-child cross-provider routing, assignment-wide admission and live provider/account guarantees are outside this qualification.",
                  "Title preferred/fallback candidates use explicitly staged fixture policies, not authenticated production policy revisions.",
                  "Automatic compaction is triggered by scripted provider-reported token pressure, not real model token usage.",
                  "Installed cancellation covers a held pre-dispatch policy read; in-flight cancellation/settlement and plugin disposal are not qualified.",
              ], "not_exercised": ["in-flight cancellation settlement", "installed plugin disposal", "fresh-child dispatch"]}
    try:
        report["candidate"] = installed_plugin_inventory(artifact, plugin, expected_version, VERSION)
        source = source_inventory(repo)
        report["source_head"] = source["head"]
        dirty = subprocess.run(["git", "-C", str(repo), "status", "--porcelain"],
                               capture_output=True, text=True, check=True)
        report["source_dirty"] = bool(dirty.stdout.strip())
        report["source_attribution"] = "Archive/install/source runtime hashes; source_head alone does not identify uncommitted bytes."
        report["runtime_sha256"] = source["runtime_sha256"]
        report["installed_runtime_sha256"] = installed_runtime(artifact, plugin, repo)
        report["runtime_bytes_match_archive_install_source"] = True
        report["fixture_sha256"] = {name: hashlib.sha256((repo / name).read_bytes()).hexdigest()
            for name in ("tests/request-local-host/server.ts", "tests/request-local-host/provider.mjs",
                         "tests/installed_request_local_routing.py")}
        report["oracle_mutations_rejected"] = oracle_controls()
        observed = subprocess.check_output([str(cli), "--version"], timeout=15, text=True).strip()
        require(observed in (VERSION, "opencode v" + VERSION), "Wrong OpenCode binary")
        report["host_version_observed"] = observed
        with fixture_root(output) as root:
            (root / "project").mkdir()
            (root / "cases.json").write_text("{}\n")
            env = isolated_environment(root)
            env["LOOM_REQUEST_LOCAL_FIXTURE"] = str(root)
            env["LOOM_REQUEST_LOCAL_PLUGIN"] = str(plugin)
            subprocess.run(["git", "init", "-q", str(root / "project")], env=env, check=True, timeout=10)
            (root / "project/.loom.yaml").write_text('{"model-routing":{"enabled":false}}\n')
            cfg = {"plugins": ["*", str(plugin), str(repo / "tests/request-local-host")],
                   "model": PROVIDER + "/limited#medium", "update": "disable", "share": "disabled",
                   "agents": {"architect": {"description": "Private native selection fixture", "mode": "primary",
                       "system": "Use only the scripted local provider.", "model": PROVIDER + "/default#medium"},
                              "title": {"description": "Native title dual-selection fixture",
                                        "model": PROVIDER + "/limited#medium"}}}
            (Path(env["OPENCODE_CONFIG_DIR"]) / "opencode.json").write_text(json.dumps(cfg) + "\n")
            host = start_host(cli, repo, plugin, root, env, output, "request-local")
            try:
                s = Scenario(host, root)
                original_agent_model = agent_model(host)
                require(original_agent_model == {"providerID": PROVIDER, "id": "default", "variant": "medium"},
                        "Expected native agent default is absent")
                ordinary = s.create("same-provider-default")
                report["cases"].append(s.positive(ordinary, "fast", "medium"))
                require(any(r["modelID"] == "default" for r in rows(s.trace(ordinary), "resolve-input", kind="primary")),
                        "The original native agent default was not observed")
                explicit = s.create("explicit-compatible", explicit={"providerID": PROVIDER, "id": "fast", "variant": "medium"})
                report["cases"].append(s.positive(explicit, "fast", "medium"))
                conflict = s.create("explicit-conflict", explicit={"providerID": PROVIDER, "id": "default", "variant": "medium"})
                report["cases"].append(s.negative(conflict, "LOOM_REQUEST_LOCAL_EXPLICIT_CHOICE"))
                for name, parameters, code in (
                    ("cross-provider-denied", {"provider": "other-provider"}, "LOOM_REQUEST_LOCAL_PROVIDER_MISMATCH"),
                    ("unsupported-variant", {"tier": "advanced", "overrideModel": "limited"}, "Variant unavailable for request-local/limited: high"),
                    ("unknown-model", {"overrideModel": "absent"}, "Model unavailable: request-local/absent"),
                    ("uncertain-assessment", {"uncertain": True}, "LOOM_REQUEST_LOCAL_UNAVAILABLE"),
                    ("unknown-billing-label", {"billing": "unknown"}, "LOOM_REQUEST_LOCAL_UNAVAILABLE"),
                    ("late-resolver-mismatch", {"lateModel": "default"}, "LOOM_MODEL_ROUTE_MISMATCH"),
                    ("exhausted-after-resolution", {"exhaustAfterResolve": True}, "LOOM_REQUEST_LOCAL_UNAVAILABLE"),
                ):
                    session = s.create(name, **parameters)
                    report["cases"].append(s.negative(session, code))
                # Requests are submitted before either is awaited. The same native
                # agent serves distinct workload policies without shared mutation.
                concurrent = [s.create("concurrent-standard", concurrent=True),
                              s.create("concurrent-frontier", tier="frontier", concurrent=True)]
                submitted = [s.prompt(session) for session in concurrent]
                for session, (start, before), model, variant in zip(concurrent, submitted, ["fast", "astra"], ["medium", "high"]):
                    result = s.terminal(session, start, before)
                    require(result["outcome"] == "succeeded", "Concurrent native request failed")
                    trace = s.trace(session, start)
                    selected(trace, model, variant)
                    require(result.get("model") == before.get("model"), "Concurrent request mutated Session choice")
                    report["cases"].append(s.summary(session, trace, result, model, variant))
                require(len(rows(events(root), "concurrent-transports")) == 1,
                        "The two native provider calls never overlapped")
                tool = s.create("native-tool-continuation", scenario="tool", tier="advanced")
                report["cases"].append(s.positive(tool, "sol", "high"))
                trace = s.trace(tool)
                require(len(rows(trace, "tool-before")) == len(rows(trace, "tool-after")) == 1,
                        "Native tool did not execute exactly once")
                require(len(rows(trace, "request-approved", kind="primary")) == 2 and
                        len(rows(trace, "transport", kind="primary")) == 2,
                        "Native tool continuation was not independently resolved and guarded")
                title = s.create("native-title", native_title=True)
                report["cases"].append(s.positive(title, "fast", "medium"))
                deadline = time.monotonic() + 10
                while not rows(s.trace(title), "transport", kind="title") and time.monotonic() < deadline:
                    time.sleep(.05)
                selected(s.trace(title), "fast", "medium", "title")
                title_after = request(host, "GET", f"/api/session/{title}")
                require(title_after.get("model") == report["cases"][-1]["persisted_model"],
                        "Native title changed the persisted Session model")
                require(len(rows(s.trace(title), "resolve-input", kind="title")) == 2
                        and len(rows(s.trace(title), "request-approved", kind="title")) == 1
                        and len(rows(s.trace(title), "transport", kind="title")) == 1,
                        "Native preferred title selection did not resolve twice and send once")
                fallback = s.create("native-title-preferred-fallback",
                                    native_title=True, titleRejectPreferred=True)
                report["cases"].append(s.positive(fallback, "fast", "medium"))
                deadline = time.monotonic() + 10
                while not rows(s.trace(fallback), "transport", kind="title") and time.monotonic() < deadline:
                    time.sleep(.05)
                fallback_trace = s.trace(fallback)
                selected(fallback_trace, "fast", "medium", "title")
                require(len(rows(fallback_trace, "resolve-input", kind="title")) == 2
                        and len(rows(fallback_trace, "title-preferred-rejected", kind="title")) == 1
                        and len(rows(fallback_trace, "request-approved", kind="title")) == 1
                        and len(rows(fallback_trace, "transport", kind="title")) == 1,
                        "Rejected speculative title choice was not followed by a single guarded fallback send")
                require(request(host, "GET", f"/api/session/{fallback}").get("model")
                        == report["cases"][-1]["persisted_model"],
                        "Native preferred-title fallback mutated persisted Session model")
                generate = s.create("native-generate")
                generate_before = request(host, "GET", f"/api/session/{generate}")
                generated = request(host, "POST", f"/api/session/{generate}/generate", {"prompt": "Private local generation"})
                require(generated.get("text") == "REQUEST_LOCAL_GENERATE_OK", "Native generate response missing")
                selected(s.trace(generate), "fast", "medium", "generate")
                generate_after = request(host, "GET", f"/api/session/{generate}")
                require(generate_after.get("model") == generate_before.get("model"), "Native generate changed Session model")
                report["cases"].append(s.summary(generate, s.trace(generate), generate_after, "fast", "medium"))
                compaction_start = len(events(root))
                compaction_before = request(host, "GET", f"/api/session/{tool}")
                request(host, "POST", f"/api/session/{tool}/compact", {})
                idle(host, [tool])
                compacted = s.trace(tool, compaction_start)
                selected(compacted, "sol", "high", "compaction")
                require(not rows(compacted, "tool-before"), "Compaction replayed a native tool")
                compaction_after = request(host, "GET", f"/api/session/{tool}")
                require(compaction_after.get("model") == compaction_before.get("model"), "Native compaction changed Session model")
                report["cases"].append({**s.summary(tool, compacted, compaction_after, "sol", "high"),
                                        "name": "native-compaction-after-tool"})
                retry = s.create("native-primary-retry", retryKind="primary")
                report["cases"].append(s.positive(retry, "fast", "medium"))
                primary_retry = s.trace(retry)
                require(len(rows(primary_retry, "transport", kind="primary")) == 2
                        and len(rows(primary_retry, "request-approved", kind="primary")) == 2
                        and len(rows(primary_retry, "resolve-input", kind="primary")) == 2,
                        "Primary retry did not repeat native resolution/preparation")
                generate_retry = s.create("native-generate-prepared-retry", retryKind="generate")
                retry_before = request(host, "GET", f"/api/session/{generate_retry}")
                generated = request(host, "POST", f"/api/session/{generate_retry}/generate", {"prompt": "Retry private local generation"})
                require(generated.get("text") == "REQUEST_LOCAL_GENERATE_OK", "Retried native generate failed")
                repeated = s.trace(generate_retry)
                selected(repeated, "fast", "medium", "generate")
                require(len(rows(repeated, "transport", kind="generate")) == 2
                        and len(rows(repeated, "request-approved", kind="generate")) == 1
                        and len(rows(repeated, "resolve-input", kind="generate")) == 1,
                        "Expected exact 2.3.0 prepared generate retry behavior changed")
                retry_after = request(host, "GET", f"/api/session/{generate_retry}")
                require(retry_after.get("model") == retry_before.get("model"), "Prepared retry changed Session model")
                report["cases"].append({**s.summary(generate_retry, repeated, retry_after, "fast", "medium"),
                                        "retry_reprepared": False, "per_transport_guard_proven": False})
                # Deliberately change fixture eligibility after a failed native
                # compaction transport. A reused Prepared request does not
                # re-enter the candidate's model.request validation. This is
                # not a real billing test, just an installed-host counterexample.
                comp_retry = s.create("native-compaction-prepared-retry",
                                      retryKind="compaction", exhaustAfterFirstTransport=True,
                                      tier="advanced")
                baseline = s.positive(comp_retry, "sol", "high")
                require(baseline["outcome"] == "succeeded", "Native compaction fixture setup failed")
                comp_start = len(events(root))
                comp_before = request(host, "GET", f"/api/session/{comp_retry}")
                request(host, "POST", f"/api/session/{comp_retry}/compact", {})
                idle(host, [comp_retry])
                comp_events = s.trace(comp_retry, comp_start)
                selected(comp_events, "sol", "high", "compaction")
                require(len(rows(comp_events, "request-approved", kind="compaction")) == 1
                        and len(rows(comp_events, "transport", kind="compaction")) == 2,
                        "Native prepared compaction retry did not expose the per-send guard gap")
                require(len(rows(comp_events, "eligibility-changed", kind="compaction")) == 1,
                        "Fixture eligibility did not change between compaction transport attempts")
                require(not rows(comp_events, "tool-before") and not rows(comp_events, "tool-after"),
                        "Compaction retry replayed a native tool")
                comp_after = request(host, "GET", f"/api/session/{comp_retry}")
                require(comp_after.get("model") == comp_before.get("model"),
                        "Prepared compaction retry mutated the persisted model")
                report["cases"].append({**s.summary(comp_retry, comp_events, comp_after, "sol", "high"),
                                         "name": "native-compaction-prepared-retry",
                                         "retry_reprepared": False, "per_transport_guard_proven": False,
                                         "fixture_eligibility_changed": True})

                # Native selectTitle resolves the primary and preferred refs.
                # A real provider error on the preferred request triggers the
                # host's fallback attempt; the fixture does not call a resolver.
                for mode in ("preferred", "fallback"):
                    sid = s.create("native-title-" + mode, native_title=True, titleSelection=mode)
                    start, before = s.prompt(sid)
                    result = s.terminal(sid, start, before)
                    require(result["outcome"] == "succeeded", "Title scenario primary request failed")
                    expected_attempts = 1 if mode == "preferred" else 2
                    deadline = time.monotonic() + 10
                    while time.monotonic() < deadline:
                        result = request(host, "GET", f"/api/session/{sid}")
                        if result.get("title") == "REQUEST_LOCAL_FIXTURE_OK" and len(rows(s.trace(sid), "transport", kind="title")) == expected_attempts:
                            break
                        time.sleep(.02)
                    require(result.get("title") == "REQUEST_LOCAL_FIXTURE_OK", "Native title did not publish the provider result")
                    require(result.get("model") == before.get("model"), "Title selection mutated stored Session model")
                    entry = s.summary(sid, s.trace(sid, start), result, "fast", "medium")
                    lifecycle_evidence(entry["name"], s.trace(sid, start))
                    report["cases"].append(entry)

                # The provider's first response reports pressure over the native
                # auto threshold. The second ordinary prompt must compact using
                # its primary context; no manual /compact endpoint is called.
                auto = s.create("native-automatic-compaction-reuse", automaticCompaction=True)
                first_start, first_before = s.prompt(auto)
                first = s.terminal(auto, first_start, first_before)
                require(first["outcome"] == "succeeded", "Auto-compaction primer failed")
                second_start, second_before = s.prompt(auto)
                result = s.terminal(auto, second_start, second_before)
                require(result["outcome"] == "succeeded", "Native auto-compaction continuation failed")
                s.wait_event(auto, "native-lifecycle", predicate=lambda r: r["eventType"] == "session.compaction.ended")
                require(result.get("model") == first_before.get("model"), "Auto compaction mutated stored Session model")
                entry = s.summary(auto, s.trace(auto, first_start), result, "fast", "medium")
                lifecycle_evidence(entry["name"], s.trace(auto, first_start))
                report["cases"].append(entry)

                # Revoke fixture eligibility in the native retry callback. The
                # prepared compaction is resent without a fresh guard. A new
                # native generate call then proves the same source denies fresh
                # selection. This is an enforcement-gap witness, not guard PASS.
                compact_retry = s.create("native-compaction-prepared-retry-revocation", retryKind="compaction", exhaustOnRetry=True)
                s.positive(compact_retry, "fast", "medium")
                compaction_start = len(events(root))
                compaction_before = request(host, "GET", f"/api/session/{compact_retry}")
                request(host, "POST", f"/api/session/{compact_retry}/compact", {})
                idle(host, [compact_retry])
                s.wait_event(compact_retry, "native-lifecycle", predicate=lambda r: r["eventType"] == "session.compaction.ended")
                probe_offset = Path(host.stderr.name).stat().st_size
                try:
                    request(host, "POST", f"/api/session/{compact_retry}/generate", {"prompt": "Fresh request after fixture revocation"})
                except HTTPError as error:
                    response = error.read().decode(errors="replace")
                    error.close()
                    deadline = time.monotonic() + 3
                    while time.monotonic() < deadline:
                        diagnostic = response + Path(host.stderr.name).read_bytes()[probe_offset:].decode(errors="replace")
                        if any("LOOM_REQUEST_LOCAL_UNAVAILABLE" in line and f"/api/session/{compact_retry}/generate" in line
                               for line in diagnostic.splitlines()):
                            break
                        time.sleep(.02)
                    else:
                        raise RuntimeError("Fresh revocation probe lacked the exact native denial and Session URL")
                else:
                    raise RuntimeError("Fresh native request accepted revoked fixture eligibility")
                compaction_after = request(host, "GET", f"/api/session/{compact_retry}")
                require(compaction_after.get("model") == compaction_before.get("model"), "Prepared compaction retry mutated stored selection")
                trace = s.trace(compact_retry, compaction_start)
                entry = s.summary(compact_retry, trace, compaction_after, "fast", "medium")
                entry["_kinds"] = ["compaction"]
                lifecycle_evidence(entry["name"], trace)
                report["cases"].append(entry)

                # Hold the candidate's awaited policy source at the same native
                # pre-dispatch point in a release control and a real interrupt.
                # Release both and inspect the complete trace after host shutdown.
                for cancelled in (False, True):
                    name = "native-cancellation-before-dispatch" if cancelled else "native-cancellation-release-control"
                    sid = s.create(name, sourceGate=True)
                    start, before = s.prompt(sid)
                    s.wait_event(sid, "source-paused")
                    if cancelled:
                        request(host, "POST", f"/api/session/{sid}/interrupt", {})
                        s.wait_event(sid, "native-lifecycle", predicate=lambda r: r["eventType"] == "session.execution.interrupted")
                    s.cases[sid]["gateOpen"] = True
                    s.save()
                    s.wait_event(sid, "source-released")
                    result = s.terminal(sid, start, before)
                    require(result["outcome"] == ("interrupted" if cancelled else "succeeded"), "Wrong native cancellation/control outcome")
                    require(result.get("model") == before.get("model"), "Cancellation/control mutated stored selection")
                    entry = s.summary(sid, s.trace(sid, start), result, "fast", "medium")
                    lifecycle_evidence(entry["name"], s.trace(sid, start))
                    report["cases"].append(entry)
                require(agent_model(host) == original_agent_model, "Request-local selection mutated native agent default")
                saved = ordinary
            finally:
                host.close()
            # Restart the unmodified native process with the same persisted
            # Session and fixture policy map; candidate memory cannot authorize it.
            host = start_host(cli, repo, plugin, root, env, output, "request-local-restart")
            try:
                s = Scenario(host, root)
                restarted = s.positive(saved, "fast", "medium")
                restarted["name"] = "native-restart-revalidation"
                report["cases"].append(restarted)
                require(agent_model(host) == original_agent_model, "Restart changed native agent model")
                report["native_agent_default_unchanged"] = True
                require(not (Path(env["XDG_STATE_HOME"]) / "loom/quota-v1/subscriptions.sqlite").exists(),
                        "Mechanics candidate unexpectedly opened quota state")
            finally:
                host.close()
            captured = events(root)
            report["lifecycle_oracle_mutations_rejected"] = finalize_cases(report["cases"], captured)
            require(len(report["cases"]) == len({case["name"] for case in report["cases"]}) == 27,
                    "Installed suite must retain all 19 original and eight lifecycle cases exactly once")
            require(len(rows(captured, "fixture-ready")) == 2, "Native fixture did not load across both process starts")
            labels = {sid: case["name"] for sid, case in s.cases.items()}
            safe_trace = [{"type": event["type"], "data": {key: labels.get(value, value) if key == "sessionID" else value
                         for key, value in event["data"].items()}} for event in captured]
            trace_path = output / "request-local-events.ndjson"
            trace_path.write_text("".join(json.dumps(event, sort_keys=True) + "\n" for event in safe_trace))
            report["trace"] = {"file": trace_path.name, "sha256": hashlib.sha256(trace_path.read_bytes()).hexdigest()}
            report["request_kinds_observed"] = sorted({r["kind"] for r in rows(captured, "transport")})
            require(report["request_kinds_observed"] == ["compaction", "generate", "primary", "title"],
                    "Not every native request kind was exercised")
        report["mechanics_status"] = "PASS"
    except Exception as error:
        report["mechanics_status"] = "FAIL"
        report["error"] = f"{type(error).__name__}: {error}"
        raise
    finally:
        (output / "request-local-report.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--opencode", type=Path, required=True)
    parser.add_argument("--repository", type=Path, required=True)
    parser.add_argument("--plugin", type=Path, required=True)
    parser.add_argument("--artifact", type=Path, required=True)
    parser.add_argument("--expect-plugin-version", required=True)
    parser.add_argument("--report-directory", type=Path, required=True)
    args = parser.parse_args()
    report = run(args.opencode.resolve(), args.repository.resolve(), args.plugin.resolve(),
                 args.artifact.resolve(), args.report_directory.resolve(), args.expect_plugin_version)
    print(json.dumps({key: report[key] for key in ("mechanics_status", "live_routing_status", "request_kinds_observed", "cases")}, indent=2))


if __name__ == "__main__":
    main()
