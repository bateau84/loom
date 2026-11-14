---
type: Playbook
title: "Stage 3: automatic learning implementation"
description: "Automatic source-linked descriptions, durable recovery, authorized readers and explicit native and model qualification limits for PR #233."
tags: [loom, learning, evidence, recovery]
timestamp: 2026-11-14T00:00:00Z
---

# Stage 3: automatic learning implementation

Stage 3 implements automatic, deterministic descriptions of existing permitted evidence. It does **not** establish whole-objective success, genuine Evaluator judgement or E11 acceptance. The accepted [whole-work architecture](learning-evidence-and-review-scope.md) and [Stage 2 private review foundation](learning-review-stage2.md) remain the basis. Keep PR #233 open, draft and unmerged pending qualification and independent re-review.

## Automatic discovery and processing

The production plugin notifies the learning runtime after relevant native observations and authored evidence changes. The runtime also receives the native idle hook and performs startup catch-up. A user does not need to issue an evaluation command or wait for another idle event to resume a checkpointed population.

Discovery enumerates existing Session identifiers; this queue metadata is not authority to inspect their content. Processing checks native source-file read permission for the actual Session principal, revalidates its location and principal, and checks capture configuration. Capture-off or invalid configuration suppresses automatic analysis. The scheduler yields to foreground configuration loads and retains durable opportunities for recovery.

`LearningSources` reads existing Session-owned ledger records, same-author objective/link records and requester-owned immutable review sources. Foreign original content is not silently added to a worker's population. Authored references to unavailable native or foreign sources remain uninspected; this is not complete cross-Session reconstruction.

`EvaluationStore` freezes membership and a source/method boundary, then processes at most 20 members per quantum with at most 32 source references per member. It finishes an existing partial population before selecting later arrivals. Checkpoints and the overall report are published transactionally in the existing optional learning database. Equivalent replay does not create a second logical batch; later evidence or a changed method fingerprint produces an attributable revision without overwriting the old report.

The snapshot admits at most 20,000 source-reference occurrences and a canonical serialization allowance of 8,388,608 character units. This allowance is not a UTF-8 byte guarantee. Exceeding a safety bound fails the snapshot rather than publishing a successful prefix. Processing all frozen members means precisely that, not that all relevant native history was captured or the engineering objective succeeded.

## Meaning and evidence coverage

Descriptions distinguish authored completion, observed tool returns, errors, instruction observations, objective correction links and declared review findings. Neither a successful tool return nor several authored objective records establishes independent successful user requests. Practice observations do not establish final provider exposure, application or causal benefit.

Historical review A and partial re-review B retain their original frozen membership and revisions. A declared pass over selected B members does not clear unreviewed A work. Review projections retain `native_execution: "unknown"` and protected delivery remains withheld.

Observed records carry `coverage.capture_gap` as true, false or null when not recorded. They also retain bounded attribution, an explicit excerpt marker and whether a finished observation has established pairing. The overall coverage summary counts unique original observation records, not repeated membership or independent gap incidents. `complete_native_history` remains false even for a fully processed batch.

The continuity correction changes the method instruction fingerprint. Existing reports that omitted these flags remain historical and are not reused as the corrected interpretation. Original ledger bytes are not rewritten.

## Authorized public readback

The registered `loom_insights` tool exposes these read-only operations:

| Operation | Purpose |
| --- | --- |
| `evaluation-status` | Calling-Session queue and qualification state |
| `evaluations` | Paginated batch history, using `before` |
| `evaluation` | Overall report, or a selected `member_key`, for `batch_id` |
| `evaluation-members` | Paginated frozen members and reports, using `after` |
| `evaluation-sources` | Paginated original source references and availability, using `after` |

Every public evaluation read checks native permission for the actual Action and learning database paths, cancellation and Session location. The store also enforces calling-Session ownership. Project membership and an intended recipient name do not grant access. These reads do not dispatch a model or recursively produce new evidence.

Required original hashes and source-store identity are checked at publication and readback. Missing or changed required originals withhold the derived body. Analysis authority is not a cross-Session disclosure or declassification grant.

## Shutdown, backup and recovery

The Action and learning databases have separate read snapshots; the boundary is a vector, not a cross-database atomic snapshot. Source revalidation detects unavailable dependencies. This is not a power-loss durability guarantee or reconciliation of an old backup with uncertain external execution.

The Bun SQL adapter now owns prepared-statement lifetime for production materialized `get`, `all` and `run` operations. It finalizes each execution on success or failure; reusable query handles do not retain native statements between executions. Plugin teardown cancels learning work and disposes registrations before closing its owned connections. The assembled Bun 1.4.2 shutdown regression and independent fresh-process countercheck now pass: no retained production statement remains usable after disposal, and later statement finalization changes no original source bytes. This does not prove power-loss durability.

