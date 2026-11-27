"""Counterexamples for population qualification oracles; not host acceptance."""
from copy import deepcopy
import hashlib
import unittest

from installed_retrospective_populations import (
    assert_population_original, assert_population_pages, assert_population_renderings,
    assert_population_setup_effects, assert_population_stable, encoded, read_population_pages,
)
from test_installed_learning_stage4 import driver_plan, driver_receipts


def population_fixture():
    records = {name: {"id": name, "session_id": "owner", "kind": "result", "data": {"statement": statement}}
               for name, statement in (("failure", "Original a1 failure; cause unknown."),
                                       ("rerun", "Unchanged a1 rerun before the correction."),
                                       ("correction", "Different b2 test correction; scoped verification only."))}
    fixture = {"records": records, "objective": {"id": "objective"}, "unrelated": {"id": "unrelated"}}
    manifest = {"selection": {"objective_id": "objective", "question": "Explain one bounded correction."},
                "qualifications": ["Original cause and native binding remain unproven."]}
    items = [{"key": "objective-key", "ordinal": 1, "source": {"kind": "objective", "id": "objective"},
              "basis": [{"kind": "selected-objective"}], "availability": "available", "current": {"status": "available"}}]
    for index, record in enumerate(records.values(), 2):
        items.append({"key": "source-" + record["id"], "ordinal": index,
                      "source": {"kind": "ledger-record", "id": record["id"], "session_id": "owner",
                                 "revision": str(index + 10), "sha256": hashlib.sha256(encoded(record).encode()).hexdigest()},
                      "permitted_view": "record-full", "historical_scope": {"work_ref": None, "record_kind": "result"},
                      "basis": [{"kind": "objective-link", "id": "link-" + str(index)}],
                      "availability": "available", "current": {"status": "available"}})
    common = {"format": "loom-retrospective-population-view/v1", "state": "frozen", "population_id": "population",
              "manifest_sha256": "a" * 64, "manifest": manifest, "member_count": 4}
    pages = [{**deepcopy(common), "items": deepcopy(items[:2]), "navigation": {"next": {"operation": "population", "after": 2}}},
             {**deepcopy(common), "items": deepcopy(items[2:]), "navigation": {"next": None}}]
    return fixture, pages


class PopulationMembershipOracleTest(unittest.TestCase):
    def test_complete_bounded_membership_matches_independent_setup_receipts(self):
        fixture, pages = population_fixture()
        result = assert_population_pages(pages, fixture, state="frozen", population_id="population")
        self.assertEqual((result["pages"], result["member_count"], result["original_count"]), (2, 4, 3))
        self.assertEqual(pages[-1]["navigation"]["next"], None)

    def test_prefix_cannot_claim_complete_membership(self):
        fixture, pages = population_fixture()
        pages[0]["navigation"]["next"] = None
        with self.assertRaisesRegex(RuntimeError, "omitted a selected original"):
            assert_population_pages(pages[:1], fixture, state="frozen", population_id="population")

    def test_duplicates_and_skipped_ordinals_do_not_pass(self):
        for field, value in (("key", "source-failure"), ("ordinal", 4)):
            fixture, pages = population_fixture()
            pages[1]["items"][0][field] = value
            with self.subTest(field=field), self.assertRaisesRegex(RuntimeError, "omitted or duplicated"):
                assert_population_pages(pages, fixture, state="frozen", population_id="population")

    def test_source_version_or_authority_scope_changes_are_detected(self):
        for field, value in (("sha256", "f" * 64), ("session_id", "foreign"), ("revision", None)):
            fixture, pages = population_fixture()
            pages[1]["items"][0]["source"][field] = value
            with self.subTest(field=field), self.assertRaisesRegex(RuntimeError, "source/version/permitted view"):
                assert_population_pages(pages, fixture, state="frozen", population_id="population")
        for field, value in (("permitted_view", "native-raw"), ("historical_scope", {"work_ref": {"plan_revision": 9}})):
            fixture, pages = population_fixture()
            pages[1]["items"][0][field] = value
            with self.subTest(field=field), self.assertRaisesRegex(RuntimeError, "source/version/permitted view"):
                assert_population_pages(pages, fixture, state="frozen", population_id="population")

    def test_other_objective_and_silent_gaps_are_rejected(self):
        fixture, pages = population_fixture()
        pages[0]["items"][0]["source"]["id"] = "unrelated-objective"
        with self.assertRaisesRegex(RuntimeError, "broadened the selected objective"):
            assert_population_pages(pages, fixture, state="frozen", population_id="population")
        fixture, pages = population_fixture()
        pages[0]["items"][1]["current"]["status"] = "missing"
        with self.assertRaisesRegex(RuntimeError, "unexplained population gap"):
            assert_population_pages(pages, fixture, state="frozen", population_id="population")

    def test_page_identity_and_qualification_must_be_stable(self):
        for field, value in (("manifest_sha256", "f" * 64), ("population_id", "other"), ("state", "preview")):
            fixture, pages = population_fixture()
            pages[1][field] = value
            with self.subTest(field=field), self.assertRaises(RuntimeError):
                assert_population_pages(pages, fixture, state="frozen", population_id="population")
        fixture, pages = population_fixture()
        pages[1]["manifest"]["qualifications"] = []
        with self.assertRaisesRegex(RuntimeError, "scope or qualifications"):
            assert_population_pages(pages, fixture, state="frozen", population_id="population")

    def test_later_changed_membership_cannot_reuse_manifest_identity(self):
        fixture, pages = population_fixture()
        before = assert_population_pages(pages, fixture, state="frozen", population_id="population")
        after = deepcopy(before)
        after["items"][-1]["source"]["id"] = "late-record"
        with self.assertRaisesRegex(RuntimeError, "changed the frozen population"):
            assert_population_stable(before, after, "population")

    def test_consistent_but_wrong_declared_count_cannot_certify_completeness(self):
        fixture, pages = population_fixture()
        for page in pages:
            page["member_count"] = 5
        with self.assertRaisesRegex(RuntimeError, "declared count"):
            assert_population_pages(pages, fixture, state="frozen", population_id="population")

    def test_preview_navigation_can_gain_durable_read_locator_without_changing_membership(self):
        fixture, pages = population_fixture()
        before = assert_population_pages(pages, fixture, state="frozen", population_id="population")
        after = deepcopy(before)
        for item in before["items"]:
            item["inspect"] = None
        for item in after["items"]:
            item["inspect"] = {"operation": "population-source", "population_id": "population", "member_key": item["key"]}
        assert_population_stable(before, after, "population")


