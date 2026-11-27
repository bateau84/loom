---
type: Playbook
title: "Stage 4: durable Evaluator preparation"
description: "The first Stage 4 implementation slice: declared methods, frozen source manifests, canonical review linkage, authorized readers and recovery with dispatch unavailable."
tags: [loom, learning, evaluator, evidence, recovery]
timestamp: 2026-11-15T00:00:00Z
---

# Stage 4: durable Evaluator preparation

**Loom can prepare and reconstruct a whole frozen source population for the existing Evaluator and Agent Run Audit method. It cannot yet run or publish a genuine Evaluator interpretation.** This is the first bounded implementation of the [Stage 4 contract](learning-stage4-contract.md), following PR #235. It implements the independent preparation boundary permitted by that contract. [Issue #227](https://github.com/bateau84/loom/issues/227) remains open.

The new operation freezes a separate method/scope over an existing authorized Stage 3 batch, persists one evaluation request, freezes its retrospective review mandate and prepares one canonical initial issue. It never claims that issue, creates a native recipient, invokes a provider, reserves budget or publishes an interpretation. `interpretation` and `budget_reservation` are explicitly null. Q4, Q5 and E11 remain unqualified.

The subsequent [execution-admission assessment](learning-stage4-admission.md) adds a read-only `loom_insights evaluation-admission` view of that exact preparation and canonical issue. It distinguishes capability-specific blockers and consumed/uncertain issue history without granting an effect permit or implementing budget reservation. This does not change preparation or enable dispatch.

The [restricted execution consumer](learning-restricted-execution.md) subsequently adds immutable admission/outcome mirrors and a trusted-adapter lifecycle over that prepared chain. Production has no connected authority adapter. Preparation and its public readers retain the behavior described here; fixture-qualified execution is not a live account or genuine Evaluator qualification.

## Distinct retrospective source path

The [frozen-population increment](learning-retrospective-populations.md) adds an
explicit alternative source to `prepare-evaluation`: `population_id` and its exact
`manifest_sha256`, instead of `batch_id`. The declared method and `budget_policy`
are unchanged. Current source-owner checks complete asynchronously before the
local preparation chain is written. Previously available originals that changed
or disappeared block preparation; gaps already frozen in the selection remain
qualified inputs.

Retrospective preparation uses `loom-evaluation-request/v2` with a
`source.kind: retrospective-population` identity and a separate reserved batch
scope. It never filters or reinterprets a Stage 3 batch. Both preparation scopes
are excluded before Stage 3 inventory pagination. Existing dedicated preparation
readers reconstruct the same canonical request, review and issue, while source
reads route through the asynchronous population owner. Every reader and legacy
review replay rechecks source permissions. The restricted execution consumer
explicitly refuses the new source kind, even with a fixture authority adapter.

The v1 calling-Session preparation contract below remains unchanged.

## What is usable

| Capability | Meaning in this increment |
| --- | --- |
| Versioned method | Exact declared references for the Evaluator definition, Agent Run Audit skill, rubric, instruction bundle, model/settings, adapter/profile and source/route policies; strict validation and a stable digest |
| Frozen population | All existing authorized Stage 3 members and exact source references; no successful prefix, foreign original lookup or new raw capture |
| Durable request | One overall slot per preparation batch/method, preserving the first requester's identity across replay and interrupted cross-store writes |
| Review linkage | One frozen review member references the complete immutable manifest; the existing review owner supplies the canonical initial issue |
| Source view | Bounded membership and one-original-record reads, restricted to the calling owner Session and existing source permissions |
| Recovery | Replay reconciles the same identities; missing committed mappings are fenced; consumed issue state is never reset |

This is **explicit preparation**, not automatic Stage 4 scheduling. Stage 3's scheduler, method, checkpoints, source boundaries and six reader operations remain in place. No new scheduler or shared completion bit is introduced. Method-specific automatic eligibility/progress will be implemented with a qualified execution path; Stage 3 completion does not mean Stage 4 completion.

An authored fail/fail/pass objective keeps its objective identity, producing records, handbacks, verification links and corrective links in the manifest. Initial and partial reviews retain their original questions, criteria, exact artifacts and recheck links. These are inputs to a future interpretation. This increment does not classify that fixture as a success, estimate independent episodes or manufacture an Evaluator conclusion.

## Prepare through the existing review tool

Use `loom_insights` with `operation: "evaluations"` to find the calling Session's Stage 3 batch. Then invoke the registered `loom_review` operation:

