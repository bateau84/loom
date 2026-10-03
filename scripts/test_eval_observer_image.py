#!/usr/bin/env python3
"""Provider-free real-image integration smoke for the eval hook observer."""
from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
import os
from pathlib import Path
import shutil
import tempfile
import threading
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("loom_run_evals", Path(__file__).with_name("run-evals.py"))
assert SPEC and SPEC.loader
RUN = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUN)

IMAGE = "ghcr.io/bateau84/opencode-eval-runner@sha256:68ef7322c75aede0e8cc76d0e3531e8b82dd417bbb5e5100264a89eab7fe8627"
EXPERIMENTAL_IMAGE = "ghcr.io/bateau84/opencode-eval-runner@sha256:6daa5372db601ee6fdcc75e8fafd7c4cc626122610eaff5b56ebb6912156dccb"
FAKE_KEY = "local-fixture-key-not-a-provider-credential"


class ProviderFixture(BaseHTTPRequestHandler):
    requests = 0
    errors: list[str] = []

    def log_message(self, *_args):
        return

    def do_POST(self):
        try:
            request = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))))
            tool_names = [tool["function"]["name"] for tool in request.get("tools", [])]
            if ProviderFixture.requests == 0:
                name = next((name for name in tool_names if name == "evalFixture_native_sentinel"), None)
                if not name:
                    raise AssertionError(f"native fixture tool not exposed: {tool_names!r}")
                response = tool_response("native-call", name, {"marker": "native-sentinel"})
            elif ProviderFixture.requests == 1:
                name = next((name for name in tool_names if name == "execute"), None)
                if not name:
                    raise AssertionError(f"Code Mode execute tool not exposed: {tool_names!r}")
                code = (
                    'const discarded = await tools.evalFixture.inner_sentinel({marker:"discarded-sentinel"});\n'
                    'const transformed = await tools.evalFixture.inner_sentinel({marker:"transformed-sentinel"});\n'
                    'let caught = false;\n'
                    'try { await tools.evalFixture.thrower({marker:"caught-sentinel"}); } '
                    'catch (_error) { caught = true; }\n'
                    'return {discarded: Boolean(discarded), transformed: "script-transformed", caught};'
                )
                response = tool_response("codemode-call", name, {"code": code})
            else:
                response = {
                    "id": f"fixture-{ProviderFixture.requests}",
                    "object": "chat.completion",
                    "created": 0,
                    "model": "deterministic",
                    "choices": [{"index": 0, "message": {"role": "assistant", "content": "fixture complete"},
                                 "finish_reason": "stop"}],
                }
            ProviderFixture.requests += 1
            body = stream_response(response) if request.get("stream") else json.dumps(response).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream" if request.get("stream") else "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception as exc:  # the test asserts and reports provider fixture failures
            ProviderFixture.errors.append(repr(exc))
            body = json.dumps({"error": {"message": str(exc)}}).encode("utf-8")
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)


def tool_response(call_id: str, name: str, arguments: dict[str, str]) -> dict:
    return {
        "id": f"fixture-{call_id}",
        "object": "chat.completion",
        "created": 0,
        "model": "deterministic",
        "choices": [{
            "index": 0,
            "message": {
                "role": "assistant",
                "tool_calls": [{
                    "id": call_id,
                    "type": "function",
                    "function": {"name": name, "arguments": json.dumps(arguments)},
                }],
            },
            "finish_reason": "tool_calls",
        }],
    }


def stream_response(response: dict) -> bytes:
    choice = response["choices"][0]
    message = choice["message"]
    if message.get("tool_calls"):
        delta = {"tool_calls": [
            {"index": index, "id": call["id"], "type": "function", "function": call["function"]}
            for index, call in enumerate(message["tool_calls"])
        ]}
        finish = "tool_calls"
    else:
        delta = {"content": message.get("content", "")}
        finish = "stop"
    chunks = [
        {"id": response["id"], "object": "chat.completion.chunk", "created": 0,
         "model": response["model"], "choices": [{"index": 0, "delta": delta, "finish_reason": None}]},
        {"id": response["id"], "object": "chat.completion.chunk", "created": 0,
         "model": response["model"], "choices": [{"index": 0, "delta": {}, "finish_reason": finish}]},
    ]
    return ("".join("data: " + json.dumps(chunk) + "\n\n" for chunk in chunks) + "data: [DONE]\n\n").encode()


