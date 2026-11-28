"""Negative controls for the installed S5 evidence oracle; no native claim here."""
from __future__ import annotations

import copy
import hashlib
import unittest

from installed_evaluator_interpretations import assert_listing_chain, assert_page_chain, assert_report_binding, assert_sources
from installed_evaluator_execution import encoded


class InterpretationEvidenceOracleTest(unittest.TestCase):
    def setUp(self):
        self.publication = {"batch_id": "batch-one", "report_id": "report-one", "report_sha256": "a" * 64,
                            "qualification": "publication-mechanics-only"}
        self.binding = {"subject": {"request_id": "request-one"}, "result": {"result_id": "original-result"}}

    def page(self, start, items, total=3):
        end = start + len(items)
        return {"format": "loom-evaluator-interpretation-page/v1", "section": "claims", "representation": "items",
                "report_id": self.publication["report_id"], "report_sha256": self.publication["report_sha256"],
                "binding": copy.deepcopy(self.binding), "coverage": {"from": start, "to": end, "total": total,
                    "complete": start == 0 and end == total}, "items": items,
                "navigation": {"sections": [], "next": None if end == total else {
                    "operation": "evaluation-interpretation", "batch_id": self.publication["batch_id"],
                    "report_id": self.publication["report_id"], "report_sha256": self.publication["report_sha256"],
                    "section": "claims", "after": "opaque-cursor-" + str(end), "limit": 2}}}

    def test_complete_chain_is_accepted_but_a_valid_prefix_is_not_complete(self):
        pages = [self.page(0, [{"claim_id": "a"}, {"claim_id": "b"}]), self.page(2, [{"claim_id": "c"}])]
        self.assertEqual(assert_page_chain(pages, self.publication, "claims"),
                         [{"claim_id": "a"}, {"claim_id": "b"}, {"claim_id": "c"}])
        with self.assertRaisesRegex(RuntimeError, "incomplete prefix"):
            assert_page_chain(pages[:1], self.publication, "claims")

    def test_duplicate_page_and_duplicate_item_are_rejected(self):
        first, last = self.page(0, [{"claim_id": "a"}, {"claim_id": "b"}]), self.page(2, [{"claim_id": "c"}])
        with self.assertRaisesRegex(RuntimeError, "omitted or duplicated"):
            assert_page_chain([first, first, last], self.publication, "claims")
        duplicate = self.page(2, [{"claim_id": "a"}])
        with self.assertRaisesRegex(RuntimeError, "duplicated a complete item"):
            assert_page_chain([first, duplicate], self.publication, "claims")

    def test_changed_report_binding_or_cursor_owner_is_rejected(self):
        first, last = self.page(0, [{"claim_id": "a"}, {"claim_id": "b"}]), self.page(2, [{"claim_id": "c"}])
        changed = copy.deepcopy(last)
        changed["binding"]["result"]["result_id"] = "different-native-result"
        with self.assertRaisesRegex(RuntimeError, "binding or total changed"):
            assert_page_chain([first, changed], self.publication, "claims")
        wrong_owner = copy.deepcopy(first)
        wrong_owner["navigation"]["next"]["batch_id"] = "different-owner-batch"
        with self.assertRaisesRegex(RuntimeError, "owner/report binding"):
            assert_page_chain([wrong_owner, last], self.publication, "claims")

    def test_false_terminal_page_and_overstated_page_coverage_are_rejected(self):
        first = self.page(0, [{"claim_id": "a"}, {"claim_id": "b"}])
        first["navigation"]["next"] = None
        with self.assertRaisesRegex(RuntimeError, "exact remaining items"):
            assert_page_chain([first], self.publication, "claims")
        first = self.page(0, [{"claim_id": "a"}, {"claim_id": "b"}])
        first["coverage"]["complete"] = True
        with self.assertRaisesRegex(RuntimeError, "coverage was overstated"):
            assert_page_chain([first], self.publication, "claims")

    def test_list_full_final_page_is_followed_to_empty_terminal_page(self):
        other = {**self.publication, "batch_id": "batch-two", "report_id": "report-two", "report_sha256": "b" * 64}
        def listing(items, before):
            return {"format": "loom-evaluator-interpretations/v1", "items": items, "next_before": before,
                    "navigation": {"next": None if before is None else {
                        "operation": "evaluation-interpretations", "before": before, "limit": 1}}}
        pages = [listing([other], 2), listing([self.publication], 1), listing([], None)]
        self.assertEqual(assert_listing_chain(pages, [self.publication, other]), [other, self.publication])
        with self.assertRaisesRegex(RuntimeError, "before its terminal page"):
            assert_listing_chain(pages[:-1], [self.publication, other])
        duplicated = copy.deepcopy(pages)
        duplicated[1]["items"] = [other]
        with self.assertRaisesRegex(RuntimeError, "omitted, duplicated or changed"):
            assert_listing_chain(duplicated, [self.publication, other])
        repeated = copy.deepcopy(pages)
        repeated[1]["next_before"] = 2
        repeated[1]["navigation"]["next"]["before"] = 2
        with self.assertRaisesRegex(RuntimeError, "failed to advance"):
            assert_listing_chain(repeated, [self.publication, other])

    def test_raw_utf8_result_is_bound_instead_of_reserialized_json(self):
        raw = '{ "format": "fixture", "text": "café" }\n'
        subject = {"source": {"population_id": "population-one", "manifest_sha256": "b" * 64}}
        admission = {"grant": {"subject": subject, "method": {"revision": "method-one"}}}
        ref = {"host_id": "host", "session_id": "native-recipient", "input_id": "original-input",
               "result_id": "original-result", "sha256": hashlib.sha256(raw.encode()).hexdigest()}
        binding = {"subject": subject, "result": ref,
                   "admission_sha256": hashlib.sha256(encoded(admission).encode()).hexdigest(),
                   "method_sha256": hashlib.sha256(encoded(admission["grant"]["method"]).encode()).hexdigest()}
        prepared = {"pins": {"batch_id": self.publication["batch_id"]}, **subject["source"]}
        prepared["population_sha256"] = prepared.pop("manifest_sha256")
        execution = {"admission": admission, "receipt": {"result": ref}}
        assert_report_binding({"binding": binding}, self.publication, prepared, execution, raw)
        with self.assertRaisesRegex(RuntimeError, "exact original native UTF-8 result"):
            assert_report_binding({"binding": binding}, self.publication, prepared, execution,
                                  '{"format":"fixture","text":"café"}')

    def test_retrieval_and_citation_states_require_different_facts(self):
        members = [{"key": key, "availability": availability, "source": {"id": key, "sha256": "c" * 64},
                    "source_store_id": "owner-store", "permitted_view": "record-full"}
                   for key, availability in (("cited", "available"), ("uncited", "available"), ("gap", "missing"))]
        frozen = {"population_id": "population-one", "population_sha256": "b" * 64, "members": members}
        raw = {"claims": [{"supporting": [{"member_key": "cited"}], "contradicting": []}], "trajectory": [], "review_coverage": []}
        items = [{"member_key": member["key"], "selected": True, "retrieved": member["availability"] == "available",
                  "cited": member["key"] == "cited", "unavailable": member["availability"] != "available",
                  "source": member["source"], "source_store_id": member["source_store_id"], "permitted_view": member["permitted_view"],
                  "retrievals": [] if member["availability"] != "available" else [{"boundary": "native-tool-result", "source_sha256": "c" * 64}],
                  "inspect": {"operation": "population-source", "population_id": frozen["population_id"],
                              "manifest_sha256": frozen["population_sha256"], "member_key": member["key"]}}
                 for member in members]
        assert_sources(items, frozen, raw)
        changed = copy.deepcopy(items)
        changed[1]["cited"] = True
        with self.assertRaisesRegex(RuntimeError, "states were conflated"):
            assert_sources(changed, frozen, raw)
        changed = copy.deepcopy(items)
        changed[0]["retrievals"][0]["source_sha256"] = "d" * 64
        with self.assertRaisesRegex(RuntimeError, "actual native source boundary"):
            assert_sources(changed, frozen, raw)
        changed = copy.deepcopy(items)
        changed[0]["retrievals"] = []
        with self.assertRaisesRegex(RuntimeError, "no actual native source receipt"):
            assert_sources(changed, frozen, raw)


if __name__ == "__main__":
    unittest.main()
