---
type: Playbook
title: "Stage 2: persistent review requests and qualified reconstruction"
description: "Adjudication carry-forward, production integration, retry authority, historical membership, recovery evidence and remaining host limits for PR #233."
tags: [loom, learning, review, evidence, persistence]
timestamp: 2026-11-13T00:00:00Z
---

# Stage 2: persistent review requests and qualified reconstruction

Stage 2 implements the safe persistence and reconstruction foundation in PR #233, carrying forward the conditional adjudication of `3a7b74f69ea98236c11dcee9e03c8000139453b4`. The accepted [architecture](learning-evidence-and-review-scope.md), BR/QS/OC requirements and [Stage 1 qualification](native-review-qualification.md) remain the baseline. The complete automatic whole-objective learning capability, including E11, remains **UNQUALIFIED**.

The records participate in the normal typed `loom_record ask` path and are available through registered `loom_review` production tools. Request publication, issue arbitration, historical work and evidence reconstruction use the existing Action Store database, Observer, ledger and WorkRef implementation. No second evidence database, queue, execution controller or automatic model dispatch was added.

## Adjudication disposition

| Decision | Disposition | Implementation or remaining boundary |
| --- | --- | --- |
| Immutable review requests and original assessment mandates | Accepted and implemented | `Store.reviews.freeze` preserves original question, dimensions, criteria, mode, inclusions/exclusions, recipient, requester and rechecks. Equivalent same-ID writes return `existing`; changed bodies return `conflict`. |
| Frozen historical work and artifact membership | Accepted and implemented | Complete original members and exact artifact references publish atomically. Selected groups also materialize their selected node and descendants as historical WorkRefs. Contextual ancestors/dependencies are not silently added as requested subjects. |
| Transactional identity and deduplication | Accepted and implemented | Request publication and canonical intent creation use immediate transactions in the existing database. Unique constraints arbitrate independent processes. |
| Canonical initial intent and exclusive ownership | Accepted and implemented | One initial key per request owns one attempt. Only the fresh committed `prepared → claimed` transition returns a permit. No public agent tool exposes claims. |
| Proven non-admission retry | Refined; production authority blocked | Non-admission never reopens the intent. No existing owner supplies durable canonical retry authorization; the default is `retry-authority-unavailable`. This does not establish mandatory human reapproval. |
| Unknown native outcome | Accepted and implemented | Lost acknowledgement, interruption or timeout retains consumption and uncertainty. An additional attempt needs a separately established decision explicitly covering the unresolved predecessor. No automatic redispatch exists. |
| Revision freshness | Refined and implemented | Historical work is preserved. Only original `mandate.currentness: current-at-issue-claim` selects currentness; a conflicting top-level policy is invalid. |
| Qualified observation and evidence relationships | Accepted at supported granularity | The original ledger remains authoritative. Source producer, link author, actual source-return facts, authored interpretations and exact-review uncertainty are separate. |
| Established, unknown and ambiguous attribution | Accepted and implemented | Starts retain complete historical WorkRefs where available. Missing scope remains unknown; reused native groups retain distinct known candidates without pairing them. Exact review execution remains unknown. |
| Authorized readback, migration and restore | Accepted and implemented | Every public operation checks native ledger-file read permission and current Session ownership. Store additionally restricts requests to the original requesting Session. Migration preserves legacy rows; incomplete v2 state fails closed. |
| Automatic protected delivery | Blocked by host qualification | Structured asks persist and prepare, then withhold delivery. No request body enters the broadly readable OQ ledger or child prompt. |
| Automatic whole-objective evaluation and richer collection | Deferred beyond Stage 2 | Persistent inputs and readers support later qualified analysis. No scheduler, raw-content collection, retention/disclosure policy, paid dispatch or instruction mutation is added. |

## Production integration

The existing typed question path resolves responsibility and preserves model-routing safeguards. When an ask includes an explicit structured `review`, Loom checks that its exact question and intended agent agree with the request, then freezes it and prepares its canonical initial intent. It does not infer a mandate from an agent name, verdict, latest Plan or unstructured consultation.

The complete request stays in the private Store projection. Ordinary OQ records can be queried more broadly, so structured review asks do not append their protected body there. The returned request ID supports recovery and reconstruction even when protected delivery cannot proceed.