class ObserverPinnedImageSmoke(unittest.TestCase):
    def invoke_fixture(
        self, image: str, *, observe_inner: bool = False, fail_observer: bool = False
    ):
        ProviderFixture.requests = 0
        ProviderFixture.errors = []
        server = ThreadingHTTPServer(("127.0.0.1", 0), ProviderFixture)
        server_thread = threading.Thread(target=server.serve_forever, daemon=True)
        server_thread.start()
        old_tempdir = tempfile.tempdir
        temp_root = Path("/tmp/opencode")
        temp_root.mkdir(parents=True, exist_ok=True)
        tempfile.tempdir = str(temp_root)
        temp, target, _judge = RUN.setup_projects({"id": "OBSERVER-IMAGE-SMOKE", "agent": "general", "execution": "runtime"})
        try:
            smoke_plugin = target / ".opencode" / "plugins" / "eval-observer-smoke-tools.ts"
            shutil.copyfile(Path(__file__).parent / "fixtures" / "eval-observer-smoke-tools.ts", smoke_plugin)
            is_experimental = image == EXPERIMENTAL_IMAGE
            if is_experimental:
                probe_plugin = target / ".opencode" / "plugins" / "eval-observed-hook-probe.ts"
                shutil.copyfile(Path(__file__).parent / "fixtures" / "eval-observed-hook-probe.ts", probe_plugin)
            endpoint = f"http://127.0.0.1:{server.server_port}/v1"
            config_file = temp / "provider.json"
            config_file.write_text(json.dumps({
                "$schema": "https://opencode.ai/config.json",
                "providers": {
                    "fixture": {
                        "name": "Deterministic Test Fixture",
                        "env": ["EVAL_FIXTURE_KEY"],
                        "package": "@opencode/ai/providers/openai-compatible",
                        "settings": {"baseURL": endpoint},
                        "models": {"deterministic": {"name": "Deterministic Fixture"}},
                    },
                },
            }), encoding="utf-8")
            environment = {"EVAL_FIXTURE_KEY": FAKE_KEY}
            extra_envs = ["EVAL_FIXTURE_KEY"]
            if is_experimental:
                environment["OPENCODE_EVAL_OBSERVATIONS"] = "1" if observe_inner else "0"
                environment["EVAL_OBSERVER_FIXTURE_THROW"] = "1" if fail_observer else "0"
                extra_envs.append("OPENCODE_EVAL_OBSERVATIONS")
                extra_envs.append("EVAL_OBSERVER_FIXTURE_THROW")
            with patch.dict(os.environ, environment):
                result = RUN.invoke_container(
                    engine="podman",
                    image=image,
                    transport="opencode",
                    model="fixture/deterministic",
                    agent="general",
                    prompt="Run the configured fixture tools.",
                    system="Deterministic provider fixture; no live provider or model is involved.",
                    project=target,
                    auth=None,
                    config=config_file,
                    models_catalog=None,
                    database_seed=None,
                    config_root=None,
                    expected_plugin=None,
                    timeout=45,
                    container_timeout=120,
                    mount_node_modules=True,
                    workspace_mode="rw",
                    extra_envs=extra_envs,
                    network="host",
                )
            probe_path = target / ".loom-eval-local-observed.jsonl"
            probe_records = [json.loads(line) for line in probe_path.read_text(encoding="utf-8").splitlines()] if probe_path.is_file() else []
            observer_text = (target / RUN.OBSERVER_FILENAME).read_text(encoding="utf-8") if (target / RUN.OBSERVER_FILENAME).is_file() else ""
            return result, probe_records, ProviderFixture.requests, list(ProviderFixture.errors), observer_text
        finally:
            server.shutdown()
            server.server_close()
            server_thread.join(timeout=2)
            tempfile.tempdir = old_tempdir
            shutil.rmtree(temp, ignore_errors=True)

    def test_old_pinned_image_remains_fail_closed_for_inner_results(self):
        self.assertEqual(RUN.DEFAULT_IMAGES["opencode"], IMAGE)
        result, _probe, requests, errors, observer = self.invoke_fixture(IMAGE)

        self.assertFalse(result.get("infrastructure_error"), result.get("stderr"))
        self.assertEqual(errors, [])
        self.assertEqual(requests, 3)
        evidence = result["observed_tool_results"]
        self.assertFalse(RUN.nested_tool_capture_complete(evidence))
        records = [json.loads(line) for line in observer.splitlines()]
        self.assertEqual(records[-1]["kind"], "footer")
        self.assertIs(records[-1]["complete"], False)

    def test_experimental_runtime_hook_observes_inner_execution_but_is_not_eligible(self):
        result, records, requests, errors, observer = self.invoke_fixture(EXPERIMENTAL_IMAGE, observe_inner=True)

        self.assertFalse(result.get("infrastructure_error"), result.get("stderr"))
        self.assertEqual(errors, [])
        self.assertEqual(requests, 3)
        events = [record for record in records if record.get("schema") == "opencode-local-observation/v1"]
        starts = [event for event in events if event.get("kind") == "call_start"]
        terminals = [event for event in events if event.get("kind") == "call_end"]
        self.assertEqual(len(starts), 3, repr(records))
        self.assertEqual(len(terminals), 3, repr(records))
        self.assertEqual(len({event["invocation_id"] for event in starts}), 3)
        self.assertEqual(len({event["invocation_id"] for event in terminals}), 3)
        parent_starts = [event for event in events if event.get("kind") == "parent_start"]
        self.assertEqual(len(parent_starts), 1, repr(events))
        parent_id = parent_starts[0]["parent"]["invocation_id"]
        self.assertTrue(all(event["invocation_id"] != event["parent"]["call_id"] for event in starts))
        self.assertTrue(all(event["parent"]["invocation_id"] == parent_id for event in starts))
        self.assertEqual(
            [event["tool"] for event in starts],
            ["evalFixture_inner_sentinel", "evalFixture_inner_sentinel", "evalFixture_thrower"],
        )
        self.assertEqual(
            [event["input"]["value"]["marker"] for event in starts],
            ["discarded-sentinel", "transformed-sentinel", "caught-sentinel"],
        )
        terminal_by_id = {event["invocation_id"]: event for event in terminals}
        self.assertEqual(
            [terminal_by_id[event["invocation_id"]]["outcome"] for event in starts],
            ["returned", "returned", "threw"],
        )
        self.assertIn("FINAL-discarded-sentinel", json.dumps(terminal_by_id[starts[0]["invocation_id"]]["result"]))
        self.assertIn("FINAL-transformed-sentinel", json.dumps(terminal_by_id[starts[1]["invocation_id"]]["result"]))
        self.assertIn(
            "caught-sentinel",
            terminal_by_id[starts[2]["invocation_id"]]["error"]["value"]["message"],
        )
        self.assertTrue(all(event["parent"]["call_id"] for event in starts))
        self.assertTrue(all(
            event["actor"]["agent"] == "general" and
            event["actor"]["session_id"] == event["parent"]["session_id"] and
            event["actor"]["message_id"] == event["parent"]["message_id"]
            for event in starts
        ))
        self.assertTrue(all(
            start["sequence"] < terminal_by_id[start["invocation_id"]]["sequence"]
            for start in starts
        ))
        parent_ends = [event for event in events if event.get("kind") == "parent_end"]
        self.assertEqual(len(parent_ends), 1, repr(records))
        self.assertEqual(parent_ends[0]["parent"]["invocation_id"], parent_id)
        self.assertFalse(parent_ends[0]["evidence_eligible"])

        # The diagnostic hook uses a workspace file only to reveal the API shape;
        # it is not the authenticated runner transport and cannot be scored.
        consumer = result["observed_tool_results"]
        self.assertFalse(RUN.nested_tool_capture_complete(consumer))
        self.assertNotEqual(consumer.get("schema"), "opencode-local-observation/v1")
        self.assertTrue(observer)
        outer = RUN.extract_tool_result_evidence(str(result.get("stdout") or ""), [])
        native = next(event for event in outer["events"] if event["tool"] == "evalFixture_native_sentinel")
        self.assertIn("native-sentinel", native["output"])

        off, off_records, off_requests, off_errors, _ = self.invoke_fixture(EXPERIMENTAL_IMAGE, observe_inner=False)
        failed_observer, _failed_records, failed_requests, failed_errors, _ = self.invoke_fixture(
            EXPERIMENTAL_IMAGE, observe_inner=True, fail_observer=True
        )
        for execution, count, failures in (
            (off, off_requests, off_errors), (failed_observer, failed_requests, failed_errors),
        ):
            self.assertFalse(execution.get("infrastructure_error"), execution.get("stderr"))
            self.assertEqual(count, 3)
            self.assertEqual(failures, [])
        signature = lambda execution: (
            execution.get("exit_code"), execution.get("text"),
            [
                {key: event.get(key) for key in ("tool", "status", "input", "output", "error")}
                for event in RUN.extract_tool_result_evidence(str(execution.get("stdout") or ""), [])["events"]
            ],
        )
        self.assertEqual(signature(off), signature(result))
        self.assertEqual(signature(failed_observer), signature(result))
        self.assertEqual(off_records, [])


if __name__ == "__main__":
    unittest.main()