```json
{
  "operation": "prepare-evaluation",
  "batch_id": "STAGE3_BATCH_ID",
  "method": {
    "format": "loom-evaluator-method/v1",
    "evaluator": {"agent": "evaluator", "definition": {"locator": "EXACT_EVALUATOR_REFERENCE", "sha256": "REPLACE_WITH_64_LOWERCASE_HEX_CHARACTERS"}},
    "audit_skill": {"skill": "agent-run-audit", "definition": {"locator": "EXACT_AUDIT_SKILL_REFERENCE", "sha256": "REPLACE_WITH_64_LOWERCASE_HEX_CHARACTERS"}},
    "rubric": {"locator": "EXACT_RUBRIC_REFERENCE", "sha256": "REPLACE_WITH_64_LOWERCASE_HEX_CHARACTERS"},
    "instruction_bundle": {"locator": "EXACT_VERSIONED_BUNDLE_REFERENCE", "sha256": "REPLACE_WITH_64_LOWERCASE_HEX_CHARACTERS"},
    "result_format": "loom-evaluator-interpretation/v1",
    "model": {"provider_id": "DECLARED_PROVIDER", "model_id": "DECLARED_MODEL", "settings": {"locator": "EXACT_SETTINGS_REFERENCE", "sha256": "REPLACE_WITH_64_LOWERCASE_HEX_CHARACTERS"}},
    "adapter": {"id": "DECLARED_ADAPTER", "version": "EXACT_VERSION", "profile": {"id": "PROFILE", "revision": "EXACT_REVISION", "sha256": "REPLACE_WITH_64_LOWERCASE_HEX_CHARACTERS"}},
    "source_policy": {"id": "SOURCE_POLICY", "revision": "EXACT_REVISION", "sha256": "REPLACE_WITH_64_LOWERCASE_HEX_CHARACTERS"},
    "route_policy": {"id": "ROUTE_POLICY", "revision": "EXACT_REVISION", "sha256": "REPLACE_WITH_64_LOWERCASE_HEX_CHARACTERS"}
  },
  "budget_policy": null
}
```

The strings above are placeholders and intentionally fail fingerprint validation until replaced. A budget policy, when supplied, has the same `id/revision/sha256` shape as other policy references. Null records that none is supplied. No numerical allowance, included entitlement, paid fallback or authorization is inferred.

All method and policy inputs are **declared metadata**. Loom does not load these referenced files, attest their bytes, establish the effective admitted model/settings, or treat a supplied policy reference as a grant. Settings are referenced rather than accepting a credential-bearing configuration object. Do not put credentials or source excerpts in references. The method ID is `evaluator/v1/` plus the canonical manifest digest; the existing two-field `EvaluationMethod` is retained. The instruction digest names the declared versioned bundle. Admission must establish its effective contents separately before any future inference.

Preparation requires valid configuration with `ledger.capture: automatic`, native read permission on both existing databases, and the original owner Session. Configuration is rechecked after asynchronous authorization. The operation stores metadata only; an explicit review operation is the creation boundary. Readers never create or repair missing state.

## Readback and complete membership

The response supplies a new preparation `batch_id`, `request_id`, `review_request_id`, `method_id`, `manifest_sha256`, declared method manifest and actual canonical issue state. A prepared issue has `native_outcome: "not-issued"`; a previously consumed issue retains its original state and uncertainty. `state: "prepared"` means the local preparation chain exists, not that execution was admitted or engineering work succeeded.

| `loom_insights` operation | Required selection |
| --- | --- |
| `evaluation-preparation` | Preparation `batch_id` |
| `evaluation-preparation-members` | Preparation `batch_id`, exact `request_id`, exact `manifest_sha256`; `after` starts at 0; `limit` is 1–100 |
| `evaluation-preparation-source` | The same identity triple, exact `member_key` and zero-based `source_index` from that member's source references |

Member pages return immutable ordinals and `next_after`. Their digest covers the versioned manifest header and **all ordered members**, including source identity/version/hash and requiredness. To reconstruct it, collect every member without its page-only `ordinal`, concatenate pages in order, and combine the returned `manifest` header with `members`. Use Loom's canonical/digest rules. The pointer alone never proves material was supplied or read by an Evaluator.

One original-source read returns only that existing stored record and its exact reference. `coverage: "existing-stored-record"` does not promise an original tool transcript or complete history; existing observations remain bounded metadata. `native_evaluator_retrieval: "not-established"` prevents the reader from upgrading a local source return to Q4 evidence. Foreign linked identities can remain authored metadata, while their original content stays uninspected.

All pages recheck current native permission, owner, source-store identity, complete membership and every required original's exact hash/revision. Wrong request/hash/cursor, missing or changed originals and foreign owners are rejected. The public allowance is 262,144 canonical JSON characters, not bytes or tokens. A page stops before an item that does not fit without advancing past it; an individually oversized source fails explicitly.

Stage 3's `evaluations` inventory excludes preparation scope **before pagination**. Its generic report readers reject preparation IDs; use the dedicated readers above. This preserves the old report decoder and avoids revealing hidden preparation inventory through cursors or predecessor fields. Replaying `prepare-evaluation` recovers the stable IDs after an acknowledgement is lost.

