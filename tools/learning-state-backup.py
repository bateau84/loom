#!/usr/bin/env python3
"""Offline, manifest-bound backup/restore for Loom Action and learning SQLite state.

Never opens source or preserved backup databases with SQLite. All SQLite checks
run on disposable copies. Does not stop writers, repair files, migrate schemas,
touch native sessions, or authorize work.
"""
import argparse
from contextlib import closing
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import stat
import sys
import tempfile
from uuid import uuid4

FORMAT = "loom-stopped-state/v1"
MANIFEST = "loom-state-manifest.json"
DATABASES = ("ledger.sqlite", "learning.sqlite")
SIDECARS = ("-wal", "-shm", "-journal")
REQUIRED_TABLES = {
    # Historical sender/fence tables are optional in fresh installations.
    "ledger.sqlite": {
        "actions", "plans", "ledger", "focus", "action_versions",
    },
    "learning.sqlite": {"learning_candidates", "learning_trials"},
}
REQUIRED_COLUMNS = {
    "learning_candidates": {
        "id", "created_at", "author_session", "author_agent", "target_kind",
        "target_id", "base_sha256", "candidate_sha256", "content",
        "hypothesis", "evidence_refs", "status", "revised_from",
    },
    "learning_trials": {
        "id", "candidate_id", "recorded_at", "session_id", "agent",
        "observed_sha256", "observed_effect", "statement", "evidence_refs",
    },
}
# Mirrors evaluation schema v1 in src/evaluation-store.ts. No evaluation tables
# means legacy state; a partial schema must never be certified as that legacy.
EVALUATION_COLUMNS = {
    "learning_evaluation_schema": {"singleton", "version"},
    "learning_evaluation_batches": {
        "sequence", "id", "identity", "owner_session", "scope_key", "source_store_id",
        "boundary_json", "method_json", "membership_sha256", "revision", "previous_batch_id",
        "state", "blocked_reason", "claim_token", "worker_id", "lease_until_ms",
        "created_at", "updated_at", "report_id",
    },
    "learning_evaluation_members": {"batch_id", "key", "ordinal", "kind", "source_refs", "report_id"},
    "learning_evaluation_reports": {
        "id", "batch_id", "member_key", "slot", "created_at", "body_json", "qualifications_json", "sha256",
    },
    "learning_evaluation_dependencies": {"report_id", "source_key", "source_ref"},
    "learning_evaluation_invalidations": {"sequence", "batch_id", "source_key", "reason", "recorded_at"},
    "learning_evaluation_opportunities": {"session_id", "state", "reason", "generation", "updated_at"},
}
# Optional Stage 4 preparation is part of the same learning database. Any
# retained table requires its complete extension; absence is the legacy case.
EVALUATOR_COLUMNS = {
    "learning_evaluator_schema": {"singleton", "version"},
    "learning_evaluator_methods": {
        "id", "manifest_json", "manifest_sha256", "instruction_sha256",
    },
    "learning_evaluator_requests": {
        "batch_id", "slot", "method_id", "request_id", "data_json", "sha256", "created_at",
    },
}
# Frozen retrospective populations are immutable source descriptors under the
# existing EvaluationStore. They contain no original record bodies or grants.
RETROSPECTIVE_COLUMNS = {
    "learning_retrospective_schema": {"singleton", "version"},
    "learning_retrospective_populations": {
        "id", "owner_session", "owner_agent", "source_store_id", "manifest_sha256",
        "header_json", "contributors_json", "contains_private_reviews", "member_count",
        "metadata_sha256", "created_at",
    },
    "learning_retrospective_members": {"population_id", "key", "ordinal", "data_json"},
}
# Execution records are mirrors in the existing learning database, not a
# provider authority or spend pool. A retained preparation marker makes loss
# of this complete optional extension detectable without guessing nonexecution.
EXECUTION_COLUMNS = {
    "learning_execution_schema": {"singleton", "version"},
    "learning_execution_admissions": {
        "batch_id", "request_id", "attempt_id", "authority_id", "reservation_id",
        "semantic_key", "data_json", "sha256",
    },
    "learning_execution_receipts": {
        "batch_id", "sequence", "authority_id", "receipt_id", "data_json", "sha256",
    },
}
REVIEW_COLUMNS = {
    "review_store_identity": {"singleton", "store_id"},
    "review_requests": {"request_id", "requester_session", "data", "membership_data", "created_at"},
    "review_relationships": {"sequence", "id", "request_id", "data"},
    "review_issue_intents": {
        "sequence", "intent_key", "request_id", "attempt_id", "intent_data",
        "decision_ref", "decision_data", "state", "claimant_id",
        "rejection_reason", "native_outcome", "created_at", "claimed_at", "updated_at",
    },
    "review_issue_outcomes": {
        "sequence", "attempt_id", "status", "source_ref", "reason", "recorded_at",
    },
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def sha_text(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def object_text(values):
    return "{" + ",".join(encoded(key) + ":" + values[key] for key in sorted(values)) + "}"


def raw_object(text):
    """Read canonical contract fields without changing nested frozen bytes.

    Retain nested canonical value slices rather than recanonicalizing them with
    Python's different Unicode collation/float formatter. Top-level contract
    keys below are fixed ASCII, with identical canonical ordering in Loom.
    """
    require(isinstance(text, str) and len(text) <= 33554432 and text.startswith("{") and text.endswith("}"),
            "Invalid retrospective canonical mapping")
    decoder = json.JSONDecoder()
    result = {}
    offset = 1
    while offset < len(text) - 1:
        key, end = decoder.raw_decode(text, offset)
        require(isinstance(key, str) and key not in result and text[end:end + 1] == ":",
                "Invalid retrospective canonical mapping fields")
        start = end + 1
        _, offset = decoder.raw_decode(text, start)
        result[key] = text[start:offset]
        if text[offset:offset + 1] == ",":
            offset += 1
        else:
            require(offset == len(text) - 1, "Invalid retrospective canonical mapping suffix")
            break
    require(object_text(result) == text, "Noncanonical retrospective contract mapping")
    return result


def raw_array(text):
    """Retain exact canonical element bytes for descriptor/checksum checks."""
    require(isinstance(text, str) and len(text) <= 33554432 and text.startswith("[") and text.endswith("]"),
            "Invalid retrospective canonical array")
    decoder = json.JSONDecoder()
    result, offset = [], 1
    while offset < len(text) - 1:
        start = offset
        _, offset = decoder.raw_decode(text, start)
        result.append(text[start:offset])
        if text[offset:offset + 1] == ",":
            offset += 1
        else:
            require(offset == len(text) - 1, "Invalid retrospective canonical array suffix")
            break
    require("[" + ",".join(result) + "]" == text, "Noncanonical retrospective contract array")
    return result


def shape(value, fields, optional=()):
    require(isinstance(value, dict) and set(fields) <= set(value) <= set(fields) | set(optional),
            "Invalid retrospective contract fields")


def retrospective_integrity(db, ledger_store_id):
    """Validate populations and return their exact preparation projections."""
    maximum = 33554432
    identifier = lambda value: isinstance(value, str) and bool(re.fullmatch(
        r"[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}", value))
    fingerprint = lambda value: isinstance(value, str) and bool(re.fullmatch(r"[a-f0-9]{64}", value))
    integer = lambda value: type(value) is int and 0 <= value <= 9007199254740991
    plain = lambda value, limit=8000: isinstance(value, str) and bool(value.strip()) and len(value) <= limit and not re.search(r"[\x00-\x1f]", value)
    populations = {}
    local_views = {"ledger-record": "record-full", "objective": "objective", "objective-link": "objective-link",
                   "review-request": "review-request", "review-relationship": "review-relationship"}
    rows = db.execute("SELECT id,owner_session,owner_agent,source_store_id,manifest_sha256,header_json,contributors_json,"
                      "contains_private_reviews,member_count,metadata_sha256,created_at FROM learning_retrospective_populations").fetchall()
    for population_id, owner, agent, namespace, manifest_sha, header_json, contributors_json, private_reviews, member_count, metadata_sha, created_at in rows:
        require(ledger_store_id is not None and namespace == ledger_store_id,
                "Retrospective source namespace does not match paired ledger")
        require(identifier(population_id) and identifier(owner) and identifier(namespace) and plain(agent, 200)
                and fingerprint(manifest_sha) and fingerprint(metadata_sha) and private_reviews in (0, 1)
                and type(member_count) is int and 1 <= member_count <= 20000,
                "Invalid retrospective population metadata")
        require(isinstance(created_at, str), "Invalid retrospective freeze timestamp")
        datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        header_values = raw_object(header_json)
        header = json.loads(header_json)
        shape(header, ("format", "source_store_id", "selection", "contributors", "objective", "coverage", "qualifications"))
        require(header["format"] == "loom-retrospective-population/v1" and header["source_store_id"] == namespace,
                "Invalid retrospective population format or source namespace")
        contributors = json.loads(contributors_json)
        require(isinstance(contributors, list) and len(contributors) <= 2000 and all(identifier(item) for item in contributors)
                and len(set(contributors)) == len(contributors) and contributors == header["contributors"],
                "Invalid retrospective contributor population")
        for name in ("objective", "coverage"):
            require(isinstance(header[name], dict), "Invalid retrospective " + name)
        require(isinstance(header["qualifications"], list) and len(header["qualifications"]) <= 2000
                and all(plain(item) for item in header["qualifications"]), "Invalid retrospective qualifications")
        selected = header["selection"]
        shape(selected, ("mode", "objective_id", "question", "through", "owner_boundary", "owner_version", "exclusions"))
        require(selected["mode"] == "explicit-objective" and identifier(selected["objective_id"]) and plain(selected["question"])
                and integer(selected["through"]) and fingerprint(selected["owner_version"]), "Invalid retrospective selection")
        boundary = selected["owner_boundary"]
        shape(boundary, ("objective_links", "review_requests", "review_relationships"))
        require((boundary["objective_links"] is None or integer(boundary["objective_links"]))
                and integer(boundary["review_requests"]) and integer(boundary["review_relationships"]),
                "Invalid retrospective selection boundary")
        exclusions = selected["exclusions"]
        require(isinstance(exclusions, list) and len(exclusions) <= 20000, "Invalid retrospective exclusions")
        excluded_ids = set()
        for exclusion in exclusions:
            shape(exclusion, ("record_id", "reason"))
            require(identifier(exclusion["record_id"]) and plain(exclusion["reason"]) and exclusion["record_id"] not in excluded_ids,
                    "Invalid retrospective exclusion")
            excluded_ids.add(exclusion["record_id"])
        members = db.execute("SELECT key,ordinal,data_json FROM learning_retrospective_members WHERE population_id=? ORDER BY ordinal",
                             (population_id,)).fetchall()
        require(len(members) == member_count, "Incomplete retrospective frozen membership")
        size, observed_private, seen, encoded_members = len(header_json), False, set(), []
        preparation_members, manifest_members = [], {}
        for ordinal, (key, actual_ordinal, data_json) in enumerate(members, 1):
            require(actual_ordinal == ordinal and isinstance(data_json, str), "Incomplete retrospective frozen ordinals")
            size += len(data_json)
            require(size <= maximum, "Oversized retrospective frozen membership")
            member_values = raw_object(data_json)
            member = json.loads(data_json)
            shape(member, ("key", "source_store_id", "source", "permitted_view", "availability", "basis", "historical_scope", "qualifications"))
            source = member["source"]
            shape(source, ("kind", "id", "required"), ("session_id", "message_id", "revision", "sha256"))
            require(plain(source["kind"], 100) and plain(source["id"], 1000) and type(source["required"]) is bool
                    and identifier(member["source_store_id"]) and plain(member["permitted_view"], 120)
                    and member["availability"] in ("available", "missing", "unresolved", "unsupported"), "Invalid retrospective member source")
            if "session_id" in source:
                require(identifier(source["session_id"]) and source["session_id"] in contributors, "Missing retrospective source contributor")
            if source["kind"] == "native-call" or "message_id" in source:
                require(source["kind"] == "native-call" and "session_id" in source and identifier(source.get("message_id")),
                        "Invalid retrospective native-call message identity")
            if "revision" in source:
                require(plain(source["revision"], 200), "Invalid retrospective source version")
            if "sha256" in source:
                require(fingerprint(source["sha256"]), "Invalid retrospective source hash")
            if source["kind"] in local_views:
                require(member["source_store_id"] == namespace and member["permitted_view"] == local_views[source["kind"]],
                        "Invalid retrospective local source owner/view")
            if member["availability"] == "available":
                require("revision" in source and "sha256" in source and (source["kind"] not in local_views or "session_id" in source),
                        "Available retrospective source lacks exact version")
            source_values = raw_object(member_values["source"])
            del source_values["required"]
            key_input = object_text({"source_store_id": member_values["source_store_id"], "source": object_text(source_values),
                                     "permitted_view": member_values["permitted_view"]})
            require(key == member["key"] == "source-" + sha_text(key_input) and key not in seen, "Invalid retrospective source identity")
            seen.add(key)
            require(isinstance(member["basis"], list) and len(member["basis"]) <= 2000 and all(isinstance(item, dict) for item in member["basis"])
                    and (member["historical_scope"] is None or isinstance(member["historical_scope"], dict))
                    and isinstance(member["qualifications"], list) and len(member["qualifications"]) <= 2000
                    and all(plain(item) for item in member["qualifications"]), "Invalid retrospective member basis")
            observed_private = observed_private or source["kind"] in ("review-request", "review-relationship")
            encoded_members.append(data_json)
            preparation_members.append((key, "[" + member_values["source"] + "]"))
            manifest_members[key] = member
        require([key for key, _, _ in members] == sorted(seen), "Noncanonical retrospective source order")
        require(observed_private == bool(private_reviews), "Retrospective private-source metadata mismatch")
        manifest_text = object_text({**header_values, "members": "[" + ",".join(encoded_members) + "]"})
        require(sha_text(manifest_text) == manifest_sha, "Retrospective population digest mismatch")
        identity_text = object_text({"format": encoded("loom-retrospective-identity/v1"), "owner_session": encoded(owner),
                                     "source_store_id": encoded(namespace), "manifest_sha256": encoded(manifest_sha)})
        require(population_id == "retrospective-" + sha_text(identity_text), "Retrospective population identity mismatch")
        metadata_text = object_text({"population_id": encoded(population_id), "manifest_sha256": encoded(manifest_sha),
                                     "source_store_id": encoded(namespace), "owner_session": encoded(owner), "contributors": contributors_json,
                                     "contains_private_reviews": encoded(bool(private_reviews)), "member_count": encoded(member_count),
                                     "frozen_by": object_text({"session_id": encoded(owner), "agent": encoded(agent)}), "created_at": encoded(created_at)})
        require(sha_text(metadata_text) == metadata_sha, "Retrospective metadata digest mismatch")
        populations[population_id] = {"owner": owner, "namespace": namespace, "manifest_sha256": manifest_sha,
                                      "members": preparation_members, "manifest_members": manifest_members,
                                      "objective_id": selected["objective_id"]}
    return populations


def retrospective_preparation_integrity(db, populations, has_evaluator):
    """Close JSON references that SQLite foreign keys cannot enforce.

    A batch can commit before its request mapping. A mapping can commit before
    the ledger's review/issue writes. Both are replayable; neither permits a
    missing or substituted frozen population. This checks descriptors only,
    without fetching originals or asserting current source authorization.
    """
    scope = "evaluator-preparation/retrospective"
    fields = ("id", "identity", "owner_session", "scope_key", "source_store_id",
              "boundary_json", "method_json", "membership_sha256", "blocked_reason")
    batches, prepared = {}, {}
    for row in db.execute("SELECT " + ",".join(fields) + " FROM learning_evaluation_batches"):
        batch = dict(zip(fields, row))
        boundary = json.loads(batch["boundary_json"])
        # A changed scope must not hide a retained retrospective boundary.
        if batch["scope_key"] == scope or (isinstance(boundary, dict) and
                {"retrospective_population", "retrospective_manifest"} & set(boundary)):
            require(batch["scope_key"] == scope, "Retrospective preparation scope mismatch")
            batches[batch["id"]] = batch

    requests = {}
    if has_evaluator:
        fields = ("batch_id", "slot", "method_id", "request_id", "data_json", "sha256")
        for row in db.execute("SELECT " + ",".join(fields) + " FROM learning_evaluator_requests"):
            record = dict(zip(fields, row))
            envelope = json.loads(record["data_json"])
            data = envelope.get("data") if isinstance(envelope, dict) else None
            source = data.get("source") if isinstance(data, dict) else None
            marked = isinstance(data, dict) and (data.get("format") == "loom-evaluation-request/v2"
                or data.get("source_scope") == "frozen-retrospective-population"
                or isinstance(source, dict) and (source.get("kind") == "retrospective-population"
                    or source.get("format") == "loom-retrospective-population/v1"))
            if record["batch_id"] not in batches and not marked:
                continue  # Existing v1 preparation semantics are unchanged.
            require(record["batch_id"] in batches, "Retrospective request has no matching preparation batch")
            require(record["slot"] == "overall" and record["batch_id"] not in requests,
                    "Invalid retrospective preparation request slot")
            requests[record["batch_id"]] = record

    for batch_id, batch in batches.items():
        boundary_values = raw_object(batch["boundary_json"])
        boundary = json.loads(batch["boundary_json"])
        shape(boundary, ("retrospective_population", "retrospective_manifest", "preparation_budget_policy"))
        population_id = boundary["retrospective_population"]
        require(isinstance(population_id, str) and population_id in populations,
                "Missing retrospective population for preparation")
        population = populations[population_id]
        require(boundary["retrospective_manifest"] == population["manifest_sha256"]
                and batch["owner_session"] == population["owner"]
                and batch["source_store_id"] == population["namespace"],
                "Retrospective preparation population binding mismatch")
        require(isinstance(boundary["preparation_budget_policy"], str)
                and re.fullmatch(r"[a-f0-9]{64}", boundary["preparation_budget_policy"]),
                "Invalid retrospective preparation budget binding")
        expected_rows = [(key, ordinal, "objective", refs) for ordinal, (key, refs)
                         in enumerate(population["members"], 1)]
        actual_rows = db.execute("SELECT key,ordinal,kind,source_refs FROM learning_evaluation_members "
                                 "WHERE batch_id=? ORDER BY ordinal", (batch_id,)).fetchall()
        require(actual_rows == expected_rows, "Incomplete or substituted retrospective preparation membership")
        members_text = "[" + ",".join(object_text({"key": encoded(key), "kind": encoded(kind), "source_refs": refs})
                                      for key, _, kind, refs in expected_rows) + "]"
        membership_sha = sha_text(members_text)
        require(batch["membership_sha256"] == membership_sha, "Retrospective preparation membership digest mismatch")
        method_values = raw_object(batch["method_json"])
        method = json.loads(batch["method_json"])
        shape(method, ("id", "instruction_sha256"))
        identity = sha_text(object_text({"owner": encoded(population["owner"]), "scope": encoded(scope),
            "namespace": encoded(population["namespace"]), "boundary": object_text(boundary_values),
            "method": object_text(method_values), "membership": encoded(membership_sha)}))
        require(batch["identity"] == identity and batch_id == "eval-preparation-" + identity,
                "Retrospective preparation identity mismatch")
        record = requests.get(batch_id)
        if record is None:
            require(batch["blocked_reason"] not in ("evaluator-request-mapped", "evaluator-dispatch-unavailable"),
                    "Missing retrospective preparation request mapping; restore required")
            continue

        envelope_values = raw_object(record["data_json"])
        envelope = json.loads(record["data_json"])
        shape(envelope, ("requester", "data"))
        requester = envelope["requester"]
        shape(requester, ("session_id", "agent"))
        require(requester["session_id"] == population["owner"]
                and sha_text(record["data_json"]) == record["sha256"],
                "Retrospective preparation requester or envelope mismatch")
        data_values = raw_object(envelope_values["data"])
        data = envelope["data"]
        shape(data, ("format", "request_id", "review_request_id", "batch_id", "slot", "source_store_id",
                     "manifest_sha256", "method", "target_agent", "source_policy", "route_policy", "budget_policy",
                     "source_scope", "originating_request_independence", "method_binding", "original_review_requests",
                     "review_request", "source"))
        source_text = object_text({"kind": encoded("retrospective-population"),
            "format": encoded("loom-retrospective-population/v1"), "population_id": encoded(population_id),
            "manifest_sha256": encoded(population["manifest_sha256"])})
        require(data["format"] == "loom-evaluation-request/v2" and data_values["source"] == source_text
                and data["source_scope"] == "frozen-retrospective-population"
                and data["source_store_id"] == population["namespace"] and data["batch_id"] == batch_id,
                "Retrospective request population binding mismatch")
        require(sha_text(data_values["budget_policy"]) == boundary["preparation_budget_policy"]
                and data_values["method"] == batch["method_json"] and record["method_id"] == method["id"],
                "Retrospective preparation method or budget binding mismatch")
        request_id = "evaluator-" + sha_text(object_text({"format": encoded("loom-evaluation-request-key/v1"),
            "batch_id": encoded(batch_id), "source_store_id": encoded(population["namespace"]),
            "method": batch["method_json"], "slot": encoded("overall")}))
        require(record["request_id"] == data["request_id"] == data["review_request_id"] == request_id
                and data["slot"] == "overall", "Retrospective preparation request identity mismatch")
        manifest_text = object_text({"format": encoded("loom-evaluation-manifest/v2"), "batch_id": encoded(batch_id),
            "source": source_text, "source_store_id": encoded(population["namespace"]), "boundary": batch["boundary_json"],
            "method": batch["method_json"], "membership_sha256": encoded(membership_sha),
            "member_count": encoded(len(expected_rows)), "member_count_unit": encoded("deduplicated-evidence-sources"),
            "objective_count": "1", "members": members_text})
        require(data["manifest_sha256"] == sha_text(manifest_text),
                "Retrospective preparation manifest digest mismatch")
        # The ledger review/issue may not exist yet, but the retained canonical
        # request must still point to this exact preparation manifest.
        review = data["review_request"]
        locator = "loom-evaluation://" + population["namespace"] + "/" + batch_id + "/manifest"
        require(isinstance(review, dict) and review.get("request_id") == request_id
                and review.get("requester") == requester and isinstance(review.get("members"), list)
                and len(review["members"]) == 1 and isinstance(review["members"][0], dict),
                "Retrospective preparation review binding mismatch")
        member = review["members"][0]
        require(member.get("member_id") == "evaluation-manifest" and member.get("membership_source_refs") == [locator]
                and member.get("artifact_refs") == [{"locator": locator,
                    "version": {"kind": "sha256", "value": data["manifest_sha256"]},
                    "content_ref": "loom_insights:evaluation-preparation-members:" + batch_id}],
                "Retrospective preparation review manifest mismatch")
        prepared[batch_id] = {"batch": batch, "request": data, "values": data_values, "population": population,
                              "boundary": boundary_values, "membership_sha256": membership_sha}
    return prepared


def retrospective_execution_integrity(db, prepared, issues):
    """Bind v2 execution mirrors to the already-validated frozen preparation.

    Admission before the claim, or before its first receipt, is a valid crash
    point. Neither this descriptor check nor paired backup grants current source
    access or replaces the authority's restore-independent effect inventory.
    Existing v1 mirror validation remains unchanged.
    """
    fields = ("batch_id", "request_id", "attempt_id", "authority_id", "reservation_id",
              "semantic_key", "data_json", "sha256")
    for row in db.execute("SELECT " + ",".join(fields) + " FROM learning_execution_admissions"):
        record = dict(zip(fields, row))
        admission = json.loads(record["data_json"])
        grant = admission.get("grant") if isinstance(admission, dict) else None
        subject = grant.get("subject") if isinstance(grant, dict) else None
        if record["batch_id"] not in prepared and not (isinstance(subject, dict) and "source" in subject):
            continue
        require(record["batch_id"] in prepared, "Retrospective execution has no matching preparation")
        retained = prepared[record["batch_id"]]
        batch, request, values = retained["batch"], retained["request"], retained["values"]
        shape(admission, ("format", "grant", "reservation_id", "pool_id", "authority_epoch"))
        shape(grant, ("authority_id", "grant_id", "expires_at", "subject", "method", "recipient", "account",
                      "source_authority_ref", "account_authority_ref", "budget_authority_ref", "limits"))
        shape(subject, ("source_store_id", "owner_session", "batch_id", "request_id", "attempt_id",
                        "manifest_sha256", "semantic_key", "source"))
        admission_values = raw_object(record["data_json"])
        grant_values = raw_object(admission_values["grant"])
        subject_values = raw_object(grant_values["subject"])
        require(admission["format"] == "loom-evaluation-admission/v1"
                and sha_text(record["data_json"]) == record["sha256"], "Retrospective execution admission digest mismatch")
        require(subject_values["source"] == values["source"]
                and subject["source_store_id"] == request["source_store_id"]
                and subject["owner_session"] == batch["owner_session"]
                and subject["batch_id"] == batch["id"]
                and subject["request_id"] == request["request_id"]
                and subject["manifest_sha256"] == request["manifest_sha256"],
                "Retrospective execution population/request binding mismatch")
        require(record["request_id"] == subject["request_id"] and record["attempt_id"] == subject["attempt_id"]
                and record["authority_id"] == grant["authority_id"]
                and record["reservation_id"] == admission["reservation_id"]
                and record["semantic_key"] == subject["semantic_key"],
                "Retrospective execution row binding mismatch")
        key = object_text({"kind": encoded("initial"), "request_id": values["request_id"]})
        initial = [item for item in issues.get(request["request_id"], []) if item["intent_key"] == key]
        require(len(initial) == 1 and initial[0]["attempt_id"] == subject["attempt_id"]
                and initial[0]["intent_data"] == object_text({"intent": key})
                and initial[0]["requester_session"] == batch["owner_session"]
                and initial[0]["request_json"] == values["review_request"],
                "Retrospective execution canonical initial issue mismatch")
        boundary = {key: value for key, value in retained["boundary"].items()
                    if key not in ("preparation_source_batch", "preparation_budget_policy")}
        enrollment = object_text({"format": encoded("loom-evaluation-enrollment-key/v2"),
            "request_format": encoded("loom-evaluation-request/v2"), "source": values["source"],
            "source_store_id": values["source_store_id"], "owner_session": encoded(batch["owner_session"]),
            "slot": encoded("overall"), "boundary": object_text(boundary),
            "membership_sha256": encoded(retained["membership_sha256"]), "method": values["method"],
            "source_policy": values["source_policy"], "route_policy": values["route_policy"],
            "budget_policy": values["budget_policy"]})
        require(subject["semantic_key"] == sha_text(enrollment), "Retrospective execution semantic enrollment mismatch")
        method = db.execute("SELECT manifest_json,manifest_sha256,instruction_sha256 FROM learning_evaluator_methods WHERE id=?",
                            (request["method"]["id"],)).fetchone()
        require(method is not None and grant_values["method"] == method[0]
                and sha_text(method[0]) == method[1] and request["method"]["id"] == "evaluator/v1/" + method[1]
                and request["method"]["instruction_sha256"] == method[2],
                "Retrospective execution effective method mismatch")
        # Bind every retained outcome to this exact admission and recipient.
        # Missing receipts alone remain valid: admission commits before claim.
        for sequence, authority, receipt_id, text, fingerprint in db.execute(
                "SELECT sequence,authority_id,receipt_id,data_json,sha256 FROM learning_execution_receipts "
                "WHERE batch_id=? ORDER BY sequence", (batch["id"],)):
            receipt = json.loads(text)
            shape(receipt, ("format", "authority_id", "receipt_id", "sequence", "admission_sha256",
                            "reservation_id", "execution", "budget", "fenced", "usage", "result"))
            raw_object(text)
            require(sha_text(text) == fingerprint and receipt["format"] == "loom-evaluation-execution-receipt/v1"
                    and receipt["admission_sha256"] == record["sha256"]
                    and receipt["reservation_id"] == admission["reservation_id"]
                    and receipt["authority_id"] == authority == grant["authority_id"]
                    and receipt["receipt_id"] == receipt_id and receipt["sequence"] == sequence,
                    "Retrospective execution receipt binding mismatch")
            if receipt["result"] is not None:
                shape(receipt["result"], ("host_id", "session_id", "input_id", "result_id", "sha256"))
                require(receipt["result"]["host_id"] == grant["recipient"]["host_id"]
                        and receipt["result"]["session_id"] == grant["recipient"]["session_id"],
                        "Retrospective execution result recipient mismatch")


def interpretation_source_refs(values):
    """The existing EvaluationStore source identity, including required union."""
    found = {}
    for text in values:
        fields = raw_object(text)
        value = json.loads(text)
        shape(value, ("kind", "id", "required"), ("session_id", "message_id", "revision", "sha256"))
        require(type(value["required"]) is bool, "Invalid interpretation source requirement")
        identity = {key: item for key, item in fields.items() if key != "required"}
        key = sha_text(object_text(identity))
        previous = found.get(key)
        required = value["required"] or previous is not None and json.loads(previous)["required"]
        found[key] = object_text({**identity, "required": encoded(required)})
    return dict(sorted(found.items()))


def interpretation_json_equal(left, right):
    """Match JSON values without Python's bool/int equality coercion.

    JavaScript has one JSON number type, so 0 and 0.0 describe the same value.
    Booleans remain a different type at every nested object/array boundary.
    """
    if type(left) is dict:
        return type(right) is dict and left.keys() == right.keys() and all(
            interpretation_json_equal(value, right[key]) for key, value in left.items())
    if type(left) is list:
        return type(right) is list and len(left) == len(right) and all(
            interpretation_json_equal(a, b) for a, b in zip(left, right))
    if type(left) in (int, float):
        return type(right) in (int, float) and left == right
    return type(left) is type(right) and left == right


def interpretation_content(value, members, retrieved):
    """Check the versioned result's retained referential/coverage contract.

    These are descriptor checks, not an entailment review or a claim of live
    source authorization. Original native result bytes are checked separately.
    """
    identifier = lambda item: isinstance(item, str) and re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}", item)
    fingerprint = lambda item: isinstance(item, str) and re.fullmatch(r"[a-f0-9]{64}", item)

    def items(value, limit=20000):
        require(isinstance(value, list) and len(value) <= limit, "Invalid interpretation collection")
        return value

    def narrative(value):
        require(isinstance(value, str) and value.strip() and len(value.encode("utf-16-le", "surrogatepass")) <= 32000
                and not re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", value), "Invalid interpretation narrative")

    def narratives(value):
        for item in items(value, 200):
            narrative(item)

    def scoped(value):
        scope = items(value)
        require(scope and all(isinstance(key, str) and key in members for key in scope)
                and len(set(scope)) == len(scope), "Interpretation member scope mismatch")
        return scope

    shape(value, ("format", "covered_members", "conclusion", "trajectory", "claims", "review_coverage",
                  "gaps", "qualifications", "prior_interpretations"))
    require(value["format"] == "loom-evaluator-interpretation/v1", "Unsupported interpretation format")
    require(set(scoped(value["covered_members"])) == set(members), "Incomplete interpretation coverage")
    receipt_keys, retrieved_keys = set(), set()
    for receipt in items(retrieved, 100000):
        shape(receipt, ("member_key", "source_index", "receipt_id", "boundary", "source_sha256"))
        key = receipt["member_key"]
        require(isinstance(key, str) and key in members and type(receipt["source_index"]) is int
                and receipt["source_index"] == 0 and identifier(receipt["receipt_id"])
                and receipt["boundary"] in ("native-tool-result", "provider-input"), "Invalid interpretation retrieval receipt")
        member = members[key]
        require(member["availability"] == "available" and member["source"].get("revision")
                and member["source"].get("sha256") == receipt["source_sha256"], "Interpretation retrieval source mismatch")
        identity = (key, receipt["receipt_id"], receipt["boundary"])
        require(identity not in receipt_keys, "Duplicate interpretation retrieval receipt")
        receipt_keys.add(identity)
        retrieved_keys.add(key)

    def citations(value, scope):
        seen = set()
        for ref in items(value):
            shape(ref, ("member_key", "source_index"))
            key = ref["member_key"]
            require(isinstance(key, str) and key in scope and key in retrieved_keys and key not in seen
                    and type(ref["source_index"]) is int and ref["source_index"] == 0,
                    "Interpretation citation lacks retrieved scoped evidence")
            seen.add(key)
        return seen

    conclusion = value["conclusion"]
    shape(conclusion, ("kind", "statement", "limitations"))
    require(conclusion["kind"] in ("recommendations", "no-change", "insufficient-evidence"), "Unsupported interpretation conclusion")
    narrative(conclusion["statement"])
    narratives(conclusion["limitations"])
    for collection, id_field, fields in (("trajectory", "event_id", ("statement",)),
                                          ("review_coverage", "review_id", ("requested", "covered"))):
        seen = set()
        for entry in items(value[collection]):
            shape(entry, (id_field, *fields, "members", "supporting", "limitations"))
            require(identifier(entry[id_field]) and entry[id_field] not in seen, "Duplicate or invalid interpretation item identity")
            seen.add(entry[id_field])
            for field in fields:
                (narrative if field == "statement" else narratives)(entry[field])
            require(citations(entry["supporting"], scoped(entry["members"])), "Unsupported interpretation trajectory or review coverage")
            narratives(entry["limitations"])
    claim_ids, recommendations, supported, prior_recommendations = set(), 0, False, []
    for claim in items(value["claims"]):
        shape(claim, ("claim_id", "kind", "category", "basis", "statement", "members", "supporting", "contradicting",
                      "limitations", "applicability", "recommendation"))
        require(identifier(claim["claim_id"]) and claim["claim_id"] not in claim_ids, "Duplicate or invalid interpretation claim identity")
        claim_ids.add(claim["claim_id"])
        require(claim["kind"] in ("observed", "authored", "interpretation", "verification", "recommendation")
                and claim["category"] in ("finding", "successful-practice", "avoidable-failure", "necessary-exploration", "recovery")
                and claim["basis"] in ("supported", "hypothesis"), "Unsupported interpretation claim")
        narrative(claim["statement"])
        scope = scoped(claim["members"])
        supports, contradicts = citations(claim["supporting"], scope), citations(claim["contradicting"], scope)
        narratives(claim["limitations"])
        narratives(claim["applicability"])
        require((claim["basis"] != "supported" or supports)
                and (claim["basis"] != "hypothesis" or claim["kind"] in ("interpretation", "recommendation") and claim["limitations"])
                and (not contradicts or claim["limitations"]), "Unsupported or unqualified interpretation claim")
        supported = supported or claim["basis"] == "supported"
        proposal = claim["recommendation"]
        if claim["kind"] != "recommendation":
            require(proposal is None, "Unexpected interpretation recommendation")
            continue
        recommendations += 1
        shape(proposal, ("target", "mechanism", "risks", "validation", "prior_recommendations"))
        narrative(proposal["target"])
        narrative(proposal["mechanism"])
        narratives(proposal["risks"])
        narratives(proposal["validation"])
        require(claim["applicability"] and proposal["risks"] and proposal["validation"], "Incomplete interpretation recommendation")
        seen = set()
        for prior in items(proposal["prior_recommendations"], 32):
            shape(prior, ("report_id", "report_sha256", "claim_id"))
            require(identifier(prior["report_id"]) and fingerprint(prior["report_sha256"]) and identifier(prior["claim_id"]),
                    "Invalid prior interpretation recommendation")
            key = (prior["report_id"], prior["claim_id"])
            require(key not in seen, "Duplicate prior interpretation recommendation")
            seen.add(key)
            prior_recommendations.append(prior)
    gaps = set()
    for gap in items(value["gaps"]):
        shape(gap, ("member_key", "kind", "reason"))
        key = gap["member_key"]
        require(isinstance(key, str) and key in members and gap["kind"] in ("unavailable", "not-retrieved", "coverage"),
                "Invalid interpretation source gap")
        narrative(gap["reason"])
        identity = (key, gap["kind"])
        require(identity not in gaps and (gap["kind"] != "unavailable" or members[key]["availability"] != "available")
                and (gap["kind"] != "not-retrieved" or members[key]["availability"] == "available" and key not in retrieved_keys),
                "Interpretation gap contradicts frozen source availability or retrieval")
        gaps.add(identity)
    for key, member in members.items():
        required = "unavailable" if member["availability"] != "available" else "not-retrieved" if key not in retrieved_keys else None
        require(required is None or (key, required) in gaps, "Interpretation omits a source coverage gap")
    qualifications = value["qualifications"]
    shape(qualifications, ("chronology", "independence"))
    narratives(qualifications["chronology"])
    require(qualifications["independence"] == "unknown", "Unsupported interpretation independence assertion")
    priors = {}
    for prior in items(value["prior_interpretations"], 32):
        shape(prior, ("report_id", "report_sha256", "relation", "reason"))
        require(identifier(prior["report_id"]) and fingerprint(prior["report_sha256"])
                and prior["relation"] in ("supersedes", "contests") and prior["report_id"] not in priors,
                "Invalid prior interpretation identity")
        narrative(prior["reason"])
        priors[prior["report_id"]] = prior["report_sha256"]
    require(all(priors.get(prior["report_id"]) == prior["report_sha256"] for prior in prior_recommendations),
            "Prior recommendation lacks attributable prior interpretation")
    require((conclusion["kind"] == "recommendations") == bool(recommendations)
            and (conclusion["kind"] != "no-change" or supported or value["trajectory"] or value["review_coverage"])
            and (conclusion["kind"] != "insufficient-evidence" or conclusion["limitations"] or value["gaps"]),
            "Interpretation conclusion lacks consistent evidence coverage")
    return priors, prior_recommendations


def retrospective_interpretation_integrity(db, prepared, has_execution):
    """Validate atomic S5 publications without granting live source access.

    Native result bytes remain in the existing report, not an import channel or
    evidence store. Their hash closes the result-to-interpretation link even if
    the outer backup/report checksums were recomputed after a substitution.
    Internal checkpoints retain their own frozen source and the exact parent
    report ID/checksum. They inherit the authenticated parent's full dependency
    union; they are not independently readable interpretation content.
    """
    qualification = ["Machine-validated publication; reasoning quality and review independence are not established."]
    fields = ("id", "batch_id", "member_key", "slot", "body_json", "qualifications_json", "sha256")
    reports, by_batch = {}, {}
    for row in db.execute("SELECT " + ",".join(fields) + " FROM learning_evaluation_reports"):
        record = dict(zip(fields, row))
        marked = isinstance(record["id"], str) and record["id"].startswith("interpretation-")
        if not marked and isinstance(record["body_json"], str):
            try:
                body = json.loads(record["body_json"])
                marker = body.get("format") if isinstance(body, dict) else None
                marked = isinstance(marker, str) and marker.startswith(("loom-evaluator-publication/", "loom-evaluator-member/"))
            except ValueError:
                pass  # Legacy report decoding is unchanged by this extension.
        if record["batch_id"] not in prepared and not marked:
            continue  # Existing Stage 3 reports remain unchanged.
        require(record["batch_id"] in prepared, "Interpretation has no frozen preparation mapping")
        require(record["id"] not in reports, "Duplicate interpretation report identity")
        reports[record["id"]] = record
        by_batch.setdefault(record["batch_id"], []).append(record)

    publications = {}
    for batch_id, state, report_id in db.execute("SELECT id,state,report_id FROM learning_evaluation_batches "
            "WHERE scope_key='evaluator-preparation/retrospective'"):
        records = by_batch.get(batch_id, [])
        member_rows = db.execute("SELECT key,report_id FROM learning_evaluation_members WHERE batch_id=? ORDER BY ordinal", (batch_id,)).fetchall()
        if not records and report_id is None and not any(row[1] is not None for row in member_rows):
            require(state != "complete", "Completed interpretation lacks durable publication")
            continue
        require(has_execution and batch_id in prepared, "Interpretation lacks execution authority binding")
        require(state == "complete" and report_id is not None and all(row[1] is not None for row in member_rows)
                and len(records) == len(member_rows) + 1, "Incomplete interpretation publication/checkpoints")
        overall = reports.get(report_id)
        require(overall is not None and overall["batch_id"] == batch_id and overall["slot"] == "overall"
                and overall["member_key"] is None, "Interpretation overall report slot mismatch")
        values = raw_object(overall["body_json"])
        body = json.loads(overall["body_json"])
        shape(body, ("format", "binding", "original_result_text", "retrieved", "interpretation"))
        require(body["format"] == "loom-evaluator-publication/v1", "Unsupported interpretation publication format")
        binding_values = raw_object(values["binding"])
        binding = body["binding"]
        shape(binding, ("subject", "admission_sha256", "method_sha256", "result"))
        admissions = db.execute("SELECT data_json,sha256 FROM learning_execution_admissions WHERE batch_id=?", (batch_id,)).fetchall()
        require(len(admissions) == 1, "Interpretation lacks exact execution admission")
        admission_json, admission_sha = admissions[0]
        admission_values = raw_object(admission_json)
        grant_values = raw_object(admission_values["grant"])
        require(binding["admission_sha256"] == admission_sha == sha_text(admission_json)
                and binding_values["subject"] == grant_values["subject"]
                and binding["method_sha256"] == sha_text(grant_values["method"]),
                "Interpretation execution subject/method/admission mismatch")
        receipt = db.execute("SELECT data_json FROM learning_execution_receipts WHERE batch_id=? ORDER BY sequence DESC LIMIT 1", (batch_id,)).fetchone()
        require(receipt is not None, "Interpretation lacks original execution result")
        receipt_value = json.loads(receipt[0])
        require(receipt_value["execution"] == "completed" and receipt_value["budget"] == "settled"
                and receipt_value["fenced"] is True and receipt_value["usage"] is not None and receipt_value["result"] is not None
                and raw_object(receipt[0])["result"] == binding_values["result"], "Interpretation original execution result mismatch")
        require(type(receipt_value.get("sequence")) is int and 1 <= receipt_value["sequence"] <= 9007199254740991,
                "Invalid interpretation execution sequence")
        usage, limits = receipt_value["usage"], json.loads(grant_values["limits"])
        resource_fields = {"requests", "input_tokens", "output_tokens"}
        for quantities, minimum in ((usage, 0), (limits, 1)):
            require(type(quantities) is dict and set(quantities) == resource_fields
                    and all(type(value) is int and minimum <= value <= 9007199254740991 for value in quantities.values()),
                    "Invalid interpretation execution resources")
        require(all(usage[field] <= limits[field] for field in resource_fields),
                "Interpretation execution usage exceeds admission limits")
        require(isinstance(body["original_result_text"], str) and sha_text(body["original_result_text"]) == binding["result"]["sha256"],
                "Interpretation original result bytes mismatch")
        require(interpretation_json_equal(json.loads(body["original_result_text"]), body["interpretation"]),
                "Interpretation differs from original execution result")
        expected_id = "interpretation-" + sha_text(object_text({"format": encoded("loom-evaluator-report-id/v1"),
            "admission_sha256": binding_values["admission_sha256"], "result": binding_values["result"]}))
        require(report_id == expected_id, "Interpretation durable report identity mismatch")
        retained = prepared[batch_id]
        priors, recommendations = interpretation_content(body["interpretation"], retained["population"]["manifest_members"], body["retrieved"])
        for record in records:
            dependencies = db.execute("SELECT source_key,source_ref FROM learning_evaluation_dependencies WHERE report_id=? ORDER BY source_key", (record["id"],)).fetchall()
            refs = interpretation_source_refs([ref for _, ref in dependencies])
            require(dependencies == list(refs.items()), "Interpretation dependency identity mismatch")
            require(json.loads(record["qualifications_json"]) == qualification, "Interpretation publication qualifications mismatch")
            checksum = sha_text(object_text({"batch_id": encoded(batch_id), "member_key": encoded(record["member_key"]),
                "body": record["body_json"], "qualifications": encoded(qualification), "source_refs": "[" + ",".join(refs.values()) + "]"}))
            require(checksum == record["sha256"], "Interpretation report digest mismatch")
            record["dependencies"] = refs
        for key, checkpoint_id in member_rows:
            record = reports.get(checkpoint_id)
            require(record is not None and record["batch_id"] == batch_id and record["member_key"] == key
                    and record["slot"] == "member:" + key, "Interpretation member report slot mismatch")
            checkpoint = object_text({"format": encoded("loom-evaluator-member/v1"), "report_id": encoded(report_id),
                "report_sha256": encoded(overall["sha256"]), "member_key": encoded(key)})
            checkpoint_identity = "interpretation-member-" + sha_text(object_text({"format": encoded("loom-evaluator-member-id/v1"),
                "report_id": encoded(report_id), "member_key": encoded(key)}))
            require(record["body_json"] == checkpoint and record["id"] == checkpoint_identity,
                    "Interpretation member checkpoint binding mismatch")
        publications[report_id] = {"report": overall, "body": body, "prepared": retained,
                                   "priors": priors, "recommendations": recommendations, "records": records}

    resolved, ancestors, visiting = {}, {}, set()

    def dependencies(report_id):
        if report_id in resolved:
            return resolved[report_id]
        require(report_id not in visiting, "Cyclic interpretation revision provenance")
        visiting.add(report_id)
        require(len(visiting) <= 32, "Interpretation revision history exceeds 32 reports")
        current = publications[report_id]
        population = current["prepared"]["population"]
        refs = [ref for _, source_refs in population["members"] for ref in raw_array(source_refs)]
        ancestry = {report_id}
        for prior_id, fingerprint in current["priors"].items():
            require(prior_id in publications, "Missing prior interpretation publication")
            prior = publications[prior_id]
            old = prior["prepared"]["population"]
            require(prior["report"]["sha256"] == fingerprint and old["owner"] == population["owner"]
                    and old["namespace"] == population["namespace"] and old["objective_id"] == population["objective_id"],
                    "Prior interpretation provenance mismatch")
            refs.extend(dependencies(prior_id).values())
            ancestry.update(ancestors[prior_id])
            require(len(ancestry) <= 32, "Interpretation revision history exceeds 32 reports")
            link = next(item for item in current["body"]["interpretation"]["prior_interpretations"] if item["report_id"] == prior_id)
            invalidation = db.execute("SELECT 1 FROM learning_evaluation_invalidations WHERE batch_id=? AND source_key=? AND reason=?",
                                      (prior["report"]["batch_id"], report_id, "interpretation-" + link["relation"])).fetchone()
            require(invalidation is not None, "Prior interpretation lacks revision invalidation")
        for recommendation in current["recommendations"]:
            prior = publications[recommendation["report_id"]]
            require(any(claim["claim_id"] == recommendation["claim_id"] and claim["kind"] == "recommendation"
                        for claim in prior["body"]["interpretation"]["claims"]), "Missing prior recommendation claim")
        expected = interpretation_source_refs(refs)
        require(len(expected) <= 100000, "Interpretation dependency limit exceeded")
        require(current["report"]["dependencies"] == expected, "Interpretation source dependency union mismatch")
        member_refs = dict(population["members"])
        for record in current["records"]:
            if record["member_key"] is not None:
                own_source = interpretation_source_refs(raw_array(member_refs[record["member_key"]]))
                require(record["dependencies"] == own_source, "Interpretation member checkpoint source mismatch")
        visiting.remove(report_id)
        resolved[report_id] = expected
        ancestors[report_id] = ancestry
        return expected

    for report_id in publications:
        dependencies(report_id)


def sha256(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def project_scope(project_id, canonical):
    # Matches src/plugin.ts digest({ project, canonical }) and model.ts canonical().
    encoded = json.dumps(
        {"canonical": canonical, "project": project_id},
        sort_keys=True, ensure_ascii=False, separators=(",", ":"),
    )
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def location(value, existing=False):
    path = Path(value)
    require(path.is_absolute(), "Paths must be absolute")
    parent = path.parent
    require(parent.is_dir() and parent.resolve(strict=True) == parent,
            "Destination/source parent must exist and be canonical: " + str(parent))
    if existing:
        require(path.is_dir() and not path.is_symlink(),
                "Source/backup must be an ordinary directory: " + str(path))
        require(path.resolve(strict=True) == path, "Directory must be canonical: " + str(path))
    return path


def inventory(directory, manifest=False):
    allowed = {name + suffix for name in DATABASES for suffix in ("", *SIDECARS)}
    entries = {}
    for path in directory.iterdir():
        if path.name == MANIFEST and manifest:
            continue
        require(path.name in allowed, "Unexpected backup/source file: " + path.name)
        require(stat.S_ISREG(path.lstat().st_mode),
                "Not an ordinary file (symlinks refused): " + str(path))
        entries[path.name] = {"size": path.stat().st_size, "sha256": sha256(path)}
    require("ledger.sqlite" in entries, "Missing required ledger.sqlite")
    for name in DATABASES:
        if name not in entries:
            require(not any(name + suffix in entries for suffix in SIDECARS),
                    "Orphan sidecar without " + name)
    return dict(sorted(entries.items()))


def copy_files(src, dst, names):
    for name in names:
        with (src / name).open("rb") as reader, (dst / name).open("xb") as writer:
            shutil.copyfileobj(reader, writer)
        (dst / name).chmod(0o600)


def inspect_sql(directory, file_names):
    # SQLite can recover a WAL or create/change -shm even for reads. Never
    # run it on source, backup, or restored state; only on private scratch.
    results = {}
    ledger_store_id = None
    issues = {}
    with tempfile.TemporaryDirectory(prefix="loom-state-inspect-") as scratch:
        inspected = Path(scratch)
        copy_files(directory, inspected, file_names)
        for name in DATABASES:
            if name not in file_names:
                continue
            uri = (inspected / name).as_uri() + "?mode=rw"
            with closing(sqlite3.connect(uri, uri=True)) as db:
                db.execute("PRAGMA query_only=ON")
                version = db.execute("PRAGMA user_version").fetchone()[0]
                supported_versions = (1, 2) if name == "ledger.sqlite" else (0,)
                require(version in supported_versions,
                        f"Unsupported {name} user_version={version}; expected one of {supported_versions}")
                require(db.execute("PRAGMA integrity_check").fetchall() == [("ok",)],
                        "Integrity check failed: " + name)
                require(not db.execute("PRAGMA foreign_key_check").fetchall(),
                        "Foreign key check failed: " + name)
                schema = db.execute(
                    "SELECT type,name,tbl_name,sql FROM sqlite_schema "
                    "ORDER BY type,name,tbl_name"
                ).fetchall()
                tables = {row[1] for row in schema if row[0] == "table"}
                required_columns = REQUIRED_COLUMNS if name == "learning.sqlite" else (
                    REVIEW_COLUMNS if version == 2 else {}
                )
                has_evaluation = name == "learning.sqlite" and any(
                    table.startswith("learning_evaluation_") for table in tables
                )
                has_evaluator = name == "learning.sqlite" and any(
                    table.startswith("learning_evaluator_") for table in tables
                )
                has_execution = name == "learning.sqlite" and any(
                    table.startswith("learning_execution_") for table in tables
                )
                has_retrospective = name == "learning.sqlite" and any(
                    table.startswith("learning_retrospective_") for table in tables
                )
                if has_evaluation or has_evaluator or has_execution or has_retrospective:
                    required_columns = {**required_columns, **EVALUATION_COLUMNS}
                if has_evaluator or has_execution:
                    required_columns = {**required_columns, **EVALUATOR_COLUMNS}
                if has_execution:
                    required_columns = {**required_columns, **EXECUTION_COLUMNS}
                    required_columns["learning_evaluator_requests"] = (
                        EVALUATOR_COLUMNS["learning_evaluator_requests"] |
                        {"execution_admission_sha256"}
                    )
                populations = {}
                if has_retrospective:
                    required_columns = {**required_columns, **RETROSPECTIVE_COLUMNS}
                required_tables = REQUIRED_TABLES[name] | set(required_columns)
                require(required_tables <= tables,
                        "Missing required " + name + " tables: " +
                        ", ".join(sorted(required_tables - tables)))
                for table, required in required_columns.items():
                    columns = {row[1] for row in db.execute(
                        'PRAGMA table_info("' + table + '")'
                    )}
                    require(required <= columns,
                            "Incompatible " + table + " columns: " +
                            ", ".join(sorted(required - columns)))
                if has_evaluation and not has_evaluator:
                    mapped = db.execute(
                        "SELECT 1 FROM learning_evaluation_batches WHERE blocked_reason IN "
                        "('evaluator-request-mapped', 'evaluator-dispatch-unavailable') LIMIT 1"
                    ).fetchone()
                    require(not mapped,
                            "Missing required learning_evaluator_ tables for mapped evaluator preparation")
                if has_evaluation or has_evaluator:
                    markers = db.execute(
                        "SELECT singleton,version FROM learning_evaluation_schema"
                    ).fetchall()
                    require(len(markers) == 1 and markers[0][0] == 1,
                            "Missing or invalid evaluation schema marker")
                    require(markers[0][1] == 1,
                            "Unsupported evaluation schema version: " + str(markers[0][1]))
                    retrospective_preparation = db.execute(
                        "SELECT 1 FROM learning_evaluation_batches WHERE scope_key='evaluator-preparation/retrospective' LIMIT 1"
                    ).fetchone()
                    require(has_retrospective or not retrospective_preparation,
                            "Missing required learning_retrospective_ tables for retrospective preparation")
                if has_retrospective:
                    markers = db.execute("SELECT singleton,version FROM learning_retrospective_schema").fetchall()
                    require(len(markers) == 1 and markers[0][0] == 1,
                            "Missing or invalid retrospective population schema marker")
                    require(markers[0][1] == 1,
                            "Unsupported retrospective population schema version: " + str(markers[0][1]))
                    populations = retrospective_integrity(db, ledger_store_id)
                if has_evaluator:
                    markers = db.execute(
                        "SELECT singleton,version FROM learning_evaluator_schema"
                    ).fetchall()
                    require(len(markers) == 1 and markers[0][0] == 1,
                            "Missing or invalid evaluator preparation schema marker")
                    require(markers[0][1] == 1,
                            "Unsupported evaluator preparation schema version: " + str(markers[0][1]))
                    evaluator_columns = {row[1] for row in db.execute(
                        "PRAGMA table_info(learning_evaluator_requests)"
                    )}
                    if "execution_admission_sha256" in evaluator_columns:
                        enrolled = db.execute(
                            "SELECT 1 FROM learning_evaluator_requests "
                            "WHERE execution_admission_sha256 IS NOT NULL LIMIT 1"
                        ).fetchone()
                        require(has_execution or not enrolled,
                                "Missing required learning_execution_ tables for enrolled evaluator execution")
                preparations = {}
                if has_evaluation or has_evaluator:
                    preparations = retrospective_preparation_integrity(db, populations, has_evaluator)
                if has_execution:
                    markers = db.execute(
                        "SELECT singleton,version FROM learning_execution_schema"
                    ).fetchall()
                    require(len(markers) == 1 and markers[0][0] == 1,
                            "Missing or invalid evaluator execution schema marker")
                    require(markers[0][1] == 1,
                            "Unsupported evaluator execution schema version: " + str(markers[0][1]))
                    missing = db.execute(
                        "SELECT 1 FROM learning_evaluator_requests AS request "
                        "LEFT JOIN learning_execution_admissions AS admission "
                        "ON admission.batch_id=request.batch_id "
                        "WHERE request.execution_admission_sha256 IS NOT NULL "
                        "AND (admission.batch_id IS NULL OR "
                        "request.execution_admission_sha256<>admission.sha256) LIMIT 1"
                    ).fetchone()
                    unmarked = db.execute(
                        "SELECT 1 FROM learning_execution_admissions AS admission "
                        "LEFT JOIN learning_evaluator_requests AS request "
                        "ON request.batch_id=admission.batch_id "
                        "WHERE request.execution_admission_sha256 IS NULL "
                        "OR request.execution_admission_sha256<>admission.sha256 LIMIT 1"
                    ).fetchone()
                    require(not missing and not unmarked,
                            "Evaluator execution enrollment/mirror mismatch")
                    retrospective_execution_integrity(db, preparations, issues)
                if has_evaluation:
                    retrospective_interpretation_integrity(db, preparations, has_execution)
                if name == "ledger.sqlite" and version == 2:
                    identity = db.execute(
                        "SELECT singleton,store_id FROM review_store_identity"
                    ).fetchall()
                    require(len(identity) == 1 and identity[0][0] == 1
                            and isinstance(identity[0][1], str)
                            and re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}", identity[0][1]),
                            "Missing or invalid review source-store identity; no replacement identity is authorized")
                    ledger_store_id = identity[0][1]
                    fields = ("request_id", "attempt_id", "intent_key", "intent_data", "requester_session", "request_json")
                    for row in db.execute("SELECT issue.request_id,issue.attempt_id,issue.intent_key,issue.intent_data,"
                                          "request.requester_session,request.data FROM review_issue_intents AS issue "
                                          "JOIN review_requests AS request ON request.request_id=issue.request_id"):
                        item = dict(zip(fields, row))
                        issues.setdefault(item["request_id"], []).append(item)
                schema_hash = hashlib.sha256(json.dumps(
                    schema, ensure_ascii=False, separators=(",", ":"),
                ).encode("utf-8")).hexdigest()
                results[name] = {
                    "user_version": version,
                    "schema_sha256": schema_hash,
                    "sqlite_version_checked_with": sqlite3.sqlite_version,
                }
    return results


def validate_backup(backup, args):
    manifest_path = backup / MANIFEST
    require(manifest_path.exists() and stat.S_ISREG(manifest_path.lstat().st_mode),
            "Missing or non-regular backup manifest: incomplete/unidentified set")
    data = json.loads(manifest_path.read_text(encoding="utf-8"))
    require(isinstance(data, dict) and data.get("format") == FORMAT,
            "Unsupported or missing backup-set format")
    require(isinstance(data.get("set_id"), str) and
            re.fullmatch(r"[0-9a-f-]{36}", data["set_id"]),
            "Invalid backup set identity")
    identity = {
        "id": args.project_id,
        "canonical": args.project_canonical,
        "scope": project_scope(args.project_id, args.project_canonical),
    }
    require(data.get("project") == identity, "Backup project identity mismatch")
    require(data.get("loom_revision") == args.loom_revision,
            "Backup Loom revision mismatch; inspect with exact recorded revision")
    require(data.get("package_version") == args.package_version,
            "Backup Loom package version mismatch")
    require(data.get("learning") in ("present", "absent-pre-learning"),
            "Unknown learning database membership")
    actual = inventory(backup, manifest=True)
    require(data.get("files") == actual,
            "Backup file membership, size or SHA-256 mismatch (missing/mixed/corrupt set)")
    learning_present = "learning.sqlite" in actual
    require(learning_present == (data["learning"] == "present"),
            "Learning membership differs from manifest; incomplete backup")
    expected = data.get("databases")
    require(isinstance(expected, dict) and
            set(expected) == (set(DATABASES) if learning_present else {"ledger.sqlite"}),
            "Backup database membership is incomplete")
    actual_sql = inspect_sql(backup, actual.keys())
    require(actual_sql == expected,
            "Backup SQLite format/schema differs from manifest; incompatible set")
    return data, actual


def stopped():
    require(os.environ.get("LOOM_WRITERS_STOPPED") == "yes",
            "Stop all relevant writers/connections and prevent restart; "
            "then explicitly set LOOM_WRITERS_STOPPED=yes (operator assertion only)")


def do_backup(args):
    stopped()
    source = location(args.source_dir, existing=True)
    backup = location(args.backup_dir)
    scope = project_scope(args.project_id, args.project_canonical)
    require(source.name == scope, "Source directory name does not match project scope")
    require(not backup.exists() and not backup.is_symlink(),
            "Backup destination exists; refusal to overwrite")
    require(not backup.is_relative_to(source) and not source.is_relative_to(backup),
            "Backup must be outside source state")
    before = inventory(source)
    learning_present = "learning.sqlite" in before
    require(learning_present != args.legacy_no_learning,
            "If learning.sqlite is absent, explicitly use --legacy-no-learning; "
            "if present, omit that flag")
    backup.mkdir(mode=0o700)
    copy_files(source, backup, before)
    require(inventory(source) == before, "Source changed during snapshot; reject partial copy")
    require(inventory(backup) == before, "File copy differs; reject partial copy")
    sql = inspect_sql(backup, before.keys())
    # Recheck after inspection. The stopped-writers condition, not these hashes,
    # is the cross-database consistency guarantee.
    require(inventory(source) == before and inventory(backup) == before,
            "Files changed during verification; reject partial copy")
    data = {
        "format": FORMAT,
        "set_id": str(uuid4()),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "project": {"id": args.project_id, "canonical": args.project_canonical, "scope": scope},
        "loom_revision": args.loom_revision,
        "package_version": args.package_version,
        "learning": "present" if learning_present else "absent-pre-learning",
        "databases": sql,
        "files": before,
        "boundary": "offline-stopped-writers; no native Session or external artifact backup",
    }
    with (backup / MANIFEST).open("x", encoding="utf-8") as writer:
        json.dump(data, writer, indent=2, sort_keys=True, ensure_ascii=False)
        writer.write("\n")
    (backup / MANIFEST).chmod(0o600)
    print("BACKUP VERIFIED", data["set_id"], data["learning"],
          "files=" + ",".join(before))


def do_restore(args):
    stopped()
    backup = location(args.backup_dir, existing=True)
    destination = location(args.destination_dir)
    require(not destination.exists() and not destination.is_symlink(),
            "Restore destination exists; refusal to overwrite")
    require(not destination.is_relative_to(backup) and not backup.is_relative_to(destination),
            "Restore must be outside preserved backup")
    data, before = validate_backup(backup, args)
    scope = project_scope(args.project_id, args.project_canonical)
    require(destination.name == scope,
            "Restore destination must end in the manifest project scope")
    # No destination is created before manifest, checksum and SQL validation.
    destination.mkdir(mode=0o700)
    copy_files(backup, destination, before)
    require(inventory(backup, manifest=True) == before,
            "Backup changed during restore; reject incomplete destination")
    require(inventory(destination) == before,
            "Restored files differ from backup; reject incomplete destination")
    require(inspect_sql(destination, before.keys()) == data["databases"],
            "Restored SQL format/schema differs; reject incomplete destination")
    require(inventory(destination) == before, "Restored files changed during verification")
    print("RESTORE VERIFIED", data["set_id"], data["learning"],
          "files=" + ",".join(before))
    print("Isolated result only; no work has been resumed or authorized.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("backup", "restore"):
        action = sub.add_parser(name)
        action.add_argument("--project-id", required=True)
        action.add_argument("--project-canonical", required=True)
        action.add_argument("--loom-revision", required=True)
        action.add_argument("--package-version", required=True)
        if name == "backup":
            action.add_argument("--source-dir", required=True)
            action.add_argument("--backup-dir", required=True)
            action.add_argument("--legacy-no-learning", action="store_true")
        else:
            action.add_argument("--backup-dir", required=True)
            action.add_argument("--destination-dir", required=True)
    args = parser.parse_args()
    require(args.project_id and args.project_canonical.startswith("/"),
            "Provide native project ID and absolute canonical project path")
    require(re.fullmatch(r"[0-9a-f]{40}", args.loom_revision),
            "Provide exact 40-character Loom commit SHA")
    require(bool(args.package_version.strip()), "Package version required")
    if args.command == "backup":
        do_backup(args)
    else:
        do_restore(args)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, sqlite3.Error, json.JSONDecodeError) as error:
        print("LOOM_BACKUP_REJECTED:", error, file=sys.stderr)
        sys.exit(1)
