"""S5 publication/readback through the existing #259 native execution fixture.

The actual packed consumer recovers the original native result and validates it.
Only the local provider's response is scripted. This qualifies publication
mechanics, not genuine reasoning or authority over any real account.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

from installed_evaluator_execution import (
    Case, HOST, assert_admissions, assert_retrospective_delivery, encoded,
    inventory, native, sha, until,
)
from installed_host_smoke import installed_plugin_inventory, isolated_environment, require
from installed_instruction_variants import verify_host_version

SECTIONS = ("overview", "trajectory", "claims", "review_coverage", "gaps", "sources", "prior_interpretations")
CHECKS = {
    "native-original-result-published-with-exact-bindings",
    "complete-bounded-multipage-readback",
    "selected-retrieved-cited-unavailable-evidence-distinguished",
    "human-markdown-and-html-retain-exact-evidence-navigation",
    "replay-restart-and-old-snapshot-preserve-report-without-inference",
    "source-loss-withholds-dependent-content",
    "current-authority-denies-initial-and-continuation-reads",
    "malformed-native-result-rejected",
    "unsupported-native-claim-rejected",
    "unknown-native-citation-rejected",
    "unavailable-native-citation-rejected",
    "explicit-no-change-published",
    "interrupted-ack-result-published-after-restart-without-inference",
    "contradictory-later-population-adds-attributable-revision",
    "pagination-oracle-rejects-incomplete-and-duplicate-pages",
}


class InterpretationCase(Case):
    """Reuse the same native host, provider authority and consumer lifecycle."""

    def __init__(self, args, root, output, name, *, interpretation="recommendations", capacity=2,
                 mode="complete", lose_ack=False):
        super().__init__(args, root, output, name, mode=mode, lose_ack=lose_ack)
        self.policy.update(interpretation_mode=interpretation, capacity=capacity)
        self.policy["method"]["rubric"] = {
            "locator": "fixture://execution/structured-publication-rubric",
            "sha256": sha(args.repository / "tests/evaluator-execution-host/interpretation.ts"),
        }
        self.save_policy()

    def save_policy(self):
        (self.root / "policy.json").write_text(encoded(self.policy))

    def read(self, value, *, command="read", success=True):
        (self.root / "consumers/first/read.json").write_text(encoded(value))
        return self.driver(command, success=success)


def report_query(publication, section="overview", limit=2):
    return {"operation": "evaluation-interpretation", "batch_id": publication["batch_id"],
            "report_id": publication["report_id"], "report_sha256": publication["report_sha256"],
            "section": section, "limit": limit}


def assert_page_chain(pages, publication, section):
    """A valid prefix is not a complete read; every continuation must be consumed."""
    require(bool(pages), "No interpretation pages were returned")
    total, offset, binding, items = None, 0, None, []
    for index, page in enumerate(pages):
        require(page.get("format") == "loom-evaluator-interpretation-page/v1"
                and page.get("section") == section
                and page.get("report_id") == publication["report_id"]
                and page.get("report_sha256") == publication["report_sha256"],
                "Interpretation page identity or section changed")
        require(page.get("representation") == "items", "Unexpected fragmented small fixture item")
        coverage = page["coverage"]
        if total is None:
            total, binding = coverage["total"], page["binding"]
        require(page["binding"] == binding and coverage["total"] == total,
                "Interpretation binding or total changed during retrieval")
        require(coverage["from"] == offset and coverage["to"] == offset + len(page["items"])
                and coverage["to"] <= total, "Interpretation page omitted or duplicated items")
        require(coverage["complete"] == (offset == 0 and coverage["to"] == total),
                "Interpretation whole-page coverage was overstated")
        items.extend(page["items"])
        offset = coverage["to"]
        next_page = page["navigation"]["next"]
        require(bool(next_page) == (offset < total), "Interpretation continuation does not cover the exact remaining items")
        if next_page:
            require(next_page["operation"] == "evaluation-interpretation"
                    and next_page["batch_id"] == publication["batch_id"]
                    and next_page["report_id"] == publication["report_id"]
                    and next_page["report_sha256"] == publication["report_sha256"]
                    and next_page["section"] == section and next_page.get("after"),
                    "Interpretation continuation lost its exact owner/report binding")
        if index < len(pages) - 1:
            require(next_page is not None, "An extra interpretation page followed the terminal page")
    require(offset == total and pages[-1]["navigation"]["next"] is None,
            "Interpretation retrieval stopped at a valid but incomplete prefix")
    require(len({encoded(item) for item in items}) == len(items), "Interpretation retrieval duplicated a complete item")
    return items


def read_section(case, publication, section):
    query, pages, cursors = report_query(publication, section), [], set()
    while query is not None:
        require(encoded(query) not in cursors and len(pages) < 100, "Interpretation continuation repeated or exceeded fixture bound")
        cursors.add(encoded(query))
        page = case.read(query)
        pages.append(page)
        query = page["navigation"]["next"]
    return pages, assert_page_chain(pages, publication, section)


def assert_listing_chain(pages, publications, limit=1):
    """Exhaust the authorized-row cursor, including an empty terminal page.

    A full page may always have a continuation: it need not reveal whether an
    additional authorized report exists before the next read is authorized.
    """
    require(bool(pages), "No interpretation list pages were returned")
    items, previous_before = [], None
    for index, page in enumerate(pages):
        require(page.get("format") == "loom-evaluator-interpretations/v1"
                and len(page["items"]) <= limit, "Interpretation list exceeded its bounded representation")
        items.extend(page["items"])
        next_page = page["navigation"]["next"]
        require(bool(next_page) == (len(page["items"]) == limit),
                "Interpretation list continuation was not derived from the authorized full page")
        if next_page:
            require(next_page == {"operation": "evaluation-interpretations", "before": page["next_before"], "limit": limit}
                    and isinstance(page["next_before"], int) and page["next_before"] > 0
                    and (previous_before is None or page["next_before"] < previous_before),
                    "Interpretation list continuation changed scope or failed to advance")
            previous_before = page["next_before"]
        else:
            require(page["next_before"] is None and index == len(pages) - 1,
                    "An interpretation list page followed the terminal page")
    require(pages[-1]["navigation"]["next"] is None, "Interpretation list stopped before its terminal page")
    expected = {(item["batch_id"], item["report_id"], item["report_sha256"]) for item in publications}
    actual = [(item["batch_id"], item["report_id"], item["report_sha256"]) for item in items]
    require(len(actual) == len(set(actual)) and set(actual) == expected,
            "Interpretation list omitted, duplicated or changed a report")
    return items


def read_list(case, publications, limit=1):
    query, pages, cursors = {"operation": "evaluation-interpretations", "limit": limit}, [], set()
    while query is not None:
        require(encoded(query) not in cursors and len(pages) < 100, "Interpretation list cursor repeated or exceeded fixture bound")
        cursors.add(encoded(query))
        page = case.read(query)
        pages.append(page)
        query = page["navigation"]["next"]
    return pages, assert_listing_chain(pages, publications, limit)


def assert_report_binding(page, publication, prepared, execution, raw_text):
    binding, admission, receipt = page["binding"], execution["admission"], execution["receipt"]
    require(publication.get("qualification") == "publication-mechanics-only", "Scripted publication was mistaken for reasoning")
    require(publication["batch_id"] == prepared["pins"]["batch_id"], "Publication changed evaluation batch")
    require(binding["subject"] == admission["grant"]["subject"]
            and binding["result"] == receipt["result"], "Published interpretation changed execution identity")
    require(binding["admission_sha256"] == hashlib.sha256(encoded(admission).encode()).hexdigest()
            and binding["method_sha256"] == hashlib.sha256(encoded(admission["grant"]["method"]).encode()).hexdigest(),
            "Publication did not retain exact authority/method bindings")
    require(hashlib.sha256(raw_text.encode()).hexdigest() == binding["result"]["sha256"],
            "Publication is not bound to the exact original native UTF-8 result")
    source = binding["subject"]["source"]
    require(source["population_id"] == prepared["population_id"]
            and source["manifest_sha256"] == prepared["population_sha256"],
            "Publication changed the frozen population")


def original_result(case, execution):
    ref = execution["receipt"]["result"]
    messages = native(case.host, "GET", "/api/session/" + ref["session_id"] + "/message?order=asc&limit=200")
    require(isinstance(messages, list) and len(messages) < 200, "Native result history is incomplete")
    matches = [message for message in messages if message.get("id") == ref["result_id"]]
    require(len(matches) == 1 and matches[0].get("type") == "assistant", "Original native result identity is absent or ambiguous")
    texts = [part["text"] for part in matches[0]["content"] if part.get("type") == "text"]
    require(len(texts) == 1 and hashlib.sha256(texts[0].encode()).hexdigest() == ref["sha256"],
            "Native result bytes disagree with authoritative receipt")
    return texts[0]


def assert_sources(items, frozen, raw):
    require([item["member_key"] for item in items] == [member["key"] for member in frozen["members"]],
            "Public sources changed exact frozen membership/order")
    cited = {ref["member_key"] for claim in raw["claims"] for ref in claim["supporting"] + claim["contradicting"]}
    cited.update(ref["member_key"] for event in raw["trajectory"] for ref in event["supporting"])
    cited.update(ref["member_key"] for review in raw["review_coverage"] for ref in review["supporting"])
    for item, member in zip(items, frozen["members"]):
        require(item["selected"] is True and item["retrieved"] == (member["availability"] == "available")
                and item["unavailable"] == (member["availability"] != "available")
                and item["cited"] == (member["key"] in cited), "Selected/retrieved/cited/unavailable states were conflated")
        require(item["source"] == member["source"] and item["source_store_id"] == member["source_store_id"]
                and item["permitted_view"] == member["permitted_view"], "Public source dependency changed version or view")
        require(item["inspect"] == {"operation": "population-source", "population_id": frozen["population_id"],
                "manifest_sha256": frozen["population_sha256"], "member_key": member["key"]},
                "Public report cannot navigate to its exact evidence foundation")
        require(bool(item["retrievals"]) == item["retrieved"], "Retrieved status has no actual native source receipt")
        for receipt in item["retrievals"]:
            require(receipt["boundary"] == "native-tool-result" and receipt["source_sha256"] == member["source"]["sha256"],
                    "Retrieved status was not grounded in the actual native source boundary")
    require(any(item["retrieved"] and not item["cited"] for item in items)
            and any(item["unavailable"] and not item["retrieved"] for item in items),
            "Fixture did not exercise uncited retrieval and unavailable selection distinctly")


def run(args):
    output = args.report_directory
    output.mkdir(parents=True, exist_ok=False, mode=0o700)
    args.preparation_source = "retrospective"
    result = {"format": "loom-installed-evaluator-interpretations/v1", "status": "UNPROVEN", "checks": [], "journals": {},
              "qualification": "publication-mechanics-only", "genuine_evaluator": "UNPROVEN",
              "real_account_authority": "UNPROVEN", "production_dispatch": "DISABLED",
              "limitations": ["Structured provider results are scripted; no reasoning or real-account authority is qualified.",
                  "Uses the existing #259 controlled execution consumer with the packed runtime; no external report import.",
                  "Synthetic authored evidence demonstrates referential fidelity, not independent truth or entailment.",
                  "The controlled native authority survives a restored Loom pair; simultaneous authority loss is not qualified."]}
    active_case = None
    try:
        require(args.opencode.is_file() and args.bun.is_file(), "Pinned native and Bun binaries required")
        result["source_head"] = subprocess.check_output(["git", "-C", str(args.repository), "rev-parse", "HEAD"], text=True).strip()
        require(result["source_head"] == args.expect_head, "Source candidate HEAD changed")
        result["source_dirty"] = bool(subprocess.check_output(["git", "-C", str(args.repository), "status", "--porcelain"], text=True).strip())
        require(args.allow_dirty_development or not result["source_dirty"], "Qualification requires a clean exact source candidate")
        result["development_only"] = args.allow_dirty_development
        result["candidate"] = installed_plugin_inventory(args.artifact, args.plugin, args.expect_plugin_version, HOST)
        runtime = [args.repository / "server.ts", *[path for path in (args.repository / "src").rglob("*") if path.is_file()]]
        require(all((args.plugin / path.relative_to(args.repository)).is_file()
                    and sha(path) == sha(args.plugin / path.relative_to(args.repository)) for path in runtime),
                "Packed runtime differs from source candidate")
        result["runtime_files_checked"] = len(runtime)
        result["input_sha256"] = {str(path.relative_to(args.repository)): sha(path) for path in [
            args.repository / "tests/installed_evaluator_interpretations.py", args.repository / "tests/installed_evaluator_execution.py",
            args.repository / "tests/installed_host_smoke.py", args.repository / "tests/installed_instruction_variants.py",
            *sorted((args.repository / "tests/evaluator-execution-host").glob("*"))] if path.is_file()}
        result["cli_sha256"] = sha(args.opencode)

        def check(name, **evidence):
            require(name in CHECKS and name not in {item["name"] for item in result["checks"]}, "Unexpected or duplicate S5 qualification check")
            result["checks"].append({"name": name, "status": "PASS", **evidence})
            print("PASS " + name, flush=True)

        with tempfile.TemporaryDirectory(prefix="loom-installed-interpretations-") as temporary:
            base = Path(temporary).resolve()
            result["host_version"] = subprocess.check_output([str(args.opencode), "--version"],
                env=isolated_environment(base / "version"), text=True, timeout=15).strip()
            verify_host_version(result["host_version"])
            profiles = ["complete", "malformed", "unsupported", "unknown-member", "unavailable-citation", "no-change", "lost-ack", "revision"]
            for name in profiles:
                root = base / name
                root.mkdir(mode=0o700)
                completed = False
                case = active_case = InterpretationCase(args, root, output, name,
                    interpretation="recommendations" if name in ("complete", "lost-ack", "revision") else name,
                    capacity=4 if name == "revision" else 2, mode="hold" if name == "lost-ack" else "complete",
                    lose_ack=name == "lost-ack")
                try:
                    prepared = case.driver("init")
                    frozen = json.loads((root / "consumers/first/case.json").read_text())
                    if name == "complete":
                        case.snapshot()
                    if name == "lost-ack":
                        lost = case.driver("execute", success=False)
                        require("lost acknowledgement" in lost["error"], "Expected interruption did not cross native provider admission")
                        held = until(lambda: inventory(root), lambda journal: any(event["type"] == "provider-held" for event in journal["events"]),
                                     "scripted original held after lost acknowledgement")
                        row = held["enrollments"][0]
                        (root / ("release-" + row["input_id"])).write_text("release original structured result")
                        until(lambda: native(case.host, "GET", "/api/session/" + row["session_id"] + "/message?order=asc&limit=200"),
                              lambda messages: any(message.get("finish") == "stop" and message.get("time", {}).get("completed") for message in messages),
                              "original structured result persisted before recovery")
                        case.restart()
                        execution = case.driver("recover")
                    else:
                        execution = case.driver("execute")
                    require(execution["receipt"]["execution"] == "completed"
                            and execution["receipt"]["budget"] == "settled", "Native result was not authoritatively completed/accounted")
                    raw_text = original_result(case, execution)
                    (output / (name + "-original-result.txt")).write_text(raw_text)
                    assert_admissions(inventory(root), 2)
                    if name in ("malformed", "unsupported", "unknown-member", "unavailable-citation"):
                        denied = case.driver("publish", success=False)
                        require(denied.get("error"), "Invalid native interpretation did not fail validation")
                        empty = case.read({"operation": "evaluation-interpretations", "limit": 2})
                        require(empty.get("items") == [], "Rejected native result produced a public report")
                        require(case.driver("recover")["receipt"] == execution["receipt"], "Validation rejection damaged execution accounting")
                        names = {"malformed": "malformed-native-result-rejected", "unsupported": "unsupported-native-claim-rejected",
                                 "unknown-member": "unknown-native-citation-rejected", "unavailable-citation": "unavailable-native-citation-rejected"}
                        check(names[name], error=denied["error"], result_sha256=execution["receipt"]["result"]["sha256"])
                    else:
                        publication = case.driver("publish")
                        raw = json.loads(raw_text)
                        pages = {section: read_section(case, publication, section) for section in SECTIONS}
                        assert_report_binding(pages["overview"][0][0], publication, prepared, execution, raw_text)
                        (output / (name + "-public-pages.json")).write_text(json.dumps({key: value[0] for key, value in pages.items()}, indent=2) + "\n")
                        if name == "complete":
                            delivery = assert_retrospective_delivery(case)
                            check("native-original-result-published-with-exact-bindings", **publication,
                                  population_id=prepared["population_id"], population_sha256=prepared["population_sha256"],
                                  result=execution["receipt"]["result"], native_evidence=delivery)
                            require(len(pages["claims"][0]) > 1 and pages["claims"][1] == raw["claims"]
                                    and pages["trajectory"][1] == raw["trajectory"] and pages["gaps"][1] == raw["gaps"],
                                    "Multi-page interpretation omitted or altered returned conclusions")
                            check("complete-bounded-multipage-readback", pages={key: len(value[0]) for key, value in pages.items()})
                            assert_sources(pages["sources"][1], frozen, raw)
                            check("selected-retrieved-cited-unavailable-evidence-distinguished", selected=len(frozen["members"]),
                                  retrieved=sum(item["retrieved"] for item in pages["sources"][1]),
                                  cited=sum(item["cited"] for item in pages["sources"][1]),
                                  unavailable=sum(item["unavailable"] for item in pages["sources"][1]))
                            markdown = case.read(report_query(publication, "overview", 25), command="read-markdown")
                            html = case.read(report_query(publication, "sources", 25), command="read-html")
                            require("# Evaluator retrospective" in markdown and raw["conclusion"]["statement"] in markdown
                                    and publication["report_id"] in markdown and "population-source" in html
                                    and "Content-Security-Policy" in html and "default-src 'none'" in html and "<script" not in html,
                                    "Human representation lost conclusions, report identity, source navigation or inertness")
                            (output / "complete-report.md").write_text(markdown)
                            (output / "complete-sources.html").write_text(html)
                            check("human-markdown-and-html-retain-exact-evidence-navigation")
                            for invalid in (pages["claims"][0][:-1], pages["claims"][0][:1] + pages["claims"][0]):
                                try:
                                    assert_page_chain(invalid, publication, "claims")
                                except (RuntimeError, AssertionError):
                                    pass
                                else:
                                    raise RuntimeError("Pagination oracle accepted missing or duplicated pages")
                            check("pagination-oracle-rejects-incomplete-and-duplicate-pages")
                            require(case.driver("publish") == publication, "Publication replay changed the exact report identity")
                            case.restart()
                            require(case.driver("publish") == publication, "Native restart changed the exact report identity")
                            case.restore()
                            require(case.driver("publish") == publication, "Restored pre-effect snapshot created another report")
                            require(case.driver("recover")["receipt"] == execution["receipt"], "Restored publication changed original execution accounting")
                            require(read_section(case, publication, "claims")[1] == raw["claims"], "Restored report changed original claims")
                            check("replay-restart-and-old-snapshot-preserve-report-without-inference", **publication, provider_requests=2)
                            lost_source = case.driver("lose-original")
                            missing = case.read(report_query(publication), success=False)
                            require(missing.get("error"), "Source loss did not withhold dependent content")
                            restored_source = case.driver("restore-original")
                            require(restored_source["restored_source"] == lost_source["missing_source"], "Source recovery changed original identity")
                            require(read_section(case, publication, "claims")[1] == raw["claims"], "Restored source authority changed durable claims")
                            check("source-loss-withholds-dependent-content", error=missing["error"], source_id=lost_source["missing_source"])
                            case.read(report_query(publication), command="read-wrong-actor", success=False)
                            case.policy["source_enabled"] = False
                            case.save_policy()
                            case.read(report_query(publication), success=False)
                            case.read(pages["claims"][0][0]["navigation"]["next"], success=False)
                            case.read({"operation": "evaluation-interpretations", "limit": 2}, success=False)
                            case.policy["source_enabled"] = True
                            case.save_policy()
                            check("current-authority-denies-initial-and-continuation-reads")
                        elif name == "no-change":
                            require(pages["overview"][1][0]["kind"] == "no-change"
                                    and all(claim["kind"] != "recommendation" for claim in pages["claims"][1]),
                                    "Explicit no-change was converted to a recommendation or discarded")
                            check("explicit-no-change-published", **publication)
                        elif name == "lost-ack":
                            check("interrupted-ack-result-published-after-restart-without-inference", **publication, provider_requests=2)
                        else:
                            old_publication, old_claims = publication, pages["claims"][1]
                            case.policy.update(interpretation_mode="revision", prior_report={
                                "report_id": publication["report_id"], "report_sha256": publication["report_sha256"],
                                "claim_id": "validate-correction"})
                            case.save_policy()
                            new_prepared = case.driver("revision-init")
                            require(new_prepared["population_id"] != prepared["population_id"], "Contradictory later evidence changed an existing population")
                            revised_execution = case.driver("execute")
                            revised_publication = case.driver("publish")
                            revised_text = original_result(case, revised_execution)
                            revised_pages, revised_claims = read_section(case, revised_publication, "claims")
                            assert_report_binding(revised_pages[0], revised_publication, new_prepared, revised_execution, revised_text)
                            prior_items = read_section(case, revised_publication, "prior_interpretations")[1]
                            require(prior_items == [{"report_id": publication["report_id"], "report_sha256": publication["report_sha256"],
                                "relation": "contests", "reason": "The new frozen population includes an authored failing follow-up after the earlier pass.",
                                "inspect": {"operation": "evaluation-interpretation", "batch_id": old_publication["batch_id"],
                                            "report_id": old_publication["report_id"], "report_sha256": old_publication["report_sha256"]}}],
                                "Later revision lost its attributable prior report link")
                            prior_readback = case.read(prior_items[0]["inspect"])
                            require(prior_readback["report_id"] == old_publication["report_id"]
                                    and prior_readback["report_sha256"] == old_publication["report_sha256"]
                                    and prior_readback["batch_id"] == old_publication["batch_id"]
                                    and prior_readback["binding"] == pages["overview"][0][0]["binding"],
                                    "Prior interpretation inspection did not recover the exact earlier report")
                            require(any(claim["contradicting"] for claim in revised_claims)
                                    and any(claim["recommendation"] and claim["recommendation"]["prior_recommendations"] for claim in revised_claims),
                                    "Later report lost contradictory evidence or prior recommendation identity")
                            require(read_section(case, old_publication, "claims")[1] == old_claims,
                                    "Later contradictory interpretation erased or rewrote earlier claims")
                            list_pages, listed = read_list(case, [old_publication, revised_publication])
                            require(len(listed) == 2 and len(list_pages) > 1, "Later revision did not preserve both reports in a bounded list")
                            expected_union = {prepared["population_id"], new_prepared["population_id"]}
                            require(any(event["type"] == "population-union-authorized"
                                        and {source["population_id"] for source in event["data"]["populations"]} == expected_union
                                        for event in inventory(root)["events"]),
                                    "Revision was not authorized as one current dependency union")
                            (output / "revision-later-pages.json").write_text(json.dumps(revised_pages, indent=2) + "\n")
                            check("contradictory-later-population-adds-attributable-revision", original=old_publication,
                                  revision=revised_publication, provider_requests=4)
                    assert_admissions(inventory(root), 4 if name == "revision" else 2)
                    completed = True
                finally:
                    case.close()
                    active_case = None
                    if (root / "fixture-authority.sqlite").is_file():
                        result["journals"][name] = inventory(root)
                        if completed:
                            # Finalize after native shutdown; a late retry/request is a failure.
                            assert_admissions(result["journals"][name], 4 if name == "revision" else 2)
        require({item["name"] for item in result["checks"]} == CHECKS, "Missing installed S5 qualification checks")
        result["status"] = "PASS"
    except Exception as error:
        result["status"], result["error"] = "FAIL", f"{type(error).__name__}: {error}"
    finally:
        if active_case:
            active_case.close()
        (output / "report.json").write_text(json.dumps(result, indent=2) + "\n")
        for path in output.iterdir():
            if path.is_file():
                path.chmod(0o600)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--opencode", type=Path, required=True)
    parser.add_argument("--bun", type=Path, default=Path(shutil.which("bun")) if shutil.which("bun") else None)
    parser.add_argument("--repository", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--plugin", type=Path, required=True)
    parser.add_argument("--artifact", type=Path, required=True)
    parser.add_argument("--expect-plugin-version", default="2.0.0-alpha.1")
    parser.add_argument("--expect-head", required=True)
    parser.add_argument("--report-directory", type=Path, required=True)
    parser.add_argument("--disable-filewatcher", action="store_true")
    parser.add_argument("--allow-dirty-development", action="store_true",
                        help="Debug only; a dirty report cannot qualify a reviewed commit")
    args = parser.parse_args()
    for name in ("opencode", "bun", "repository", "plugin", "artifact", "report_directory"):
        if getattr(args, name):
            setattr(args, name, getattr(args, name).resolve())
    result = run(args)
    print(json.dumps({key: result.get(key) for key in ("status", "source_head", "development_only", "error", "checks")}))
    raise SystemExit(0 if result["status"] == "PASS" else 1)


if __name__ == "__main__":
    main()