```json
{
  "operation": "ask",
  "question": "Assess artifact A against its original correctness contract.",
  "recipient": { "kind": "agent", "id": "reviewer" },
  "blocking": true,
  "review": {
    "format": "loom-review-request/v1",
    "request_id": "review-artifact-A-correctness",
    "mandate": {
      "question": "Assess artifact A against its original correctness contract.",
      "dimensions": ["correctness"],
      "criteria": [{ "text": "Preserve the accepted error behavior.", "source_ref": "requirement:BR-004" }],
      "mode": "independent",
      "inclusions": ["artifact A"],
      "exclusions": ["later revisions"]
    },
    "intended_recipient": { "agent": "reviewer", "session_id": null },
    "members": [{
      "member_id": "artifact-A",
      "work_ref": null,
      "producing_attempt_refs": [],
      "artifact_refs": [{
        "locator": "src/example.ts",
        "version": { "kind": "sha256", "value": "0000000000000000000000000000000000000000000000000000000000000000" },
        "content_ref": null
      }],
      "prior_review_request_id": null,
      "membership_source_refs": ["request:original"],
      "gaps": [{ "reason": "source-missing", "source_ref": null }]
    }],
    "rechecks": []
  }
}
```

Replace the illustrative digest with the exact source-byte digest. A locator or hash does not establish availability or access. Supply an original `work_ref` from the worked-against context when work obligations are part of the scope. Do not add raw transcripts, prompts or tool results.

| `loom_review` operation | Result |
| --- | --- |
| `freeze` with `request` | `created`, `existing` or `conflict`; no native issue. |
| `read` with `request_id` | Original mandate, member page, frozen group constituents, artifact availability, issue summaries and qualified relationships joined to original source records. |
| `work` with `request_id`, `member_id` | Original Action, Plan and selected node verified by its WorkRef; explicit gap if historical reconstruction is unavailable. |
| `prepare` with `request_id` | Creates or retrieves the canonical initial intent. State is returned, never a permit. |
| `issue` with `request_id` | Original initial intent body, attempt and paged outcome receipts. Optional `authorization_ref` selects a canonical retry for reading only. |
| `relate` with existing `source_record_id`, `member_ids` | Appends a qualified source relationship or authored interpretation without changing the request. |

Follow `next_after`, `next_relationship_after` and `next_issue_after` as `after`, `relationship_after` and `issue_after`. The issue reader uses `next_outcome_sequence` as `after`. Page limits are 1–50. Requests admit up to 100 explicit members within bounded-record limits; an oversized complete request fails instead of publishing a partial population. Reconstruction enforces the existing 4 MiB UTF-8 byte ceiling and supports smaller complete pages.

Counts describe stored members or observations, not independent successful objectives or successfully assessed subjects. No native review is inferred from a generated request/attempt ID.

## Retry semantics and authority

`ReviewIssues` performs local arbitration and no native I/O. Production passes **no retry authority** and exposes no tool for authoring approval, resetting an intent or claiming an issue.

| State/evidence | Safe meaning |
| --- | --- |
| Prepared | Frozen request and one durable attempt exist; no claim has been consumed. |
| Fresh `claimed-now` | Only this committed transition grants an immediate one-use permit through an authorized adapter. It cannot be recovered as another permit. |
| Existing claim or lost acknowledgement | Return owner/state only. Consumption survives even if the native call might not have happened. |
| Observed issue | A native call was issued; admission, completion and exact review execution are not implied. |
| Proven non-admission | Trusted owner evidence establishes non-admission. Preserve it and the consumed intent. A separate canonical retry decision is required. |
| Unknown outcome | Preserve uncertainty. Timeout, caller failure and missing receipts are not non-admission evidence. |

The existing native question dispatcher recognizes narrowly defined pinned pre-creation denials, but has no durable retry authorization. OQ answers explicitly confer no permission. Native `permission.assert` returns permission success, not a durable canonical decision bound to request and predecessor. None is promoted into a new authority.

The internal `RetryAuthority` seam requires a trusted owner's already durable decision, canonical identity, exact request/prior intent, explicit unresolved-execution allowance and claim-time revalidation. Aliases round-trip to that same decision, which binds at most one retry intent across the Store. Replay retrieves the same attempt; revocation blocks its claim. Fixture-owned durable decisions exercise these contracts without qualifying a production authority.

**Smallest product-owned decision:** may an existing dispatch/admission owner issue a durable retry decision under the original authorization after trusted proof of non-admission, and which existing policy or host-owned evidence authorizes that act? If accepted, that owner defines stable identity, validity/revocation and retry allowance. Stage 2 does not invent either a human approval policy or automatic authority.

## Historical scope and evidence qualification

Policy follows the original mandate. Without currentness, revision A remains available after B, including when its node is removed. With original `mandate.currentness: current-at-issue-claim`, the atomic claim checks every member WorkRef against current saved Action/Plan revisions and rejects `stale-scope` on mismatch. Artifact versions remain immutable under both policies; neither claims the current worktree contains those bytes.

