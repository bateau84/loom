"""Shared oracles for the installed frozen-population qualification.

These helpers consume registered-tool receipts from the existing isolated host.
They do not implement selection, access source databases, or dispatch Evaluators.
"""
from __future__ import annotations

import hashlib
from html import unescape
import json

from installed_host_smoke import require
from installed_learning_stage4 import assert_driver_invocations, synthetic_method


def encoded(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def read_population_pages(scenario, reader: str, first: dict, label: str) -> list[dict]:
    pages = [first]
    while pages[-1].get("navigation", {}).get("next") is not None:
        require(len(pages) < 40, "Retrospective population continuation did not terminate")
        query = pages[-1]["navigation"]["next"]
        require(query.get("operation") in ("preview-population", "population"),
                "Population continuation changed the read operation")
        pages.append(scenario.read(reader, "history", query, label + "-" + str(len(pages) + 1)))
    return pages


def assert_population_pages(pages: list[dict], fixture: dict, *, state: str, population_id=None) -> dict:
    require(bool(pages), "Retrospective population has no read receipts")
    first, items, keys = pages[0], [], set()
    digest = first.get("manifest_sha256")
    require(isinstance(digest, str) and len(digest) == 64, "Population omitted its manifest identity")
    manifest = first.get("manifest", {})
    require(manifest.get("selection", {}).get("objective_id") == fixture["objective"]["id"],
            "Population changed the selected engineering objective")
    require(isinstance(manifest["selection"].get("question"), str) and manifest["selection"]["question"],
            "Population omitted its bounded evaluation question")
    for page in pages:
        require(page.get("format") == "loom-retrospective-population-view/v1" and page.get("state") == state
                and page.get("manifest_sha256") == digest and page.get("manifest") == manifest
                and page.get("member_count") == first.get("member_count"),
                "Population page changed its frozen identity, scope or qualifications")
        if population_id is not None:
            require(page.get("population_id") == population_id, "Population page changed its durable identity")
        require(isinstance(page.get("items"), list) and page["items"], "Population page silently omitted its membership")
        for item in page["items"]:
            require(item.get("ordinal") == len(items) + 1 and isinstance(item.get("key"), str)
                    and item["key"] not in keys, "Population continuation omitted or duplicated an evidence member")
            require(isinstance(item.get("basis"), list) and item["basis"],
                    "Population member omitted its inclusion basis")
            keys.add(item["key"])
            items.append(item)
    expected = {record["id"]: record for record in fixture["records"].values()}
    selected = [item for item in items if item.get("source", {}).get("kind") == "ledger-record"]
    require(len(selected) == len(expected) and {item["source"]["id"] for item in selected} == set(expected),
            "Population omitted a selected original, duplicated it or admitted unrelated work")
    for item in selected:
        original = expected[item["source"]["id"]]
        require(item["source"].get("session_id") == original["session_id"]
                and item["source"].get("sha256") == hashlib.sha256(encoded(original).encode()).hexdigest()
                and isinstance(item["source"].get("revision"), str)
                and item.get("permitted_view") == "record-full"
                and isinstance(item.get("historical_scope"), dict) and item["historical_scope"].get("work_ref") is None,
                "Population changed an exact source/version/permitted view or invented historical Plan scope")
        require(item.get("availability") == "available" and item.get("current", {}).get("status") == "available",
                "Available fixture original became an unexplained population gap")
    require([item["source"]["id"] for item in items if item.get("source", {}).get("kind") == "objective"]
            == [fixture["objective"]["id"]], "Shared evidence broadened the selected objective population")
    require(fixture["unrelated"]["id"] not in {item["source"]["id"] for item in selected},
            "Unrelated same-Session work entered the population")
    require(pages[-1].get("navigation", {}).get("next") is None, "Population membership is incomplete")
    require(first.get("member_count") == len(items), "Population declared count does not equal its complete membership")
    return {"manifest_sha256": digest, "member_count": len(items), "original_count": len(selected),
            "pages": len(pages), "items": items, "manifest": manifest}


def assert_population_stable(before: dict, after: dict, population_id: str) -> None:
    # Preview has no durable inspection locator yet. Later reads also attach
    # current availability separately from the immutable membership declaration.
    def retained(items):
        return [{key: value for key, value in item.items() if key not in ("inspect", "current")} for item in items]

    require(before["manifest_sha256"] == after["manifest_sha256"] and before["manifest"] == after["manifest"]
            and retained(before["items"]) == retained(after["items"]),
            "Later evidence, relationship or restart changed the frozen population")
    require(isinstance(population_id, str) and population_id, "Frozen population lost its durable identity")


def assert_population_original(result: dict, item: dict, original: dict, population_id: str, manifest_sha256: str) -> None:
    require(result.get("population_id") == population_id and result.get("manifest_sha256") == manifest_sha256
            and result.get("status") == "available" and result.get("value") == original,
            "Population source reader did not return the exact permitted original")
    require(item["source"]["sha256"] == hashlib.sha256(encoded(original).encode()).hexdigest(),
            "Population original does not match its frozen source version")


def assert_population_renderings(page: dict, markdown: str, html: str) -> dict:
    require(markdown.startswith("# ") and html.startswith("<!doctype html>")
            and "default-src 'none'" in html and "<script" not in html,
            "Population presentation omitted the document or introduced active execution")
    html = unescape(html)
    identities = [page["population_id"], page["manifest_sha256"], page["manifest"]["selection"]["objective_id"],
                  *(item["key"] for item in page["items"]), *(item["source"]["id"] for item in page["items"])]
    for text in (markdown, html):
        require(all(identity in text for identity in identities), "Population rendering changed shared membership or source identities")
        require(page["manifest"]["selection"]["question"] in text,
                "Population rendering omitted the selected evaluation question")
        require(all(qualification in text for qualification in page["manifest"].get("qualifications", [])),
                "Population rendering omitted a frozen qualification")
    return {"shared_identities": len(identities), "network_or_script_capability": False}


def assert_population_setup_effects(observed: list[dict], reader: str, plans: list[dict]) -> dict:
    allowed = {"execute", *(name for tool in ("history", "review", "record", "objective", "action")
                            for name in ("loom_" + tool, "loom." + tool))}
    require(all(event["data"].get("tool") in allowed for event in observed if event["type"] == "tool-before"),
            "Population setup invoked an unexpected executor")
    require(all(event["data"].get("sessionID") == reader and event["data"].get("agent") == "general"
                and event["data"].get("model", {}).get("providerID") == "question-fixture"
                for event in observed if event["type"] == "model-request"),
            "Population setup invoked an Evaluator or external provider")
    require(not any(event["type"] == "native-event" and event["data"].get("type") in ("session.created", "session.synthetic")
                    for event in observed), "Population setup created a native recipient")
    require(not any(event["type"] == "provider-inputs" and event["data"].get("notices") for event in observed),
            "Population setup resumed a native recipient")
    return {**assert_driver_invocations(observed, plans), "evaluator_dispatches": 0, "external_provider_requests": 0}


def prepare_population(scenario, reader: str, fixture: dict) -> dict:
    selection = {"objective_id": fixture["objective"]["id"],
                 "question": "Explain the bounded issue 187 test correction; preserve original a1 failure, unchanged rerun and remaining release uncertainty."}
    preview = scenario.read(reader, "history", {"operation": "preview-population", "selection": selection, "limit": 5},
                            "population-preview-first")
    preview_pages = read_population_pages(scenario, reader, preview, "population-preview")
    expected = assert_population_pages(preview_pages, fixture, state="preview")
    require(len(preview_pages) > 1, "Installed population did not exercise bounded complete membership")
    require(preview.get("freeze", {}).get("operation") == "freeze-population"
            and preview["freeze"].get("preview_sha256") == preview["manifest_sha256"],
            "Population preview omitted an exact freeze request")
    frozen = scenario.invoke(reader, "review", preview["freeze"])
    require(frozen.get("state") == "frozen" and frozen.get("manifest_sha256") == preview["manifest_sha256"]
            and isinstance(frozen.get("population_id"), str), "Freeze did not retain the approved preview identity")
    replay = scenario.invoke(reader, "review", preview["freeze"])
    require(replay.get("population_id") == frozen["population_id"] and replay.get("manifest_sha256") == frozen["manifest_sha256"],
            "Population freeze replay allocated a second identity")
    prepared = scenario.invoke(reader, "review", {"operation": "prepare-evaluation", "population_id": frozen["population_id"],
        "manifest_sha256": frozen["manifest_sha256"], "method": synthetic_method(), "budget_policy": None})
    require(prepared.get("state") == "prepared" and prepared.get("mode") == "preparation-only"
            and prepared.get("automatic_model_calls") is False and prepared.get("budget_reservation") is None
            and prepared.get("interpretation") is None
            and prepared.get("issue", {}).get("attempt", {}).get("state") == "prepared"
            and prepared["issue"]["attempt"].get("claimant_id") is None,
            "Retrospective preparation invented execution, reasoning or budget authority")
    # One old original gets its first association only after freezing. A second
    # record is genuinely new. Neither may enter the retained population.
    late = scenario.invoke(reader, "record", {"operation": "add", "action_id": fixture["action"]["id"],
        "kind": "concern", "statement": "LATE_POPULATION_COUNTEREVIDENCE: investigate in a new population."})
    for record in (fixture["unrelated"], late):
        scenario.invoke(reader, "objective", {"operation": "link", "objective_id": fixture["objective"]["id"],
            "phase": "coordination", "source_type": "ledger-record", "source_id": record["id"],
            "note": "Added after freezing; membership must remain unchanged."})
    return {"fixture": fixture, "preview": preview, "expected": expected, "frozen": frozen,
            "prepared": prepared, "late": late, "query": {"operation": "population", "population_id": frozen["population_id"],
                "manifest_sha256": frozen["manifest_sha256"], "limit": 5}}
