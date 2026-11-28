"""Stopped-state S5 descriptor regressions, not a provider/reasoning fixture.

These tests isolate the publication validator after the existing frozen
population/preparation/execution validators. The native companion exercises
the full producer and backup/restore path with actual EvaluationStore rows.
"""
from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import sqlite3
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "tools" / "learning-state-backup.py"
spec = importlib.util.spec_from_file_location("interpretation_backup", SCRIPT)
backup_tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup_tool)


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def fingerprint(value):
    return backup_tool.sha_text(canonical(value))


QUALIFICATIONS = ["Machine-validated publication; reasoning quality and review independence are not established."]


class InterpretationBackupTest(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.addCleanup(self.db.close)
        for table, columns in {**backup_tool.EVALUATION_COLUMNS, **backup_tool.EXECUTION_COLUMNS}.items():
            self.db.execute('CREATE TABLE "' + table + '" (' + ",".join('"' + name + '"' for name in sorted(columns)) + ")")
        self.prepared = {}

    def validate(self):
        backup_tool.retrospective_interpretation_integrity(self.db, self.prepared, True)

    def record(self, table, values):
        self.db.execute("INSERT INTO " + table + " (" + ",".join(values) + ") VALUES (" + ",".join("?" for _ in values) + ")", tuple(values.values()))

    def publication(self, name="first", prior=None, objective="selected-objective", original_text=None, originals=None, source_prefix=None):
        members = {}
        selected = source_prefix or name
        for ordinal, available in enumerate((True, False) if originals is None else [True] * originals, 1):
            source = {"kind": "ledger-record", "id": selected + "-source-" + str(ordinal), "session_id": "contributor",
                      "revision": "1", "sha256": fingerprint(selected + str(ordinal)), "required": True}
            namespace, view = "namespace", "record-full"
            if originals is not None:
                source["kind"] = "external-ref"
                source["id"] = "https://github.com/fixture/evidence/blob/" + "a" * 40 + "/" + selected + "-" + str(ordinal)
                del source["session_id"]
                namespace, view = "github-controlled-owner", "github-original/v1"
            key = "source-" + fingerprint({"source_store_id": namespace, "source": {k: v for k, v in source.items() if k != "required"},
                                           "permitted_view": view})
            members[key] = {"key": key, "source": source, "source_store_id": namespace, "permitted_view": view,
                            "availability": "available" if available else "missing"}
        first = next(iter(members))
        interpretation = {
            "format": "loom-evaluator-interpretation/v1", "covered_members": list(members),
            "conclusion": {"kind": "no-change", "statement": "Retain the observed bounded validation practice.", "limitations": ["Fixture mechanics only."]},
            "trajectory": [{"event_id": "event-1", "statement": "A bounded validation result was recorded.", "members": [first],
                            "supporting": [{"member_key": first, "source_index": 0}], "limitations": []}],
            "claims": [{"claim_id": "practice", "kind": "observed", "category": "successful-practice", "basis": "supported",
                        "statement": "The result records a focused verification step.", "members": [first],
                        "supporting": [{"member_key": first, "source_index": 0}], "contradicting": [], "limitations": [],
                        "applicability": ["The selected frozen objective."], "recommendation": None}],
            "review_coverage": [], "gaps": [{"member_key": key,
                "kind": "unavailable" if member["availability"] == "missing" else "not-retrieved",
                "reason": "The frozen source was missing or not retrieved."} for key, member in members.items() if key != first],
            "qualifications": {"chronology": [], "independence": "unknown"},
            "prior_interpretations": [] if prior is None else [{"report_id": prior["id"], "report_sha256": prior["sha256"],
                "relation": "contests", "reason": "Later evidence limits the earlier conclusion."}],
        }
        batch_id = "batch-" + name
        population = {"owner": "owner", "namespace": "namespace", "manifest_sha256": fingerprint(name), "objective_id": objective,
                      "members": [(key, canonical([member["source"]])) for key, member in members.items()], "manifest_members": members}
        self.prepared[batch_id] = {"population": population}
        subject = {"source_store_id": "namespace", "owner_session": "owner", "batch_id": batch_id, "request_id": "request-" + name,
                   "attempt_id": "attempt-" + name, "manifest_sha256": fingerprint("manifest-" + name), "semantic_key": fingerprint("enrollment-" + name),
                   "source": {"kind": "retrospective-population", "format": "loom-retrospective-population/v1",
                              "population_id": "population-" + name, "manifest_sha256": fingerprint(name)}}
        method = {"format": "loom-evaluator-method/v1", "fixture": "already-validated-method"}
        admission = {"format": "loom-evaluation-admission/v1", "grant": {"subject": subject, "method": method,
                     "limits": {"requests": 1, "input_tokens": 10, "output_tokens": 10}},
                     "reservation_id": "reservation-" + name, "pool_id": "fixture-pool", "authority_epoch": "1"}
        admission_sha = fingerprint(admission)
        raw = original_text(interpretation) if original_text else canonical(interpretation)
        result = {"host_id": "fixture-host", "session_id": "fixture-evaluator", "input_id": "input-" + name,
                  "result_id": "result-" + name, "sha256": backup_tool.sha_text(raw)}
        receipt = {"format": "loom-evaluation-execution-receipt/v1", "sequence": 1, "execution": "completed", "budget": "settled",
                   "fenced": True, "usage": {"requests": 1, "input_tokens": 1, "output_tokens": 1}, "result": result}
        body = {"format": "loom-evaluator-publication/v1", "binding": {"subject": subject, "admission_sha256": admission_sha,
                "method_sha256": fingerprint(method), "result": result}, "original_result_text": raw,
                "retrieved": [{"member_key": first, "source_index": 0, "receipt_id": "retrieval-" + name,
                               "boundary": "native-tool-result", "source_sha256": members[first]["source"]["sha256"]}],
                "interpretation": interpretation}
        report_id = "interpretation-" + fingerprint({"format": "loom-evaluator-report-id/v1", "admission_sha256": admission_sha, "result": result})
        refs = [member["source"] for member in members.values()]
        if prior:
            refs.extend(prior["refs"])
        refs = list(backup_tool.interpretation_source_refs([canonical(ref) for ref in refs]).values())

        def write(report_id, member_key, value):
            dependencies = refs if member_key is None else [canonical(members[member_key]["source"])]
            checksum = fingerprint({"batch_id": batch_id, "member_key": member_key, "body": value, "qualifications": QUALIFICATIONS,
                                    "source_refs": [json.loads(ref) for ref in dependencies]})
            self.record("learning_evaluation_reports", {"id": report_id, "batch_id": batch_id, "member_key": member_key,
                "slot": "overall" if member_key is None else "member:" + member_key, "body_json": canonical(value),
                "qualifications_json": canonical(QUALIFICATIONS), "sha256": checksum})
            for ref in dependencies:
                key = next(iter(backup_tool.interpretation_source_refs([ref])))
                self.record("learning_evaluation_dependencies", {"report_id": report_id, "source_key": key, "source_ref": ref})
            return checksum

        checksum = write(report_id, None, body)
        self.record("learning_evaluation_batches", {"id": batch_id, "state": "complete", "scope_key": "evaluator-preparation/retrospective", "report_id": report_id})
        for ordinal, key in enumerate(members, 1):
            checkpoint_id = "interpretation-member-" + fingerprint({"format": "loom-evaluator-member-id/v1", "report_id": report_id, "member_key": key})
            write(checkpoint_id, key, {"format": "loom-evaluator-member/v1", "report_id": report_id, "report_sha256": checksum, "member_key": key})
            self.record("learning_evaluation_members", {"batch_id": batch_id, "key": key, "ordinal": ordinal, "report_id": checkpoint_id})
        self.record("learning_execution_admissions", {"batch_id": batch_id, "data_json": canonical(admission), "sha256": admission_sha})
        self.record("learning_execution_receipts", {"batch_id": batch_id, "sequence": 1, "data_json": canonical(receipt)})
        if prior:
            self.record("learning_evaluation_invalidations", {"batch_id": prior["batch_id"], "source_key": report_id, "reason": "interpretation-contests"})
        return {"id": report_id, "sha256": checksum, "batch_id": batch_id, "body": body, "members": members, "refs": [json.loads(ref) for ref in refs]}

    def rehash(self, publication, change=None, rebind_checkpoints=True):
        """Recompute report/checkpoint hashes as a corrupt backup could do."""
        if change:
            body = deepcopy(publication["body"])
            change(body)
            self.db.execute("UPDATE learning_evaluation_reports SET body_json=? WHERE id=?", (canonical(body), publication["id"]))
        rows = self.db.execute("SELECT id,member_key,body_json FROM learning_evaluation_reports WHERE batch_id=? ORDER BY slot", (publication["batch_id"],)).fetchall()
        rows.sort(key=lambda row: row[1] is not None)
        overall_sha = None
        for report_id, member_key, text in rows:
            body = json.loads(text)
            if member_key is not None and rebind_checkpoints:
                body["report_sha256"] = overall_sha
            refs = [json.loads(row[0]) for row in self.db.execute("SELECT source_ref FROM learning_evaluation_dependencies WHERE report_id=? ORDER BY source_key", (report_id,))]
            checksum = fingerprint({"batch_id": publication["batch_id"], "member_key": member_key, "body": body,
                                    "qualifications": QUALIFICATIONS, "source_refs": refs})
            self.db.execute("UPDATE learning_evaluation_reports SET body_json=?,sha256=? WHERE id=?", (canonical(body), checksum, report_id))
            if member_key is None:
                overall_sha = checksum

    def test_accepts_exact_native_result_bytes_without_live_source_lookup(self):
        self.publication(original_text=lambda value: json.dumps(value, indent=2, ensure_ascii=False))
        self.validate()

    def test_accepts_the_full_1728_original_revision_union(self):
        first = self.publication("first", originals=900)
        self.publication("second", prior=first, originals=828)
        self.validate()

    def test_rejects_a_1729_original_revision_union_even_with_valid_report_checksums(self):
        first = self.publication("first", originals=900)
        self.publication("second", prior=first, originals=829)
        with self.assertRaisesRegex(ValueError, "exceeds 1728 unique pinned"):
            self.validate()

    def test_deduplicates_exact_originals_in_overlapping_revision_populations(self):
        first = self.publication("first", originals=900, source_prefix="shared")
        self.publication("second", prior=first, originals=900, source_prefix="shared")
        self.validate()

    def test_rejects_boolean_result_index_as_equivalent_to_numeric_interpretation_index(self):
        self.publication(original_text=lambda value: canonical(value).replace('"source_index":0', '"source_index":false'))
        with self.assertRaisesRegex(ValueError, "differs from original execution result"):
            self.validate()

    def test_accepts_equivalent_json_number_notation_in_original_result(self):
        self.publication(original_text=lambda value: canonical(value).replace('"source_index":0', '"source_index":0.0'))
        self.validate()

    def test_json_equivalence_preserves_nested_types_and_array_order(self):
        self.assertFalse(backup_tool.interpretation_json_equal({"nested": [False]}, {"nested": [0]}))
        self.assertFalse(backup_tool.interpretation_json_equal({"nested": [1]}, {"nested": [True]}))
        self.assertFalse(backup_tool.interpretation_json_equal([0, 1], [1, 0]))
        self.assertTrue(backup_tool.interpretation_json_equal({"nested": [0, 1.0, None, True]}, {"nested": [0.0, 1, None, True]}))

    def test_legacy_report_prose_does_not_become_an_s5_marker(self):
        self.record("learning_evaluation_reports", {"id": "legacy-report", "batch_id": "legacy-batch",
            "body_json": canonical({"observations": {"label": "loom-evaluator-publication/v1"}})})
        self.validate()

    def test_rejects_rehashed_interpretation_substitution(self):
        publication = self.publication()
        self.rehash(publication, lambda body: body["interpretation"]["claims"][0].update(statement="Substituted conclusion"))
        with self.assertRaisesRegex(ValueError, "differs from original"):
            self.validate()

    def test_rejects_rehashed_original_bytes_substitution(self):
        publication = self.publication()
        self.rehash(publication, lambda body: body.update(original_result_text=body["original_result_text"] + " "))
        with self.assertRaisesRegex(ValueError, "original result bytes"):
            self.validate()

    def test_rejects_changed_binding_even_with_new_report_checksum(self):
        for field in ("admission_sha256", "method_sha256", "subject", "result"):
            with self.subTest(field=field):
                self.setUp()
                publication = self.publication()
                def change(body):
                    if field in ("subject", "result"):
                        body["binding"][field]["request_id" if field == "subject" else "input_id"] = "substituted"
                    else:
                        body["binding"][field] = "f" * 64
                self.rehash(publication, change)
                with self.assertRaisesRegex(ValueError, "mismatch"):
                    self.validate()

    def test_rejects_unsupported_publication_format(self):
        publication = self.publication()
        self.rehash(publication, lambda body: body.update(format="loom-evaluator-publication/v2"))
        with self.assertRaisesRegex(ValueError, "Unsupported interpretation publication"):
            self.validate()

    def test_rejects_omitted_uncited_dependency_after_rehash(self):
        publication = self.publication()
        missing_id = next(member["source"]["id"] for member in publication["members"].values() if member["availability"] == "missing")
        self.db.execute("DELETE FROM learning_evaluation_dependencies WHERE json_extract(source_ref,'$.id')=?", (missing_id,))
        self.rehash(publication)
        with self.assertRaisesRegex(ValueError, "dependency union"):
            self.validate()

    def test_rejects_wrong_member_slot_after_rehash(self):
        publication = self.publication()
        self.db.execute("UPDATE learning_evaluation_reports SET slot='member:wrong' WHERE member_key IS NOT NULL")
        self.rehash(publication)
        with self.assertRaisesRegex(ValueError, "member report slot"):
            self.validate()

    def corrupt_checkpoint_parent(self, field, value=None):
        publication = self.publication()
        checkpoint_id, text = self.db.execute("SELECT id,body_json FROM learning_evaluation_reports WHERE member_key IS NOT NULL LIMIT 1").fetchone()
        body = json.loads(text)
        if value is None:
            del body[field]
        else:
            body[field] = value
        self.db.execute("UPDATE learning_evaluation_reports SET body_json=? WHERE id=?", (canonical(body), checkpoint_id))
        self.rehash(publication, rebind_checkpoints=False)

    def test_rejects_checkpoint_without_its_authenticated_parent_after_rehash(self):
        self.corrupt_checkpoint_parent("report_id")
        with self.assertRaisesRegex(ValueError, "checkpoint binding mismatch"):
            self.validate()

    def test_rejects_checkpoint_with_a_changed_parent_checksum_after_rehash(self):
        self.corrupt_checkpoint_parent("report_sha256", "f" * 64)
        with self.assertRaisesRegex(ValueError, "checkpoint binding mismatch"):
            self.validate()

    def test_checkpoints_retain_only_their_frozen_source_and_exact_parent(self):
        first = self.publication()
        second = self.publication("second", first)
        self.validate()
        overall_dependencies = self.db.execute("SELECT COUNT(*) FROM learning_evaluation_dependencies WHERE report_id=?", (second["id"],)).fetchone()[0]
        self.assertEqual(overall_dependencies, len(first["members"]) + len(second["members"]))
        checkpoints = self.db.execute("SELECT id,member_key,body_json FROM learning_evaluation_reports WHERE batch_id=? AND member_key IS NOT NULL", (second["batch_id"],)).fetchall()
        for report_id, member_key, text in checkpoints:
            dependencies = self.db.execute("SELECT source_ref FROM learning_evaluation_dependencies WHERE report_id=?", (report_id,)).fetchall()
            self.assertEqual(dependencies, [(canonical(second["members"][member_key]["source"]),)])
            self.assertEqual(json.loads(text)["report_id"], second["id"])
            self.assertEqual(json.loads(text)["report_sha256"], second["sha256"])

    def test_rejects_completion_without_all_atomic_checkpoints(self):
        self.publication()
        self.db.execute("UPDATE learning_evaluation_members SET report_id=NULL WHERE ordinal=1")
        with self.assertRaisesRegex(ValueError, "Incomplete interpretation"):
            self.validate()

    def test_rejects_completion_without_any_publication(self):
        self.publication()
        self.db.execute("DELETE FROM learning_evaluation_reports")
        self.db.execute("UPDATE learning_evaluation_members SET report_id=NULL")
        self.db.execute("UPDATE learning_evaluation_batches SET report_id=NULL")
        with self.assertRaisesRegex(ValueError, "Completed interpretation lacks"):
            self.validate()

    def test_rejects_lost_execution_result(self):
        self.publication()
        self.db.execute("DELETE FROM learning_execution_receipts")
        with self.assertRaisesRegex(ValueError, "lacks original execution result"):
            self.validate()

    def test_rejects_lost_preparation_mapping(self):
        self.publication()
        self.prepared.clear()
        with self.assertRaisesRegex(ValueError, "no frozen preparation mapping"):
            self.validate()

    def test_rejects_downgraded_execution_accounting(self):
        self.publication()
        row = json.loads(self.db.execute("SELECT data_json FROM learning_execution_receipts").fetchone()[0])
        row.update(budget="uncertain", usage=None)
        self.db.execute("UPDATE learning_execution_receipts SET data_json=?", (canonical(row),))
        with self.assertRaisesRegex(ValueError, "original execution result mismatch"):
            self.validate()

    def test_rejects_boolean_resource_quantities_in_settled_receipt(self):
        self.publication()
        original = json.loads(self.db.execute("SELECT data_json FROM learning_execution_receipts").fetchone()[0])
        for field in ("requests", "input_tokens", "output_tokens"):
            with self.subTest(field=field):
                receipt = deepcopy(original)
                receipt["usage"][field] = True
                self.db.execute("UPDATE learning_execution_receipts SET data_json=?", (canonical(receipt),))
                with self.assertRaisesRegex(ValueError, "Invalid interpretation execution resources"):
                    self.validate()

    def test_rejects_boolean_execution_sequence(self):
        self.publication()
        receipt = json.loads(self.db.execute("SELECT data_json FROM learning_execution_receipts").fetchone()[0])
        receipt["sequence"] = True
        self.db.execute("UPDATE learning_execution_receipts SET data_json=?", (canonical(receipt),))
        with self.assertRaisesRegex(ValueError, "Invalid interpretation execution sequence"):
            self.validate()

    def test_preserves_revisions_and_inherits_all_old_source_restrictions(self):
        first = self.publication()
        second = self.publication("second", first)
        self.validate()
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM learning_evaluation_reports WHERE slot='overall'").fetchone()[0], 2)
        self.db.execute("DELETE FROM learning_evaluation_dependencies WHERE report_id IN (SELECT id FROM learning_evaluation_reports WHERE batch_id=?) "
                        "AND json_extract(source_ref,'$.id') LIKE 'first-%'", (second["batch_id"],))
        self.rehash(second)
        with self.assertRaisesRegex(ValueError, "dependency union"):
            self.validate()

    def test_rejects_revision_without_stale_marker(self):
        self.publication("second", self.publication())
        self.db.execute("DELETE FROM learning_evaluation_invalidations")
        with self.assertRaisesRegex(ValueError, "revision invalidation"):
            self.validate()

    def test_rejects_prior_report_for_a_different_objective(self):
        self.publication("second", self.publication(objective="unrelated-objective"))
        with self.assertRaisesRegex(ValueError, "Prior interpretation provenance"):
            self.validate()

    def test_rejects_unsupported_claim_and_false_retrieval_descriptor(self):
        publication = self.publication()
        body = publication["body"]
        body["interpretation"]["claims"][0]["supporting"] = []
        with self.assertRaisesRegex(ValueError, "Unsupported or unqualified interpretation claim"):
            backup_tool.interpretation_content(body["interpretation"], publication["members"], body["retrieved"])
        body["retrieved"][0]["source_sha256"] = "f" * 64
        with self.assertRaisesRegex(ValueError, "retrieval source mismatch"):
            backup_tool.interpretation_content(body["interpretation"], publication["members"], body["retrieved"])


if __name__ == "__main__":
    unittest.main()