Groups materialize the selected node and descendants while the original Action/Plan snapshot is held. The complete set is stored alongside the authored member sequence. Its checksum detects incomplete/corrupt membership; it is not native authentication or protection against replacing both bytes and checksum. Reconstruction never reruns selection against the latest Plan.

The Observer saves a complete `work_scope` at supported starts; a uniquely paired finish copies it. An observed absence of selected Focus is `unscoped`; Action-only, missing, legacy and over-budget scope remains `unknown`; ambiguous reused groups retain known candidates and observation IDs without FIFO pairing. Capture-off and observer-epoch safeguards remain intact.

- Frozen membership means **requested**, not supplied or inspected.
- `retrieved` currently supports the existing permission-checked companion source-return seam with exact skill/lens identity and digest. It identifies actual tool-return bytes; exact review execution and final provider exposure remain unknown.
- Generic completion, paths, digests, plausible citations and generated tokens cannot manufacture supplied/retrieved evidence.
- `cited`, `claimed-inspected`, `finding`, `correction` and generic observation associations are the **link author's interpretation**, qualified as unknown/authored-association-unverified. `source_producer` separately names the original record's producer. A later analyst cannot make the coder's original result assert inspection.
- Original records are joined on authorized reads, not copied into another evidence store. Missing originals remain `source-missing`; historical relationship facts are retained.
- Corrections name earlier relationships without erasing them. Recheck `finding_ids` identify existing finding/correction relationships in the named prior request. Verdicts remain authored and mandate-relative, not proof of complete coverage.

Every artifact has separate availability qualification: null content references produce a source gap; declared references remain unverified until an authorized source read establishes availability. Original authored gap lists are not rewritten to hide later changes.

## Authorization, migration and restore

Every public operation checks current native `read` permission for the actual ledger file, then revalidates native Session/location and cancellation after approval. Store also requires the original requesting Session. Intended recipient, agent name and project membership grant no disclosure. Denial applies to headers, pages, source joins, issue receipts and historical definitions. The installed negative control exercises native read denial in the same requesting Session after an agent switch. Revocation does not erase previously authorized conversation content.

Schema version 2 adds review tables to the existing ledger. Genuine v1 migration preserves original rows/schema and historical sender/delivery tables; it creates no inferred mandates, consent, native lineage or reactivated delivery machinery. Source-store identity is allocated once and preserved through reopen/restore. Missing v2 review tables or identity fail closed rather than recreating consumed state.

Use the [stopped-state backup/restore runbook](manual-backup-restore.md). Its utility accepts genuine v1 and complete v2 state, validates v2 columns/identity and preserves the identified database/sidecar set. Tests cover closed files and committed residual WAL from a killed writer, then fresh-process public readback, denial and consumed-claim replay. They do not prove power-loss durability or reconciliation of an old backup with later external executions. A stale restored database cannot authorize repeating an uncertain external execution.

## Evidence and continuation

The [machine-readable evidence record](learning-review-stage2-evidence.json) records executed candidate hashes, check totals and limits. Tests include the real Store, independent processes, registered callbacks, Observer history, migration/restore and actual installed-host paths.

Independent review identified and corrected authored-link misattribution, unchecked recheck findings, inaccessible outcome receipts, per-artifact availability gaps, read bounds, unexpanded groups and stored request-key/body mismatch. The final review is **GO for the bounded Stage 2 foundation**, not complete learning acceptance.

The installed harness uses isolated OpenCode 2.2.6, the existing local scripted provider and audit owner, with the watcher enabled. It exercises actual Code Mode/Loom tools, concurrent publication, 100-member reconstruction, A→B history, unrelated-reader denial, process reopen and native permission revocation. These are mechanical boundary proofs, not real model reasoning. Stage 1's native execution and protected-transfer limits remain unchanged.

```bash
bun run typecheck
bun run test:core
bun run test:native
bun run test:python
python3 tests/installed_review_persistence.py \
  --opencode /absolute/path/to/opencode \
  --plugin /absolute/path/to/installed/loom-plugin \
  --artifact /absolute/path/to/loom-plugin.tgz \
  --repository "$PWD" \
  --report-directory /absolute/path/to/new-report-directory
```

The installed-questions workflow archives Stage 2 proof separately from Stage 1. E11 still requires an actually admitted review, source/recipient transfer enforcement, supported exposure/access relationships, automatic whole-objective synthesis, recovery and authorized derived-report publication. Stage 2 provides operational persistent inputs and readers for that continuation; it does not declare the assembled capability complete.
