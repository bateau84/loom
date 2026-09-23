#!/usr/bin/env python3
"""Zero-inference probe: real eval wrapper -> standalone CLI -> provider capture.

This checks delivery, not model behavior, and never loads provider credentials.
Run separately from unit tests, after installing the supported OpenCode CLI.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import queue
import shutil
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
MODEL = "mock"


def message_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(
            part if isinstance(part, str) else str(part.get("text", ""))
            for part in content if isinstance(part, (str, dict))
        )
    return ""


def verify_capture(requests: list[dict[str, Any]], source: str,
                   prompt: str, grading: list[str]) -> None:
    """Require policy in instruction roles, not merely echoed in user content."""
    if not source.strip() or not requests:
        raise RuntimeError("No non-empty General body/provider request to verify")
    # The host trims the Markdown body's outer whitespace during agent loading.
    # Preserve exact matching inside the body; no words/lines may disappear.
    source = source.strip()
    for body in requests:
        if body.get("model") != MODEL:
            raise RuntimeError("Unexpected provider model")
        messages = body.get("messages", [])
        policy = "\n".join(message_text(m.get("content")) for m in messages
                           if m.get("role") in ("system", "developer"))
        user = "\n".join(message_text(m.get("content")) for m in messages
                         if m.get("role") == "user")
        if source not in policy:
            summaries = [{
                "role": m.get("role"),
                "characters": len(message_text(m.get("content"))),
                "full_source": source in message_text(m.get("content")),
                "human_contract": "## Human-facing communication" in message_text(m.get("content")),
                "scenario": prompt in message_text(m.get("content")),
                "prefix": message_text(m.get("content"))[:160],
            } for m in messages]
            start = policy.find(source[:160])
            candidate = policy[start:] if start >= 0 else policy
            common = len(os.path.commonprefix([source, candidate]))
            raise RuntimeError("Complete General body missing from provider instruction roles; "
                               + json.dumps({"source_characters": len(source), "messages": summaries,
                                             "common_prefix": common,
                                             "expected_at_difference": source[max(0, common-60):common+180],
                                             "observed_at_difference": candidate[max(0, common-60):common+180]}))
        if prompt not in user:
            raise RuntimeError("Scenario missing from provider user input")
        all_text = "\n".join(message_text(m.get("content")) for m in messages)
        if any(item and item in all_text for item in grading):
            raise RuntimeError("Judge-only grading leaked into provider context")


def verify_cli_output(stdout: str) -> None:
    texts = []
    for line in stdout.splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(event, dict) and event.get("type") == "text":
            part = event.get("part")
            if isinstance(part, dict) and isinstance(part.get("text"), str):
                texts.append(part["text"])
    if "".join(texts).strip() != "delivery-probe-complete":
        raise RuntimeError("OpenCode did not return the local provider's text event")


def run() -> None:
    executable = shutil.which("opencode")
    if not executable:
        raise RuntimeError("OpenCode CLI is required for the conversation delivery probe")
    spec = importlib.util.spec_from_file_location("conversation_runner", ROOT / "scripts/run-evals.py")
    if not spec or not spec.loader:
        raise RuntimeError("Cannot load the production eval runner")
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    case = next(c for c in runner.load_cases([ROOT / "evals/human-interaction.json"])
                if c["id"] == "HUMAN-06")
    source = runner.strip_frontmatter((ROOT / "agents/general.md").read_text(encoding="utf-8"))
    grading = [case["trap"], *case["expectations"], *case["must_not"]]
    captured: queue.Queue[dict[str, Any]] = queue.Queue(maxsize=8)
    failures: queue.Queue[str] = queue.Queue()

    class Provider(BaseHTTPRequestHandler):
        def log_message(self, *_args: Any) -> None:
            pass

        def do_POST(self) -> None:
            try:
                self.connection.settimeout(5)
                size = int(self.headers.get("content-length", "0"))
                if self.path != "/v1/chat/completions" or not 0 < size <= 2_000_000:
                    raise ValueError("Unexpected local provider request")
                body = json.loads(self.rfile.read(size))
                captured.put_nowait(body)
                common = {"id": "chatcmpl-delivery-probe", "created": int(time.time()), "model": MODEL}
                if body.get("stream"):
                    chunks = [
                        {**common, "object": "chat.completion.chunk", "choices": [
                            {"index": 0, "delta": {"role": "assistant", "content": "delivery-probe-complete"}, "finish_reason": None}]},
                        {**common, "object": "chat.completion.chunk", "choices": [
                            {"index": 0, "delta": {}, "finish_reason": "stop"}]},
                    ]
                    payload = ("".join("data: " + json.dumps(c) + "\n\n" for c in chunks)
                               + "data: [DONE]\n\n").encode()
                    content_type = "text/event-stream"
                else:
                    payload = json.dumps({**common, "object": "chat.completion", "choices": [
                        {"index": 0, "message": {"role": "assistant", "content": "delivery-probe-complete"},
                         "finish_reason": "stop"}]}).encode()
                    content_type = "application/json"
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
            except Exception as exc:
                failures.put(type(exc).__name__ + ": " + str(exc))
                self.send_error(400, "Local delivery probe rejected request")

    provider = ThreadingHTTPServer(("127.0.0.1", 0), Provider)
    thread = threading.Thread(target=provider.serve_forever, daemon=True)
    thread.start()
    temporary: Path | None = None
    proc: subprocess.Popen[bytes] | None = None
    try:
        temporary, project, _ = runner.setup_projects(case)
        with tempfile.TemporaryDirectory(prefix="loom-profile-host-") as isolated:
            home = Path(isolated)
            config = {
                "$schema": "https://opencode.ai/config.json", "default_agent": "general",
                "model": "loommock/mock", "enabled_providers": ["loommock"],
                "provider": {"loommock": {
                    "npm": "@ai-sdk/openai-compatible", "name": "Local delivery probe",
                    "options": {"baseURL": f"http://127.0.0.1:{provider.server_port}/v1", "apiKey": "local-dummy"},
                    "models": {MODEL: {"name": "Local delivery probe", "limit": {"context": 1_000_000, "output": 1024}}},
                }},
            }
            (project / "opencode.json").write_text(json.dumps(config) + "\n", encoding="utf-8")
            # Deliberate allowlist: no inherited credentials, proxy or user config.
            env = {"PATH": os.environ.get("PATH", os.defpath), "HOME": str(home),
                   "XDG_CONFIG_HOME": str(home / "config"), "XDG_DATA_HOME": str(home / "data"),
                   "XDG_CACHE_HOME": str(home / "cache"), "XDG_STATE_HOME": str(home / "state"),
                   "XDG_RUNTIME_DIR": str(home / "runtime"), "OPENCODE_DB": str(home / "opencode.db"),
                   "OPENCODE_DISABLE_AUTOUPDATE": "1"}
            (home / "runtime").mkdir(mode=0o700)
            # Match the eval transport's real invocation, including fixed title
            # and standalone mode; a separate HTTP session path is not equivalent.
            command = [executable, "run", "--standalone", "--format", "json", "--auto",
                       "--title", "Loom conversation profile delivery", "--agent", "general",
                       "--model", "loommock/mock", case["prompt"]]
            with (home / "stdout.log").open("w+b") as out, (home / "stderr.log").open("w+b") as err:
                proc = subprocess.Popen(command, cwd=project, env=env,
                                        stdin=subprocess.DEVNULL, stdout=out, stderr=err)
                try:
                    code = proc.wait(timeout=45)
                    out.seek(0)
                    err.seek(0)
                    stdout = out.read(200_001)
                    stderr = err.read(20_001)
                    if code != 0:
                        raise RuntimeError(f"OpenCode delivery invocation failed ({code}): "
                                           + stderr.decode("utf-8", errors="replace")[:2000])
                    if len(stdout) > 200_000:
                        raise RuntimeError("Oversized delivery-probe output")
                    verify_cli_output(stdout.decode("utf-8"))
                    bodies = []
                    while not captured.empty():
                        bodies.append(captured.get_nowait())
                    if not failures.empty():
                        raise RuntimeError(failures.get_nowait())
                    verify_capture(bodies, source, case["prompt"], grading)
                    print("PASS complete General body reached provider instruction context")
                    print("PASS scenario present and judge-only grading absent")
                    print("PASS standalone CLI returned the local provider response")
                    print("General body sha256=" + hashlib.sha256(source.encode()).hexdigest())
                finally:
                    if proc.poll() is None:
                        proc.terminate()
                        try:
                            proc.wait(timeout=5)
                        except subprocess.TimeoutExpired:
                            proc.kill()
                            proc.wait(timeout=5)
                    proc = None

    finally:
        if proc and proc.poll() is None:
            proc.kill()
            proc.wait(timeout=5)
        provider.shutdown()
        provider.server_close()
        thread.join(timeout=5)
        if temporary:
            shutil.rmtree(temporary)


if __name__ == "__main__":
    run()