Preparation reviews also require both-store/source authorization through the existing `review read/issue/work/prepare`, `review freeze` replay and structured `record ask` replay paths. Stripping the incoming classification does not bypass the stored classification check.

## Persistence and failure recovery

The existing `EvaluationStore` owns optional version-1 `learning_evaluator_schema`, `learning_evaluator_methods` and `learning_evaluator_requests` tables in `learning.sqlite`. They are initialized only during explicit preparation. Legacy state with no extension is supported; partial or unsupported extension state blocks preparation without disabling Stage 3 or ordinary Action tools.

The write order is:

1. Freeze the separate preparation population from exact Stage 3 membership.
2. Commit the method and unique overall request mapping together with a durable mapped marker on its batch.
3. Freeze the persisted request through `ReviewRequests`, preserving the original requester.
4. Prepare the canonical initial issue through `ReviewIssues`.
5. Mark the preparation batch blocked on unavailable dispatch.

The two databases are not one transaction. A crash between these steps reuses the exact persisted request rather than inventing another mandate. Local preparation batch/request identities are deterministic, versioned idempotency keys over immutable source-store/batch/method boundaries. They do not establish native causal provenance. They also permit an older pre-mapping snapshot to reconcile with a surviving original request and consumed issue without resetting it.

If the batch's committed mapped/finalized marker survives but its mapping is lost, replay is fenced with a restore-required error. Missing optional tables are not silently treated as virgin state in that case. A real pre-mapping write failure remains recoverable. The existing stopped-host [backup procedure](learning-experiments.md) validates the optional extension and preserves it with the paired stores. It is not a transaction with native history or provider spending, and no such guarantee is claimed here.

Generated retrospective review requests have the reserved `evaluator-preparation` classification. Only the internal producer, after committing and validating the mapping, can create a new request with that marker. Public replay remains authorized. Source discovery excludes these rows before population limits, and original resolution excludes them too, so a later preparation cannot re-expose a withdrawn source through a prior preparation. A historical authored extension using this exact reserved value is conservatively withheld from engineering analysis; its stored row is preserved. The marker does not prove a model ran. Classification of future admitted analysis executions remains an execution-stage obligation.

## Verification and remaining obligations

The native suites cover strict declared methods, one fail/fail/pass objective, scoped original reviews, 501 authored objective anchors, full membership paging, source loss, foreign access, legacy replay bypasses, concurrent processes, lost acknowledgements, SIGKILL at cross-store boundaries, consumed issues, optional schema damage and stopped-state backup/restore. Synthetic fixtures establish mechanical behavior only.

The installed workflow packages the candidate; `tests/installed_learning_stage4.py` verifies that exact artifact and installation, then uses an unmodified OpenCode 2.2.6 host with the existing local scripted provider. It drives native tools, preserves one synthetic objective trajectory, checks complete public readback, denies foreign/revoked readers and malformed continuations, restarts the actual host and withholds a changed original. The passive audit checks local-provider-only activity and absence of subagent dispatch or instruction mutation. The installed workflow also retains the Stage 3 regression run.

Run the focused checks with the repository's pinned Bun:

```sh
bun run typecheck
bun test tests/evaluator-method-native.test.ts tests/evaluator-preparation-native.test.ts tests/evaluator-runtime-native.test.ts tests/evaluator-backup-native.test.ts
python3 tests/installed_learning_stage4.py --help
```

The installed command requires a clean exact source head, exact packed artifact/installation and isolated report directory; its `--help` documents those inputs. Exact execution receipts and review disposition are recorded separately in #227 and the implementation PR, rather than treating a proposed command as a passed check.

| Remaining capability | Required next evidence/owner |
| --- | --- |
| H4 / same-invocation provenance | OpenCode admission/runner owners provide durable parent → admitted input → model/tool/result receipts; qualify installed positive and negative controls |
| H5 / protected recipient delivery | OpenCode and source-policy owners enforce sealed ingress, retained context, tool returns, notifications and derived-output restrictions |
| Effective method and genuine reasoning | Authorized operator supplies exact installed Evaluator/Audit definitions, original objective sources, supported recipient scope, qualified account/provider route and bounded cost policy; independent assessment evaluates the actual reasoning |
| Execution lifecycle | Capability-specific admission, resource-pool reservation, uncertain-effect/result reconciliation, cancellation/restore fencing and admitted-analysis classification |
| Interpretation publication | Versioned result validation, source-derived exposure union, trajectory/claim/recommendation section paging and existing report/checkpoint publication |
| Automatic Stage 4 and full E11 | Method/scope-specific progress in the existing scheduler and assembled native whole-objective acceptance; Stage 3's deterministic success is insufficient |

No canonical skill/agent change, experiment, paid fallback, provider upgrade, real-model dispatch or new content-retention policy is enabled by this increment.
