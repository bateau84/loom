"""Installed source-owner fixtures and oracles, never production source adapters.

The real registered Loom resolver invokes a disposable fixed-argv gh executable.
Its equivalent GitHub responses are controlled originals, not live account or
private #182/#187 evidence. Native originals come from actual fixture activity.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import sys
from urllib.parse import quote

from installed_host_smoke import require
from installed_retrospective_populations import encoded, read_population_pages


REPOSITORY = "loom-fixture/originals"
PREFIX = "/repos/" + REPOSITORY
HEAD = "a" * 40
CORRECTED = "b" * 40
TREE = "c" * 40
NATIVE_MARKER = "SYNTHETIC_NATIVE_ORIGINAL_227"
GH_ARGUMENTS = ["api", "--hostname", "github.com", "--method", "GET", "--allow-escape-sequences",
                "--header", "X-GitHub-Api-Version: 2022-11-28"]


def source_owner_fixture() -> dict:
    correction = b"// Controlled test correction, not private historical source.\nfunc TestRestoreFreshness() { /* both valid orderings */ }\n"
    blob = hashlib.sha1(b"blob " + str(len(correction)).encode() + b"\0" + correction).hexdigest()
    import base64
    responses = {
        PREFIX: {"id": 227, "full_name": REPOSITORY},
        PREFIX + "/git/commits/" + CORRECTED: {
            "sha": CORRECTED, "tree": {"sha": TREE}, "message": "Correct the two test orderings",
            "parents": [{"sha": HEAD}], "author": {"name": "Controlled author"}, "committer": {"name": "Controlled author"}},
        PREFIX + "/git/trees/" + TREE: {"sha": TREE, "truncated": False, "tree": [
            {"path": "restore_test.go", "type": "blob", "mode": "100644", "sha": blob, "size": len(correction)}]},
        PREFIX + "/git/blobs/" + blob: {"sha": blob, "encoding": "base64", "size": len(correction),
            "content": base64.b64encode(correction).decode()},
    }
    logs = {
        "failure": (710, 1, 711, HEAD, "failure", "--- FAIL: TestRestoreFreshness/coarse\nrefresh=false; expected true\n--- PASS: TestRestoreFreshness/windows\nHistorical scheduling order was not recorded.\n"),
        "rerun": (710, 2, 712, HEAD, "success", "--- PASS: TestRestoreFreshness/coarse\n--- PASS: TestRestoreFreshness/windows\nUnchanged-code rerun; no correction applied.\n"),
        "corrected": (720, 1, 721, CORRECTED, "success", "Checked out " + CORRECTED + "\n--- PASS: TestRestoreFreshness/coarse\n--- PASS: TestRestoreFreshness/windows\n"),
        "race": (720, 1, 722, CORRECTED, "success", "go test -race ./...\nok controlled-package\nSuite-level result; individual events are not retained here.\n"),
    }
    locators = {"correction": "https://github.com/" + REPOSITORY + "/blob/" + CORRECTED + "/restore_test.go"}
    for name, (run, attempt, job, head, conclusion, log) in logs.items():
        responses[PREFIX + f"/actions/runs/{run}/attempts/{attempt}"] = {
            "id": run, "run_attempt": attempt, "head_sha": head, "status": "completed",
            "conclusion": conclusion, "repository": {"full_name": REPOSITORY}}
        responses[PREFIX + f"/actions/jobs/{job}"] = {"id": job, "run_id": run, "run_attempt": attempt,
            "head_sha": head, "status": "completed", "conclusion": conclusion, "name": name, "steps": []}
        responses[PREFIX + f"/actions/jobs/{job}/logs"] = {"raw": log}
        locators[name] = "https://github.com/" + REPOSITORY + f"/actions/runs/{run}/job/{job}"
    return {"responses": responses, "locators": locators, "logs": logs,
            "correction": correction.decode(), "blob": blob}


def install_source_owner(root: Path, env: dict) -> dict:
    fixture = source_owner_fixture()
    owner = root / "original-source-owner"
    owner.mkdir(mode=0o700)
    state, audit = owner / "responses.json", owner / "calls.ndjson"
    state.write_text(encoded(fixture["responses"]))
    executable = owner / "gh"
    executable.write_text("#!" + sys.executable + "\n" +
        "import json, pathlib, sys\n" +
        "expected=" + repr(GH_ARGUMENTS) + "\n" +
        "if sys.argv[1:]==['api','--help']:\n"
        "    print('  --allow-escape-sequences');sys.exit(0)\n" +
        "if len(sys.argv)!=len(expected)+2 or sys.argv[1:-1]!=expected:\n"
        "    print('Fixture refuses non-GET or unexpected gh arguments',file=sys.stderr);sys.exit(2)\n" +
        "root=pathlib.Path(__file__).parent\n"
        "endpoint=sys.argv[-1]\n"
        "with (root/'calls.ndjson').open('a') as log: log.write(json.dumps({'argv':sys.argv[1:]})+'\\n')\n"
        "values=json.loads((root/'responses.json').read_text())\n"
        "if endpoint not in values:\n"
        "    print('gh: HTTP 404',file=sys.stderr);sys.exit(1)\n"
        "value=values[endpoint]\n"
        "sys.stdout.write(value['raw'] if isinstance(value,dict) and set(value)=={'raw'} else json.dumps(value))\n")
    executable.chmod(0o700)
    env["PATH"] = str(owner) + os.pathsep + env.get("PATH", "")
    fixture.update(state=state, audit=audit)
    return fixture


def original_request(fixture: dict, label: str, **paging) -> dict:
    return {"operation": "population-source", "population_id": fixture["frozen"]["population_id"],
            "manifest_sha256": fixture["frozen"]["manifest_sha256"], "member_key": fixture["members"][label]["key"], **paging}


def prepare_original_population(scenario, reader: str, read_native, owner: dict) -> dict:
    code = "return " + json.dumps(NATIVE_MARKER)
    job, start = scenario.begin(reader, code)
    scenario.finish(reader, job, start)
    original = read_native()
    users = [message for message in original["messages"] if message.get("type") == "user"
             and message.get("text") == "LOOM_HARNESS_JOB:" + job]
    calls = [(message["id"], part) for message in original["messages"] if message.get("type") == "assistant"
             for part in message.get("content", []) if part.get("type") == "tool" and part.get("name") == "execute"
             and part.get("state", {}).get("input", {}).get("code") == code]
    require(len(users) == len(calls) == 1 and calls[0][1]["state"]["status"] == "completed",
            "Original-source setup has no unique native user/tool originals")
    user, (message_id, part) = users[0], calls[0]
    objective = scenario.invoke(reader, "objective", {"operation": "create", "source_type": "native-message",
        "source_id": user["id"], "label": "Controlled original-source retrieval, with unproven historical diagnosis"})
    scenario.invoke(reader, "objective", {"operation": "link", "objective_id": objective["id"], "phase": "handback",
        "source_type": "native-call", "source_id": part["id"], "source_message_id": message_id,
        "assessment": "reported-done", "note": "Actual fixture tool return; no native review invocation is inferred."})
    for label, locator in owner["locators"].items():
        scenario.invoke(reader, "objective", {"operation": "link", "objective_id": objective["id"],
            "phase": "verification", "source_type": "external-ref", "source_id": locator, "assessment": "inconclusive",
            "note": "Controlled " + label + " source; original cause and full release acceptance remain unproven."})
    selection = {"objective_id": objective["id"], "question": "Inspect originals without inferring the historical cause or overall release acceptance."}
    preview = scenario.read(reader, "history", {"operation": "preview-population", "selection": selection, "limit": 50},
                            "original-source-preview")
    pages = read_population_pages(scenario, reader, preview, "original-source-preview")
    items = [item for page in pages for item in page["items"]]
    require(len(items) == preview["member_count"] and len({item["key"] for item in items}) == len(items),
            "Original-source preview returned incomplete or duplicate membership")
    expected = {"native_user": user["id"], "native_call": part["id"], **owner["locators"]}
    members = {}
    for label, identity in expected.items():
        selected = [item for item in items if item.get("source", {}).get("id") == identity]
        require(len(selected) == 1 and selected[0].get("availability") == "available"
                and selected[0].get("current", {}).get("status") == "available"
                and selected[0].get("source", {}).get("sha256") and selected[0]["source"].get("revision"),
                "Preview failed to pin an available native/external original: " + label)
        members[label] = selected[0]
    frozen = scenario.invoke(reader, "review", preview["freeze"])
    require(frozen.get("manifest_sha256") == preview["manifest_sha256"] and frozen.get("population_id"),
            "Original-source freeze changed the approved preview")
    return {"owner": owner, "reader": reader, "objective": objective, "frozen": frozen, "members": members,
            "user": user, "part": part, "message_id": message_id, "preview": preview}


def assert_original_value(result: dict, member: dict, frozen: dict) -> dict:
    require(result.get("status") == "available" and result.get("representation") == "original-owner-view"
            and result.get("population_id") == frozen["population_id"]
            and result.get("manifest_sha256") == frozen["manifest_sha256"] and result.get("member_key") == member["key"]
            and result.get("source") == member["source"] and result.get("source_store_id") == member["source_store_id"]
            and result.get("permitted_view") == member["permitted_view"]
            and result.get("coverage", {}).get("whole_original_returned") is True
            and result["coverage"].get("original_sha256") == member["source"]["sha256"],
            "Frozen original read changed identity, view, namespace or complete coverage")
    value = result.get("value")
    require(isinstance(value, dict) and hashlib.sha256(encoded(value).encode()).hexdigest() == member["source"]["sha256"],
            "Frozen original bytes do not match the pinned view digest")
    return value


def inspect_original_population(scenario, fixture: dict) -> dict:
    values = {}
    for label, member in fixture["members"].items():
        result = scenario.read(fixture["reader"], "history", original_request(fixture, label), "original-source-" + label)
        require(result.get("receiving_session") == fixture["reader"], "Original source returned to an unexpected recipient")
        values[label] = assert_original_value(result, member, fixture["frozen"])
    user, call = values["native_user"], values["native_call"]
    require(user.get("fields") == {"text": fixture["user"]["text"]}
            and user.get("identity") == {"session_id": fixture["reader"], "message_id": fixture["user"]["id"]},
            "Native user original changed its actual source identity or text")
    require(call.get("identity") == {"session_id": fixture["reader"], "message_id": fixture["message_id"], "part_id": fixture["part"]["id"]}
            and all(call.get("fields", {}).get(field) == fixture["part"]["state"].get(native)
                    for field, native in (("input", "input"), ("output", "content"), ("status", "status"))),
            "Native tool original changed its actual source tuple, input, output or status")
    require(all(value["namespace"].get("native_store_identity") == "unavailable"
                and value["coverage"].get("full_history") is False for value in (user, call)),
            "Current native originals invented full history or native store identity")
    for label, (run, attempt, job, head, conclusion, log) in fixture["owner"]["logs"].items():
        value = values[label]["original"]
        require(value["run"]["run_id"] == run and value["run"]["run_attempt"] == attempt
                and value["job"]["job_id"] == job and value["job"]["run_attempt"] == attempt
                and value["job"]["workflow_head_sha"] == head and value["job"]["conclusion"] == conclusion
                and value["log"]["content"] == log and value["job"]["tested_revision"].startswith("unknown"),
                "CI source substituted another attempt, log or inferred actual checkout")
    require(values["correction"]["original"].get("content") == fixture["owner"]["correction"]
            and values["correction"]["original"].get("blob_sha") == fixture["owner"]["blob"]
            and values["correction"]["original"].get("commit_sha") == CORRECTED
            and values["correction"]["original"].get("tree_sha") == TREE,
            "Git original failed exact commit/tree/blob/content verification")
    fixture["values"] = values
    return {"originals": len(values), "population_id": fixture["frozen"]["population_id"],
            "manifest_sha256": fixture["frozen"]["manifest_sha256"], "native_sources": 2, "external_sources": len(values) - 2,
            "source_owner": "controlled gh executable; real native plugin/subprocess route; no live account authorization claim",
            "historical_diagnosis": "unproven", "release_acceptance": "separate and unproven"}


def assert_original_fragments(pages: list[dict], member: dict, expected: dict) -> dict:
    require(bool(pages), "Original-source readback omitted all pages")
    parts, offset = [], 0
    for page in pages:
        coverage = page.get("coverage", {})
        require(page.get("status") == "available" and page.get("representation") == "original-owner-view-fragment"
                and page.get("member_key") == member["key"] and page.get("source") == member["source"]
                and page.get("source_store_id") == member["source_store_id"]
                and page.get("permitted_view") == member["permitted_view"]
                and page.get("population_id") == pages[0].get("population_id")
                and page.get("manifest_sha256") == pages[0].get("manifest_sha256")
                and isinstance(page.get("content_json"), str) and coverage.get("from") == offset
                and coverage.get("total_characters") == pages[0].get("coverage", {}).get("total_characters")
                and coverage.get("total_utf8_bytes") == pages[0].get("coverage", {}).get("total_utf8_bytes")
                and coverage.get("original_sha256") == member["source"]["sha256"],
                "Original-source fragments changed identity, digest or contiguous coverage")
        parts.append(page["content_json"])
        offset += len(page["content_json"].encode("utf-16-le")) // 2
        require(coverage.get("to") == offset, "Original-source fragment coverage disagrees with returned bytes")
    text = "".join(parts)
    require(pages[-1].get("navigation", {}).get("next") is None
            and offset == pages[-1]["coverage"].get("total_characters")
            and len(text.encode()) == pages[-1]["coverage"].get("total_utf8_bytes")
            and hashlib.sha256(text.encode()).hexdigest() == member["source"]["sha256"]
            and json.loads(text) == expected, "Original-source readback omitted or substituted original content")
    return {"pages": len(pages), "reconstructed_utf8_bytes": len(text.encode()), "frozen_digest_verified": True}


def inspect_original_fragments(scenario, fixture: dict) -> dict:
    query = original_request(fixture, "failure", source_limit=401)
    pages = []
    while query is not None:
        require(len(pages) < 20, "Original-source fragments did not terminate")
        pages.append(scenario.read(fixture["reader"], "history", query, "original-source-fragment"))
        query = pages[-1].get("navigation", {}).get("next")
    require(len(pages) > 1, "Installed source read did not exercise bounded content continuation")
    return assert_original_fragments(pages, fixture["members"]["failure"], fixture["values"]["failure"])


def exercise_original_negatives(scenario, fixture: dict, other_reader: str, set_policy, allow: list) -> dict:
    reader = fixture["reader"]
    cross = scenario.read(other_reader, "history", original_request(fixture, "native_call"), "original-source-cross-session")
    require(cross.get("status") == "unsupported" and cross.get("gap", {}).get("code") == "unsupported-source-release"
            and "value" not in cross and "content_json" not in cross and NATIVE_MARKER not in encoded(cross),
            "Frozen membership bypassed the cross-Session native release boundary")
    scope = "session:" + quote(reader, safe="") + ":message:" + quote(fixture["user"]["id"], safe="")
    resource = "loom:evidence:disclose:" + scope + ":view:native-user-text:recipient:" + quote(reader, safe="")
    set_policy([*allow, {"action": "read", "resource": resource, "effect": "deny"}])
    try:
        denied = scenario.denied(reader, "history", original_request(fixture, "native_user"))
        blocked = denied.get("error", {}).get("error", {})
        require(blocked.get("_tag") == "Permission.BlockedError" and resource in blocked.get("resources", [])
                and fixture["user"]["text"] not in encoded(denied.get("error", {})),
                "Native original disclosure denial was not enforced at its exact resource")
    finally:
        set_policy(allow)
    scenario.denied(reader, "history", {**original_request(fixture, "failure"), "member_key": "source-wrong-identity"})
    state = fixture["owner"]["state"]
    saved = state.read_text()
    cases = [("attempt-substitution", PREFIX + "/actions/jobs/711", {"run_attempt": 2}, "changed"),
             ("changed-log", PREFIX + "/actions/jobs/711/logs", {"raw": "Replacement is not the original failure.\n"}, "changed"),
             ("missing-log", PREFIX + "/actions/jobs/711/logs", None, "missing")]
    for label, endpoint, update, status in cases:
        changed = json.loads(saved)
        if update is None:
            changed.pop(endpoint)
        else:
            changed[endpoint].update(update)
        state.write_text(encoded(changed))
        try:
            result = scenario.read(reader, "history", original_request(fixture, "failure"), "original-source-" + label)
            require(result.get("status") == status and "value" not in result and "content_json" not in result
                    and result.get("manifest_sha256") == fixture["frozen"]["manifest_sha256"],
                    "Changed or missing CI original was substituted or changed frozen identity")
        finally:
            state.write_text(saved)
    return {"cross_session_raw_release": "withheld", "actual_native_disclosure_denial": True,
            "wrong_member_identity": "rejected", "later_attempt": "not substituted", "changed_original": "gap",
            "missing_original": "gap", "atomic_revocation_fence": "not claimed"}


def inspect_original_restart(scenario, fixture: dict) -> dict:
    for label in ("native_user", "native_call", "failure", "correction"):
        result = scenario.read(fixture["reader"], "history", original_request(fixture, label), "original-source-restart-" + label)
        value = assert_original_value(result, fixture["members"][label], fixture["frozen"])
        require(value == fixture["values"][label], "Restart changed an exact permitted original")
    calls = [json.loads(line)["argv"] for line in fixture["owner"]["audit"].read_text().splitlines()]
    require(calls and all(args[:-1] == GH_ARGUMENTS and args[-1] in fixture["owner"]["responses"] for args in calls),
            "Source resolver escaped its fixed authorized fixture endpoints")
    return {"population_id": fixture["frozen"]["population_id"], "exact_sources_after_restart": 4,
            "owner_reads": len(calls), "fixed_read_only_arguments": True,
            "retention_qualification": "No source retention claim; every read invokes the original owner again."}