The existing [stopped-state backup procedure](manual-backup-restore.md) still requires every writer and connection to be stopped. The offline utility inspects disposable copies, not original or preserved backup databases. When any evaluation table is present, it requires the complete evaluation v1 table/column set and a valid singleton version marker. Truly pre-Stage 3 learning databases remain supported. An incomplete schema is rejected without a successful backup manifest or restore destination, even when SQLite integrity checks and file checksums pass.

## Verification and remaining gates

The two earlier independent source reviews assessed Stage 3 at `b0f73cf345d2eb8d54e58c093831b6792ee2216d` and `1636650affe623d972ae9401fae715defe68039b`. The F-01–F-05 backup-schema, shutdown, capture-gap, documentation and orphan-sidecar-test corrections remain in place, including explicit stopped-writers byte-preservation tests.

The later **Independent Product Acceptance Review** at `a5e9ee8dadb34ddd68b1bc1a1642cfbac0d3938e` returned bounded Stage 3 **CONDITIONAL** and full E11 **NO-GO**. It could inspect source/workspace/CI but did **not** execute an independent installed host. Its *PA-F02* identified a real user-facing defect: `loom_insights` help still claimed that automatic reporting and scheduling were absent. Commit `55efdb41a2af69560cb623d47a9ec93b69e98ba9` corrected the registered help and five evaluation reader examples, and added a registered-callback regression that executes the public examples. This is distinct from the earlier cold-review F-02 SQLite issue.

### Exact later CI and installed-host proof

**Implementation/test head:** `8a1a5afdf68f84f233171d179acd1fc5fb8ea9d6` (OpenCode 2.2.6, Bun 1.4.2). The installed Stage 3 workflow checks out this **exact PR head**, not GitHub's synthetic merge ref; it independently records installed package/runtime/source identities. Only its external model provider is scripted, so no paid/live-provider or genuine Evaluator claim follows.

| Exact-head workflow | Verified result |
| --- | --- |
| [Plugin CI](https://github.com/bateau84/loom/actions/runs/43615795890) | PASS: repository/fixture typechecks, 387 core, 428 native, six Code Mode and 241 Python tests, production bundle |
| [Installed Stage 3 mechanics](https://github.com/bateau84/loom/actions/runs/43615795998) | **PASS: ten bounded installed-product checks** |
| [Installed V2 routing](https://github.com/bateau84/loom/actions/runs/43615795928) | PASS |
| [Installed questions and Stage 1/2](https://github.com/bateau84/loom/actions/runs/43615795878) | PASS |
| [Installed boot/trust](https://github.com/bateau84/loom/actions/runs/43615795866) | PASS |
| [Installed routing guard](https://github.com/bateau84/loom/actions/runs/43615795875) | PASS |
| [Learning qualification workspace](https://github.com/bateau84/loom/actions/runs/43615795889) | PASS |

The installed candidate produced original native evidence, triggered background processing, published source-linked reports, and preserved historical authored R1/A → finding → correction B → partial R2 with exact recheck scope. It denied foreign and revoked readers, caught up previously blocked sources after a separate host restart, created attributable later revisions, respected capture-off and made no unqualified model or instruction mutation call.

A new **stopped-writers backup/restore** check closed both databases, froze the actual source files *after* native shutdown, verified original/backup/restored file hashes and manifest, then booted an isolated restored host. The original report and R2 finding relationship were recovered through public Loom tools; foreign and revoked reads stayed denied.

A separate installed **large-population acceptance** created 501 authored objectives through native Loom APIs from one original ledger record with capture off. Automatic cold-start catch-up processed **502 frozen members** and reported **1,003 unique source references**. Public member and source pagination covered every item without fabricating 501 independent originating requests. No direct evaluator call, fake batch injection or manual report creation was used.

The [machine-readable status](learning-automatic-stage3-redo-status.json) records the exact run identities, the old acceptance-review head and verified later scope. These are implementation-owner CI receipts, not an independent re-review approval.

### Product limits that remain

This bounded implementation intentionally produces deterministic descriptions, not genuine Evaluator judgments. It does **not** establish actual native Reviewer admission, same-invocation supplied/retrieved source exposure (Q4), enforced protected incoming transfer (Q5), complete multi-Session/100-task E11 synthesis, included-only model entitlement/billing, or direct human provenance. Structured protected delivery remains withheld; no fallback or simulated native receipt may be used to mark E11 complete.

The installed run exercises blocked permission, graceful host restart, complete stopped-state restore, source revalidation and large-population chunking. It does **not** prove crash/restart at every partial checkpoint, forced process termination during publication, power-loss durability, cross-database atomicity or external-effect reconciliation. A complete E11 acceptance claim remains **NO-GO / UNPROVEN** until upstream and operator gates are qualified and a genuine authorized Evaluator journey is executed.
