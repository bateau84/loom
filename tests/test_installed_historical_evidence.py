"""Counterexamples for historical qualification oracles; not installed-host acceptance."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

from installed_historical_evidence import (
    assert_connected_history,
    assert_evidence_permission_denial, assert_exact_field_envelope,
    assert_history_discovery, assert_history_navigation, assert_history_renderings,
    assert_read_only_effects, encoded, physical_generation_oracle, read_connection_pages, synthetic_transfer,
)
from test_installed_learning_stage4 import driver_plan, driver_receipts


def exported(session, message):
    return {"info": {"id": session}, "messages": [{"id": message, "type": "assistant", "content": [
        {"type": "tool", "id": "native-part", "name": "subagent", "state": {
            "status": "completed", "input": {"prompt": "synthetic"},
            "content": [{"type": "text", "text": "SYNTHETIC_ORIGINAL"}],
            "metadata": {"sessionID": "ses_child"},
        }},
    ]}]}


def storage_fixture(path):
    split, inline = exported("ses_split", "msg_split"), exported("ses_inline", "msg_inline")
    with sqlite3.connect(path) as db:
        db.executescript("""
            CREATE TABLE session_message(id TEXT PRIMARY KEY,session_id TEXT,type TEXT,data TEXT);
            CREATE TABLE session_part(message_id TEXT,session_id TEXT,ordinal INTEGER,data TEXT,
                                      PRIMARY KEY(message_id,ordinal));
        """)
        for value in (split, inline):
            message = value["messages"][0]
            physical = deepcopy(message)
            if value is split:
                physical["content"] = []
            db.execute("INSERT INTO session_message VALUES(?,?,?,?)",
                       (message["id"], value["info"]["id"], "assistant", json.dumps(physical)))
        db.execute("INSERT INTO session_part VALUES(?,?,?,?)",
                   ("msg_split", "ses_split", 0, json.dumps(split["messages"][0]["content"][0])))
    return split, inline


class PhysicalGenerationOracleTest(unittest.TestCase):
    def test_distinct_physical_forms_must_equal_supported_export_and_remain_unchanged(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "native.db"
            split, inline = storage_fixture(path)
            before = path.read_bytes()
            result = physical_generation_oracle(path, split, inline)
            self.assertEqual(result["status"], "PASS")
            self.assertEqual([(item["inline_parts"], item["split_parts"]) for item in result["populations"]], [(0, 1), (1, 0)])
            self.assertEqual(path.read_bytes(), before)

    def test_same_counts_with_changed_content_cannot_qualify(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "native.db"
            split, inline = storage_fixture(path)
            changed = deepcopy(split["messages"][0]["content"][0])
            changed["state"]["content"][0]["text"] = "ADJACENT_OUTPUT_IS_NOT_ORIGINAL"
            with sqlite3.connect(path) as db:
                db.execute("UPDATE session_part SET data=?", (json.dumps(changed),))
            with self.assertRaisesRegex(RuntimeError, "disagree with the supported normalized export"):
                physical_generation_oracle(path, split, inline)

    def test_export_shape_alone_does_not_prove_split_storage(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "native.db"
            split, inline = storage_fixture(path)
            with sqlite3.connect(path) as db:
                db.execute("DELETE FROM session_part")
                db.execute("UPDATE session_message SET data=? WHERE id='msg_split'",
                           (json.dumps(split["messages"][0]),))
            with self.assertRaisesRegex(RuntimeError, "actual split-only storage"):
                physical_generation_oracle(path, split, inline)

    def test_wrong_session_and_mixed_generation_cannot_qualify(self):
        for kind in ("foreign", "mixed"):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as temporary:
                path = Path(temporary) / "native.db"
                split, inline = storage_fixture(path)
                with sqlite3.connect(path) as db:
                    if kind == "foreign":
                        db.execute("UPDATE session_message SET session_id='ses_foreign' WHERE id='msg_inline'")
                    else:
                        db.execute("INSERT INTO session_part VALUES(?,?,?,?)",
                                   ("msg_inline", "ses_inline", 0, json.dumps(inline["messages"][0]["content"][0])))
                with self.assertRaises(RuntimeError):
                    physical_generation_oracle(path, split, inline)


class ReadOnlyEffectOracleTest(unittest.TestCase):
    def receipts(self):
        # Fixture inputs are not native receipts. The installed harness must
        # still obtain and reconcile its own complete passive audit.
        return [event for event in driver_receipts()
                if not (event["type"] == "native-event" and event["data"]["type"] == "session.created")]

    def test_known_reader_requires_the_exact_driver_sequence(self):
        result = assert_read_only_effects(self.receipts(), {"owner"}, driver_plan())
        self.assertEqual(result["evaluator_dispatches"], 0)
        receipts = self.receipts()
        receipts.append(deepcopy(next(event for event in receipts if event["type"] == "model-request")))
        with self.assertRaisesRegex(RuntimeError, "invocation"):
            assert_read_only_effects(receipts, {"owner"}, driver_plan())

    def test_external_recipient_and_evaluator_cannot_hide_in_known_driver_activity(self):
        for changed in ({"sessionID": "historical-owner"}, {"agent": "evaluator"},
                        {"model": {"providerID": "external", "id": "reader"}}):
            with self.subTest(changed=changed):
                receipts = self.receipts()
                next(event for event in receipts if event["type"] == "model-request")["data"].update(changed)
                with self.assertRaisesRegex(RuntimeError, "non-reader or external"):
                    assert_read_only_effects(receipts, {"owner"}, driver_plan())

    def test_native_recipient_activity_and_record_writes_are_rejected(self):
        for added in (
            {"type": "tool-before", "data": {"tool": "subagent"}},
            {"type": "tool-before", "data": {"tool": "loom_record", "input": {"operation": "add"}}},
            {"type": "tool-before", "data": {"tool": "loom_history", "input": {"operation": "freeze"}}},
            {"type": "tool-before", "data": {"tool": "loom.history", "input": {}}},
            {"type": "native-event", "data": {"type": "session.created"}},
            {"type": "native-event", "data": {"type": "session.inbox.enqueued", "data": {"item": {"type": "synthetic"}}}},
            {"type": "provider-inputs", "data": {"notices": ["unexpected resume"]}},
        ):
            with self.subTest(added=added), self.assertRaises(RuntimeError):
                assert_read_only_effects(self.receipts() + [added], {"owner"}, driver_plan())

    def test_only_history_read_is_admitted_to_the_existing_effect_oracle(self):
        for tool in ("loom_history", "loom.history"):
            with self.subTest(tool=tool):
                result = assert_read_only_effects(self.receipts() + [
                    {"type": "tool-before", "data": {"tool": tool, "input": {"operation": "read"}}},
                ], {"owner"}, driver_plan())
                self.assertEqual(result["evaluator_dispatches"], 0)

    def test_synthetic_transfer_does_not_widen_shared_host_access(self):
        for method, path, body in (
            ("GET", "/api/experimental/session/ses_foreign/export?sanitize=false", None),
            ("GET", "/api/session/ses_owned/message", None),
            ("POST", "/api/experimental/session/import", {"info": {"id": "ses_foreign"}}),
        ):
            with self.subTest(path=path), self.assertRaisesRegex(RuntimeError, "unowned transfer"):
                synthetic_transfer(None, {"ses_owned"}, method, path, body)


class SelectiveFieldEnvelopeOracleTest(unittest.TestCase):
    def response(self, fields):
        return {"result": {"format": "loom-native-evidence-source/v1", "session_id": "ses_reader",
            "source": "native-context", "source_sha256": "a" * 64, "messages_sha256": "b" * 64,
            "coverage": {"full_history": False, "authenticity": "native-context", "location_verified": True,
                         "detail": "Synthetic native context"},
            "identity": {"session_id": "ses_reader", "message_id": "msg_exact", "part_id": "part_exact"},
            "status": "resolved", "part": {"part_sha256": "c" * 64}, "fields": deepcopy(fields), "gaps": [],
            "note": "Exact selected projection", "namespace": {"project_id": "project", "workspace_id": None,
                                                                   "native_store_identity": "unavailable"}}}

    def test_complete_dispatch_response_and_explicit_status_are_accepted(self):
        fields = {"dispatch": {"session_id": "ses_child", "source_field": "state.metadata.sessionID"}}
        for selected in (fields, {**fields, "status": "completed"}):
            with self.subTest(fields=selected):
                result = assert_exact_field_envelope(json.dumps(self.response(selected)), selected, "completed")
                self.assertTrue(result["complete_serialized_response_checked"])

    def test_unrequested_metadata_anywhere_outside_fields_is_rejected(self):
        fields = {"dispatch": {"session_id": "ses_child", "source_field": "state.metadata.sessionID"}}
        for target, key, value in (
            ("part", "status", "completed"), ("part", "normalized_part_bytes", 123),
            ("part", "fields", {"output": {"availability": "available", "bytes": 50}}),
            ("result", "normalized_source_bytes", 456), ("coverage", "status", "completed"),
            ("namespace", "status", "completed"), ("outer", "status", "completed"),
            ("fields", "status", "completed"),
        ):
            response = self.response(fields)
            where = response if target == "outer" else response["result"] if target == "result" else response["result"][target]
            where[key] = value
            with self.subTest(target=target, key=key), self.assertRaises(RuntimeError):
                assert_exact_field_envelope(json.dumps(response), fields, "completed")

    def test_approved_original_may_contain_status_text_without_metadata_being_added(self):
        fields = {"output": [{"type": "text", "text": 'Original {"status":"completed"} payload'}]}
        response = self.response(fields)
        self.assertEqual(assert_exact_field_envelope(json.dumps(response), fields, "completed")["selected_fields"], ["output"])
        response["result"]["part"]["status"] = "completed"
        with self.assertRaisesRegex(RuntimeError, "unselected part metadata"):
            assert_exact_field_envelope(json.dumps(response), fields, "completed")


class HistoryNavigationOracleTest(unittest.TestCase):
    def fixture(self):
        # These dictionaries challenge the oracle only. Product qualification
        # must obtain actual views and originals from the installed tools.
        original = {"id": "failure", "action_id": "action", "session_id": "child", "agent": "reviewer",
                    "kind": "result", "created_at": "2026-11-26T00:00:00Z",
                    "data": {"statement": "SYNTHETIC_ORIGINAL_FAILURE: unchanged failure", "evidence_ids": []}}
        source = {"record_id": "failure", "store_id": "store", "session_id": "child",
                  "sha256": hashlib.sha256(encoded(original).encode()).hexdigest(),
                  "query": {"operation": "query", "action_id": "action", "source_session_id": "child", "record_id": "failure"}}
        subject = {"source": source, "branch_ref": "branch", "excerpt": original["data"]["statement"],
                   "meaning": "authored", "verification": "authored claim; not independently verified"}
        overview = {"format": "loom-engineering-history/v1", "scope": {"action_id": "action"}, "store_id": "store",
                    "intended_plan": None, "boundary": {"live": True, "observed_through": 9,
                                                       "membership": "append-bound only; not a frozen retrospective population"},
                    "totals": {"verified_outcomes": None, "native_dispatches": None},
                    "highlights": [subject], "records": [], "branches": [{"ref": "branch"}],
                    "coverage": {"gaps": [{"code": code} for code in
                                          ("ledger-coverage-only", "native-originals-unavailable", "live-not-frozen")]}}
        expanded = deepcopy(overview)
        expanded.update(selected_branch={"ref": "branch"}, records=[deepcopy(subject)])
        return overview, expanded, {"items": [{"sequence": 9, **deepcopy(original)}]}, original

    def test_actual_original_and_scoped_navigation_are_required(self):
        inputs = self.fixture()
        result = assert_history_navigation(*inputs)
        self.assertEqual(result["supported_reads"], 3)
        self.assertFalse(result["preknown_child_or_record_ids_supplied"])
        inputs[2]["items"][0]["data"]["statement"] = "ADJACENT_SUCCESS_IS_NOT_THE_FAILURE"
        with self.assertRaisesRegex(RuntimeError, "exact original"):
            assert_history_navigation(*inputs)

    def test_scope_and_original_permission_downgrades_are_rejected(self):
        for mutation in ("branch", "store", "source-session", "digest", "boundary", "plan"):
            with self.subTest(mutation=mutation):
                overview, expanded, exact, original = self.fixture()
                if mutation == "branch":
                    expanded["selected_branch"]["ref"] = "adjacent"
                elif mutation == "store":
                    expanded["store_id"] = "foreign"
                elif mutation == "source-session":
                    del overview["highlights"][0]["source"]["query"]["source_session_id"]
                elif mutation == "digest":
                    overview["highlights"][0]["source"]["sha256"] = "0" * 64
                elif mutation == "boundary":
                    expanded["boundary"]["observed_through"] = 10
                else:
                    overview["intended_plan"] = {"revision": 1}
                with self.assertRaises(RuntimeError):
                    assert_history_navigation(overview, expanded, exact, original)

    def test_authored_success_and_missing_native_counts_cannot_be_certified(self):
        for key, value in (("verified_outcomes", 1), ("native_dispatches", 4)):
            with self.subTest(key=key):
                inputs = self.fixture()
                inputs[0]["totals"][key] = value
                with self.assertRaisesRegex(RuntimeError, "verified facts"):
                    assert_history_navigation(*inputs)

    def renderings(self, view):
        identity = "\n".join([view["store_id"], view["highlights"][0]["source"]["record_id"],
                               view["highlights"][0]["source"]["sha256"], view["branches"][0]["ref"],
                               *(gap["code"] for gap in view["coverage"]["gaps"])])
        shared = identity + "\nnot a frozen retrospective selection\nauthored claim; not independently verified"
        return ("# Engineering history\n" + shared,
                "<!doctype html><meta content=\"default-src 'none'\"><details><summary>Read</summary>" + shared + "</details>")

    def test_rendering_qualification_rejects_lost_sources_or_active_scripts(self):
        view = self.fixture()[0]
        markdown, html = self.renderings(view)
        self.assertEqual(assert_history_renderings(view, markdown, html)["shared_record_identities"], 1)
        for changed in (html.replace(view["highlights"][0]["source"]["sha256"], "adjacent"),
                        html.replace("native-originals-unavailable", ""), html + "<script>fetch('/source')</script>"):
            with self.subTest(changed=changed), self.assertRaises(RuntimeError):
                assert_history_renderings(view, markdown, changed)


class HistoryDiscoveryOracleTest(unittest.TestCase):
    def discovery_fixture(self):
        overview, expanded, exact, original = HistoryNavigationOracleTest().fixture()
        discovery = deepcopy(overview)
        discovery.update(mode="discovery", selection={"match": "SYNTHETIC_ORIGINAL_FAILURE", "record_kinds": ["result"]},
                         records=deepcopy(discovery["highlights"]))
        discovery["coverage"].update(matching_records=1, matching_branches=1, next_after=None)
        overview.update(mode="overview", highlights=[], branches=[])
        overview["coverage"]["branches_omitted"] = 24
        expanded.update(mode="branch", ancestors=[{"kind": "session", "ref": "parent"}], branches=[])
        return overview, discovery, expanded, exact, original

    def test_hidden_original_requires_actual_selective_discovery_and_ancestry(self):
        result = assert_history_discovery(*self.discovery_fixture())
        self.assertTrue(result["target_absent_from_overview"])
        self.assertFalse(result["preknown_child_or_record_ids_supplied"])
        self.assertEqual(result["supported_reads"], 4)

    def test_favorable_overview_or_incorrect_match_cannot_pass_discovery(self):
        for mutation in ("visible", "wrong-match", "no-ancestry", "unrelated-context", "wrong-original", "wrong-boundary"):
            with self.subTest(mutation=mutation):
                overview, discovery, expanded, exact, original = self.discovery_fixture()
                if mutation == "visible":
                    overview["highlights"] = deepcopy(discovery["records"])
                elif mutation == "wrong-match":
                    discovery["records"][0]["source"]["record_id"] = "adjacent"
                elif mutation == "no-ancestry":
                    expanded["ancestors"] = []
                elif mutation == "unrelated-context":
                    expanded["intended_plan"] = {"revision": 2}
                elif mutation == "wrong-original":
                    exact["items"][0]["data"]["statement"] = "adjacent success"
                else:
                    discovery["boundary"]["observed_through"] = 10
                with self.assertRaises(RuntimeError):
                    assert_history_discovery(overview, discovery, expanded, exact, original)


class HistoryPermissionDenialOracleTest(unittest.TestCase):
    resource = "loom:evidence:inspect:session:nonmatching:view:engineering-history"

    def receipt(self):
        # Pinned native execute.after shape: input repeats caller arguments;
        # error/result are returned surfaces, including nested diagnostics.
        return {"tool": "loom_history", "sessionID": "reader", "id": "call", "messageID": "message",
                "input": {"operation": "read", "action_id": "action", "match": "FROST_47",
                          "record_kinds": ["concern"], "response_format": "json"},
                "status": "error", "error": {"_tag": "Tool.Error", "message": "Permission denied: read",
                    "error": {"_tag": "Permission.BlockedError", "permission": "read",
                              "resources": [self.resource],
                              "rules": [{"action": "read", "resource": self.resource, "effect": "deny"}]}}}

    def test_caller_filter_echo_does_not_become_a_source_disclosure(self):
        for response_format in ("json", "markdown", "html"):
            with self.subTest(response_format=response_format):
                denial = self.receipt()
                denial["input"]["response_format"] = response_format
                assert_evidence_permission_denial(denial, self.resource, ["FROST_47", "hidden-record-id"])

    def test_returned_content_and_nested_error_diagnostics_are_checked(self):
        for location in ("result-text", "result-metadata", "result-nested-input", "error-message", "error-details"):
            with self.subTest(location=location):
                denial = self.receipt()
                if location == "result-text":
                    denial["result"] = {"content": "hidden-record-id"}
                elif location == "result-metadata":
                    denial["result"] = {"metadata": {"source": "hidden-record-id"}}
                elif location == "result-nested-input":
                    denial["result"] = {"metadata": {"input": {"match": "FROST_47"}}}
                elif location == "error-message":
                    denial["error"]["message"] += " FROST_47"
                else:
                    denial["error"]["error"]["detail"] = {"source": "hidden-record-id"}
                with self.assertRaisesRegex(RuntimeError, "disclosed protected source content"):
                    assert_evidence_permission_denial(denial, self.resource, ["FROST_47", "hidden-record-id"])

    def test_success_or_an_unrelated_error_cannot_establish_the_resource_denial(self):
        for mutation in ("completed", "unrelated-error", "wrong-resource", "missing-deny-rule", "allowed-rule"):
            with self.subTest(mutation=mutation):
                denial = self.receipt()
                blocked = denial["error"]["error"]
                if mutation == "completed":
                    denial["status"] = "completed"
                elif mutation == "unrelated-error":
                    blocked["_tag"] = "ProcessingLimitError"
                elif mutation == "wrong-resource":
                    blocked["resources"] = ["loom:evidence:inspect:session:other:view:engineering-history"]
                elif mutation == "missing-deny-rule":
                    blocked["rules"] = []
                else:
                    blocked["rules"][0]["effect"] = "allow"
                with self.assertRaisesRegex(RuntimeError, "expected read resource"):
                    assert_evidence_permission_denial(denial, self.resource, ["FROST_47", "hidden-record-id"])


class ConnectionPageTraversalTest(unittest.TestCase):
    def test_owner_traversals_retain_independent_receipts_when_the_final_chain_is_empty(self):
        base = {"action_id": "action", "record_id": "finding", "related": True, "limit": 5,
                "through": 42, "owner_boundary": {"review_requests": 7}, "owner_version": "b" * 64}
        first_query = {**base, "connection_cursor": "owner-first"}
        second_query = {**base, "connection_cursor": "owner-second"}
        first = {"navigation": {"repeat": first_query, "next_connections": second_query}}
        terminal = {"navigation": {"repeat": second_query, "next_connections": None}}
        origins = {"connected": {"navigation": {"next_connections": first_query}}, "first_page": first,
                   "continuation": terminal}
        before = deepcopy(origins)
        calls = []

        class Scenario:
            def read(self, reader, tool, query, label):
                calls.append((reader, tool, deepcopy(query), label))
                return deepcopy({"owner-first": first, "owner-second": terminal}[query["connection_cursor"]])

        owner_pages = {label: read_connection_pages(Scenario(), "reader", origin, label)
                       for label, origin in origins.items()}
        self.assertEqual(owner_pages, {"connected": [first, terminal], "first_page": [terminal], "continuation": []})
        self.assertEqual(calls, [
            ("reader", "history", {"operation": "read", **first_query}, "connected-history-owner-connected-1"),
            ("reader", "history", {"operation": "read", **second_query}, "connected-history-owner-connected-2"),
            ("reader", "history", {"operation": "read", **second_query}, "connected-history-owner-first_page-1"),
        ])
        self.assertEqual(origins, before)

    def test_unterminated_owner_chain_keeps_the_existing_bounded_failure(self):
        calls = []
        origin = {"navigation": {"next_connections": {"connection_cursor": "loop"}}}

        class Scenario:
            def read(self, *args):
                calls.append(args)
                return origin

        with self.assertRaisesRegex(RuntimeError, "did not terminate within its known population"):
            read_connection_pages(Scenario(), "reader", origin, "connected")
        self.assertEqual(len(calls), 8)


class ConnectedHistoryOracleTest(unittest.TestCase):
    def fixture(self):
        # Oracle counterexamples only. The installed gate obtains every source,
        # relationship and rendered view from the actual registered tools.
        names = ("finding", "diagnosis", "rerun", "correction", "assessment", "merge", "release")
        originals = {name: {"id": name, "action_id": "connected", "session_id": "owner", "agent": "general",
            "data": {"statement": name + " scoped authored claim", **({"verdict": "pass"} if name == "assessment" else {})}}
            for name in names}
        boundary = {"objective_links": 8, "review_requests": 7, "review_relationships": 3}
        query = {"action_id": "connected", "record_id": "finding", "related": True, "through": 8, "limit": 20,
                 "owner_boundary": boundary, "owner_version": "b" * 64}
        records = [{"ref": "loom-record:store:" + name, "work_ref": None, "meaning": "authored",
            "verification": "authored claim; not independently verified", "excerpt": original["data"]["statement"],
            "source": {"record_id": name, "sha256": hashlib.sha256(encoded(original).encode()).hexdigest(),
                "query": {"operation": "query", "action_id": "connected", "source_session_id": "owner", "record_id": name}},
            "trajectory": {**query, "record_id": name}} for name, original in originals.items()]
        reviews = [{"request_id": name, "mandate": {"question": name, "exclusions": ["complete issue 182 release acceptance"]},
            "members": [{"member_id": name + "-member", "work_ref": None, "artifact_refs": [{"locator": "fixture:" + name}],
                         "prior_review_request_id": "initial" if name == "scoped" else None}],
            "rechecks": [{"request_id": "initial", "finding_ids": ["correction-link"]}] if name == "scoped" else []}
            for name in ("initial", "scoped")]
        for index in range(5):
            name = "pending-" + str(index)
            reviews.append({"request_id": name, "mandate": {"question": "Pending exact prior review comparison",
                "exclusions": ["complete issue 182 release acceptance"]}, "rechecks": [],
                "members": [{"member_id": name + "-member", "work_ref": None, "artifact_refs": [],
                             "producing_attempt_refs": [], "membership_source_refs": [], "prior_review_request_id": "scoped"}]})
        fixture = {"records": originals, "action": {"id": "connected"}, "objective": {"id": "objective"},
                   "reviews": reviews, "requester": "owner", "correction_relationship": "correction-link",
                   "review_relationships": {kind: {"status": "created", "id": kind + "-link"}
                                            for kind in ("finding", "correction", "claimed-inspected")}}
        basis = []
        for index, (kind, source, request_id) in enumerate((("finding", "finding", "initial"),
                ("correction", "correction", "initial"), ("claimed-inspected", "assessment", "scoped")), 1):
            basis.append({"format": "loom-review-relationship/v1", "id": kind + "-link", "request_id": request_id,
                "relationship": kind, "source_record_id": source, "member_ids": [request_id + "-member"],
                "author": {"session_id": "owner", "agent": "general"}, "source_producer": {"session_id": "owner", "agent": "general"},
                "relationship_attribution": {"status": "unknown", "reason": "authored-association-unverified"},
                "review_binding": {"status": "unknown", "reason": "unsupported-host-boundary"},
                "sequence": index, "source_availability": "record-available",
                **({"supersedes": "finding-link"} if kind == "correction" else {}),
                **({"declared_verdict": "pass", "verdict_scope": "authored; not proof of whole-request coverage"}
                   if kind == "claimed-inspected" else {})})
        groups = [{"ref": "loom-review:store:" + review["request_id"],
            "request": {**deepcopy(review), "requester": {"session_id": "owner"}}, "frozen_work_membership": [],
            "relationships_omitted": 0, "relationships": deepcopy([item for item in basis if item["request_id"] == review["request_id"]]),
            "qualification": {"native_review_binding": {"status": "unknown"}},
            "details": {**deepcopy(query), "connection_cursor": "detail-" + review["request_id"]},
            "source": {"tool": "loom_review", "sha256": "source-" + review["request_id"],
                       "query": {"operation": "read", "request_id": review["request_id"]}}} for review in reviews]
        edges = [{"kind": kind, "from": "loom-record:store:" + source, "to": "loom-record:store:" + target,
            "meaning": "authored", "provenance": {"author_session": "owner"}} for kind, source, target in
            (("addresses", "correction", "finding"), ("assesses", "assessment", "correction"))]
        edges.append({"kind": "requested-recheck-target", "source_record_id": "correction", "provenance": {"id": "correction-link"}})
        for review in reviews[1:]:
            member = review["members"][0]
            edges.append({"kind": "requested-prior-review", "from": "loom-review:store:" + review["request_id"],
                "to": "loom-review:store:" + member["prior_review_request_id"], "meaning": "authored", "source_record_id": None,
                "provenance": {"owner": "review", "id": review["request_id"] + ":" + member["member_id"],
                               "author_session": "owner", "author_agent": "general"}})
        connected = {"format": "loom-engineering-history/v1", "mode": "trajectory", "scope": {"action_id": "connected"},
            "store_id": "store", "intended_plan": None, "totals": {"verified_outcomes": None, "native_dispatches": None},
            "highlights": [], "branches": [], "records": records, "navigation": {"repeat": query}, "relationships": edges,
            "boundary": {"observed_through": 8, "owners": deepcopy(boundary), "owner_version": "b" * 64},
            "coverage": {"gaps": [{"code": "live-not-frozen"}]}, "connections": {"reviews": deepcopy(groups[:5]),
                "coverage": {"page": "summary", "reviews_omitted": 2},
                "objectives": [{"objective": {"id": "objective"}, "links_omitted": 0,
                    "links": [{"source_id": "diagnosis", "confidence": "uncertain"}]}]}}
        first = deepcopy(connected)
        next_request = {**query, "limit": 5, "after": 5}
        first.update(records=deepcopy(records[:5]), navigation={"repeat": {**query, "limit": 5}, "next_records": next_request})
        continuation = deepcopy(connected)
        continuation.update(records=deepcopy(records[5:]), navigation={"repeat": next_request, "next_records": None})
        continuation["connections"].update(reviews=[], coverage={"page": "summary", "reviews_omitted": 0})
        owner_continuations = {"continuation": []}
        for label, root in (("connected", connected), ("first_page", first)):
            request = {**deepcopy(root["navigation"]["repeat"]), "connection_cursor": "groups-" + label}
            root["navigation"]["next_connections"] = request
            page = deepcopy(root)
            page.update(mode="connections", records=[], highlights=[], branches=[], relationships=[],
                        navigation={"repeat": deepcopy(request), "next_connections": None})
            page["connections"] = {"reviews": deepcopy(groups[5:]), "objectives": [],
                "coverage": {"page": "groups", "reviews_omitted": 0},
                "context": {"record_refs": [item["ref"] for item in root["records"]], "read": deepcopy(root["navigation"]["repeat"])}}
            owner_continuations[label] = [page]
        discovery = {"mode": "discovery", "selection": {"match": "CEDAR_187"}, "records": [deepcopy(records[0])]}
        identity = "\n".join(["store", "live-not-frozen", "not a frozen retrospective selection",
            "authored claim; not independently verified", *(review["request_id"] for review in reviews[:5]),
            "complete issue 182 release acceptance",
            *(record["source"]["record_id"] for record in records), *(record["source"]["sha256"] for record in records)])
        requests = [{"operation": "read", **item} for item in (first["navigation"]["repeat"], next_request,
                    first["navigation"]["next_connections"], *(record["trajectory"] for record in first["records"]),
                    *(group["details"] for group in first["connections"]["reviews"]))]
        requests.append(deepcopy(basis))
        markdown = "# Engineering history\n" + identity + "\n\n" + "\n".join(
            "\n".join("    " + line for line in json.dumps(item, indent=2).splitlines()) + "\n" for item in requests)
        html = "<!doctype html><meta content=\"default-src 'none'\"><details><summary>Read</summary>" + identity + "".join(
            "<pre><code>" + json.dumps(item) + "</code></pre>" for item in requests) + "</details>"
        owner_page = owner_continuations["connected"][0]
        owner_requests = [{"operation": "read", **item} for item in (owner_page["navigation"]["repeat"],
            owner_page["connections"]["context"]["read"], *(group["details"] for group in owner_page["connections"]["reviews"]))]
        owner_identity = "\n".join(["not a frozen retrospective selection", "complete issue 182 release acceptance",
            *owner_page["connections"]["context"]["record_refs"], *(value for group in owner_page["connections"]["reviews"]
                for value in (group["request"]["request_id"], group["ref"], group["source"]["sha256"]))])
        owner_continuations["markdown"] = "# Engineering history\n" + owner_identity + "\n\n" + "\n".join(
            "\n".join("    " + line for line in json.dumps(item, indent=2).splitlines()) + "\n" for item in owner_requests)
        owner_continuations["html"] = "<!doctype html><meta content=\"default-src 'none'\"><details><summary>Read</summary>" + owner_identity + "".join(
            "<pre><code>" + json.dumps(item) + "</code></pre>" for item in owner_requests) + "</details>"
        return [discovery, connected, first, continuation, markdown, html, fixture, owner_continuations]

    def test_owner_backed_scope_and_preserved_continuation_are_required(self):
        result = assert_connected_history(*self.fixture())
        self.assertEqual(result["selected_records"], 7)
        self.assertEqual(result["review_requests"], 7)
        self.assertEqual(result["review_relationships"], 3)
        self.assertEqual(result["pending_prior_review_requests"], 5)
        self.assertEqual(result["owner_continuation_pages"], 2)
        self.assertEqual(result["native_review_binding"], "unknown")
        self.assertTrue(result["ready_continuation_preserved"])

    def test_wrong_selection_fabricated_work_and_claim_promotion_cannot_qualify(self):
        for mutation in ("unrelated", "changed-original", "source-permission", "plan", "workref", "certified", "typed-target", "candidate"):
            inputs = self.fixture()
            view = inputs[1]
            if mutation == "unrelated":
                view["records"][0]["source"]["record_id"] = "unrelated"
            elif mutation == "changed-original":
                view["records"][0]["excerpt"] = "different claim"
            elif mutation == "source-permission":
                del view["records"][0]["source"]["query"]["source_session_id"]
            elif mutation == "plan":
                view["intended_plan"] = {"revision": 1}
            elif mutation == "workref":
                view["records"][0]["work_ref"] = {"action_id": "invented"}
            elif mutation == "certified":
                view["totals"]["verified_outcomes"] = 1
            elif mutation == "typed-target":
                view["relationships"][0]["to"] = "adjacent"
            else:
                view["connections"]["objectives"][0]["links"][0]["confidence"] = "supported"
            with self.subTest(mutation=mutation), self.assertRaises(RuntimeError):
                assert_connected_history(*inputs)

    def test_review_scope_recheck_and_native_binding_cannot_be_widened(self):
        for mutation in ("exclusion", "recheck", "requester", "native-binding", "membership", "omitted"):
            inputs = self.fixture()
            review = inputs[1]["connections"]["reviews"][1]
            if mutation == "exclusion":
                review["request"]["mandate"]["exclusions"] = []
            elif mutation == "recheck":
                review["request"]["rechecks"][0]["finding_ids"] = ["adjacent"]
            elif mutation == "requester":
                review["request"]["requester"]["session_id"] = "foreign"
            elif mutation == "native-binding":
                review["relationships"][0]["review_binding"]["status"] = "established"
            elif mutation == "membership":
                review["frozen_work_membership"] = [{"invented": True}]
            else:
                review["relationships_omitted"] = 1
            with self.subTest(mutation=mutation), self.assertRaises(RuntimeError):
                assert_connected_history(*inputs)

    def test_registered_review_basis_cannot_be_removed_or_replaced(self):
        for mutation in ("removed-basis", "removed-page-basis", "duplicate", "id", "kind", "source", "member",
                         "supersedes", "author", "producer", "attribution", "verdict", "sequence", "availability"):
            inputs = self.fixture()
            groups = inputs[1]["connections"]["reviews"]
            relation = groups[0]["relationships"][1]
            if mutation == "removed-basis":
                for group in groups:
                    group["relationships"] = []
            elif mutation == "removed-page-basis":
                inputs[2]["connections"]["reviews"][1]["relationships"] = []
            elif mutation == "duplicate":
                groups[0]["relationships"].append(deepcopy(relation))
            elif mutation == "id":
                relation["id"] = "adjacent-link"
            elif mutation == "kind":
                relation["relationship"] = "observed"
            elif mutation == "source":
                relation["source_record_id"] = "rerun"
            elif mutation == "member":
                relation["member_ids"] = ["scoped-member"]
            elif mutation == "supersedes":
                relation["supersedes"] = "adjacent-link"
            elif mutation == "author":
                relation["author"]["session_id"] = "foreign"
            elif mutation == "producer":
                relation["source_producer"]["agent"] = "foreign"
            elif mutation == "attribution":
                relation["relationship_attribution"] = {"status": "established", "basis": "original-source-return"}
            elif mutation == "verdict":
                groups[1]["relationships"][0]["declared_verdict"] = "fail"
            elif mutation == "sequence":
                relation["sequence"] = None
            else:
                relation["source_availability"] = "source-missing"
            with self.subTest(mutation=mutation), self.assertRaisesRegex(RuntimeError, "evidence"):
                assert_connected_history(*inputs)

    def test_document_and_dashboard_must_retain_registered_review_basis(self):
        for index in (4, 5):
            inputs = self.fixture()
            inputs[index] = inputs[index].replace("loom-review-relationship/v1", "removed-basis")
            with self.subTest(format=index), self.assertRaisesRegex(RuntimeError, "registered review evidence basis"):
                assert_connected_history(*inputs)

    def test_scope_loss_in_continuation_or_copyable_rendering_is_rejected(self):
        for mutation in ("seed", "boundary", "duplicate", "html-request", "markdown-request"):
            inputs = self.fixture()
            if mutation == "seed":
                inputs[3]["navigation"]["repeat"]["record_id"] = "adjacent"
            elif mutation == "boundary":
                inputs[3]["navigation"]["repeat"]["owner_boundary"] = {}
            elif mutation == "duplicate":
                inputs[3]["records"].append(deepcopy(inputs[2]["records"][0]))
            elif mutation == "html-request":
                inputs[5] = inputs[5].replace('"related": true', '"related": false')
            else:
                inputs[4] = inputs[4].replace('"related": true', '"related": false')
            with self.subTest(mutation=mutation), self.assertRaises(RuntimeError):
                assert_connected_history(*inputs)

    def test_pending_prior_review_is_exact_requested_scope_without_invented_evidence(self):
        for mutation in ("missing-dependency", "wrong-prior", "observed-dependency", "recheck", "inspection", "membership"):
            inputs = self.fixture()
            pending = inputs[7]["connected"][0]["connections"]["reviews"][0]
            edge = inputs[1]["relationships"][-2]
            if mutation == "missing-dependency":
                inputs[1]["relationships"].remove(edge)
            elif mutation == "wrong-prior":
                edge["to"] = "loom-review:store:initial"
            elif mutation == "observed-dependency":
                edge["meaning"] = "observed"
            elif mutation == "recheck":
                inputs[1]["relationships"].append({"kind": "requested-recheck", "from": pending["ref"],
                                                    "to": "loom-review:store:scoped"})
            elif mutation == "inspection":
                pending["relationships"] = [deepcopy(inputs[1]["connections"]["reviews"][1]["relationships"][0])]
            else:
                pending["frozen_work_membership"] = [{"invented": True}]
            with self.subTest(mutation=mutation), self.assertRaises(RuntimeError):
                assert_connected_history(*inputs)

    def test_owner_continuation_cannot_drop_scope_membership_or_terminal_evidence(self):
        for mutation in ("absent", "cursor", "selector", "scope", "context", "boundary", "body", "duplicate", "missing", "count", "terminal"):
            inputs = self.fixture()
            page = inputs[7]["connected"][0]
            if mutation == "absent":
                inputs[7]["connected"] = []
            elif mutation == "cursor":
                page["navigation"]["repeat"]["connection_cursor"] = "unrelated"
            elif mutation == "selector":
                del page["navigation"]["repeat"]["owner_version"]
            elif mutation == "scope":
                page["scope"] = {"session_id": "foreign"}
            elif mutation == "context":
                page["connections"]["context"]["record_refs"] = ["loom-record:store:unrelated"]
            elif mutation == "boundary":
                page["boundary"]["owners"]["review_requests"] = 8
            elif mutation == "body":
                page["records"] = [deepcopy(inputs[1]["records"][0])]
            elif mutation == "duplicate":
                page["connections"]["reviews"].append(deepcopy(page["connections"]["reviews"][0]))
            elif mutation == "missing":
                page["connections"]["reviews"].pop()
            elif mutation == "count":
                page["connections"]["coverage"]["reviews_omitted"] = 1
            else:
                page["navigation"]["next_connections"] = {**page["navigation"]["repeat"], "connection_cursor": "unread-next"}
            with self.subTest(mutation=mutation), self.assertRaises(RuntimeError):
                assert_connected_history(*inputs)

    def test_owner_rendering_must_preserve_ready_context_without_source_repetition(self):
        for format_name in ("markdown", "html"):
            for mutation in ("cursor", "context", "source", "body", "overview"):
                inputs = self.fixture()
                rendered = inputs[7][format_name]
                if mutation == "cursor":
                    rendered = rendered.replace("groups-connected", "changed-cursor")
                elif mutation == "context":
                    rendered = rendered.replace('"related": true', '"related": false')
                elif mutation == "source":
                    rendered = rendered.replace("source-pending-3", "different-source")
                elif mutation == "body":
                    rendered += inputs[6]["records"]["correction"]["data"]["statement"]
                else:
                    rendered += "Significant recorded work"
                inputs[7][format_name] = rendered
                with self.subTest(format=format_name, mutation=mutation), self.assertRaises(RuntimeError):
                    assert_connected_history(*inputs)


if __name__ == "__main__":
    unittest.main()