class PopulationSourceAndRenderingOracleTest(unittest.TestCase):
    def test_exact_source_is_required_and_replacement_bytes_fail(self):
        fixture, pages = population_fixture()
        item, original = pages[0]["items"][1], fixture["records"]["failure"]
        value = {"population_id": "population", "manifest_sha256": "a" * 64, "status": "available", "value": original}
        assert_population_original(value, item, original, "population", "a" * 64)
        wrong = deepcopy(value)
        wrong["value"]["data"]["statement"] = "Replacement source bytes"
        with self.assertRaisesRegex(RuntimeError, "exact permitted original"):
            assert_population_original(wrong, item, original, "population", "a" * 64)

    def renderings(self, page):
        identity = " ".join([page["population_id"], page["manifest_sha256"], page["manifest"]["selection"]["objective_id"],
                             page["manifest"]["selection"]["question"], *page["manifest"]["qualifications"],
                             *(item["key"] for item in page["items"]), *(item["source"]["id"] for item in page["items"])])
        return "# Frozen population\n" + identity, "<!doctype html><meta content=\"default-src 'none'\"><p>" + identity + "</p>"

    def test_both_renderings_preserve_identities_question_and_qualifications(self):
        _, pages = population_fixture()
        markdown, html = self.renderings(pages[0])
        result = assert_population_renderings(pages[0], markdown, html)
        self.assertFalse(result["network_or_script_capability"])
        for omitted in (pages[0]["manifest_sha256"], pages[0]["manifest"]["selection"]["question"],
                        pages[0]["manifest"]["qualifications"][0]):
            with self.subTest(omitted=omitted), self.assertRaises(RuntimeError):
                assert_population_renderings(pages[0], markdown, html.replace(omitted, ""))
        with self.assertRaisesRegex(RuntimeError, "active execution"):
            assert_population_renderings(pages[0], markdown, html + "<script>fetch('/')</script>")


class PopulationEffectOracleTest(unittest.TestCase):
    def receipts(self):
        return [event for event in driver_receipts()
                if not (event["type"] == "native-event" and event["data"]["type"] == "session.created")]

    def test_setup_is_reconciled_against_each_actual_driver_invocation(self):
        result = assert_population_setup_effects(self.receipts(), "owner", driver_plan())
        self.assertEqual(result["evaluator_dispatches"], 0)
        duplicated = self.receipts()
        duplicated.append(deepcopy(next(event for event in duplicated if event["type"] == "model-request")))
        with self.assertRaisesRegex(RuntimeError, "invocation"):
            assert_population_setup_effects(duplicated, "owner", driver_plan())

    def test_evaluator_or_extra_native_recipient_cannot_hide_in_setup(self):
        receipts = self.receipts()
        next(event for event in receipts if event["type"] == "model-request")["data"]["agent"] = "evaluator"
        with self.assertRaisesRegex(RuntimeError, "Evaluator or external"):
            assert_population_setup_effects(receipts, "owner", driver_plan())
        for extra in ({"type": "tool-before", "data": {"tool": "subagent"}},
                      {"type": "native-event", "data": {"type": "session.created"}},
                      {"type": "provider-inputs", "data": {"notices": ["resume"]}}):
            with self.subTest(extra=extra), self.assertRaises(RuntimeError):
                assert_population_setup_effects(self.receipts() + [extra], "owner", driver_plan())


class PopulationContinuationOracleTest(unittest.TestCase):
    def test_continuation_uses_the_returned_query_without_changing_the_population(self):
        _, pages = population_fixture()

        class Scenario:
            def __init__(self):
                self.queries = []

            def read(self, reader, tool, query, label):
                self.queries.append((reader, tool, deepcopy(query)))
                return pages[1]

        scenario = Scenario()
        returned = read_population_pages(scenario, "owner", pages[0], "frozen")
        self.assertEqual(returned, pages)
        self.assertEqual(scenario.queries, [("owner", "history", pages[0]["navigation"]["next"])])

    def test_continuation_cannot_invoke_mutation(self):
        _, pages = population_fixture()
        pages[0]["navigation"]["next"]["operation"] = "freeze-population"
        with self.assertRaisesRegex(RuntimeError, "changed the read operation"):
            read_population_pages(None, "owner", pages[0], "invalid")


if __name__ == "__main__":
    unittest.main()
