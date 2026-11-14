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

The original cold review assessed `b0f73cf345d2eb8d54e58c093831b6792ee2216d` as conditional. The follow-up review assessed `1636650affe623d972ae9401fae715defe68039b` as conditional, identifying one remaining F-05 test defect: a missing manifested database was incorrectly assumed to leave an orphan WAL/SHM sidecar.

F-05 was corrected at `959969c3a7e538c125feda04b6d46efa1445bdf8`. The regression now tests **both** an absent manifested learning database *without* sidecars (manifest membership rejection) and an **explicitly constructed orphan WAL** (orphan-sidecar rejection), with no restore destination created in either case. The validator and source-preservation checks were not weakened.

**Exact evidence head:** `959969c3a7e538c125feda04b6d46efa1445bdf8` (Bun 1.4.2).

| Check | Verified result |
| --- | --- |
| [Plugin CI](https://github.com/bateau84/loom/actions/runs/43583444612) | PASS: typecheck, 387 core, 427 native, six Code Mode, 241 Python tests, production build |
| [Installed V2 routing](https://github.com/bateau84/loom/actions/runs/43583444581) | PASS |
| [Installed questions production-path](https://github.com/bateau84/loom/actions/runs/43583444632) | PASS |
| [Installed unqualified routing guard](https://github.com/bateau84/loom/actions/runs/43583444579) | PASS |
| [Installed boot and trust](https://github.com/bateau84/loom/actions/runs/43583444640) | PASS |
| [Learning qualification workspace](https://github.com/bateau84/loom/actions/runs/43583444576) | PASS — packages the workspace; does not establish a Stage 3 end-to-end journey |

F-01 evaluation-schema validation, F-02 stopped-source stability within the tested shutdown boundary, and F-03 capture-gap projections retain passing regression evidence. F-04 documentation now tracks the later reviewed head and exact green CI evidence; see the [status record](learning-automatic-stage3-redo-status.json). Later documentation-only commits require their own CI verification. The follow-up review covered the preceding head, not the corrected green head, and is **not** independent approval of that head.

No local execution is claimed for this stabilization pass. Earlier local counts remain historical. An additional installed Stage 3 mechanics workflow now exercises the **exact packed PR-head artifact** through the real OpenCode 2.2.6 host using a scripted external provider. [Run 43611681894](https://github.com/bateau84/loom/actions/runs/43611681894), source head `39e158ff50e1d0daba2ced48e25c0011fca57055`, passed eight checks: real native source→automatic report, source-linked public readback, foreign/revoked reader denial, blocked read→separate restart catch-up, late-source revision, authored R1/finding/Plan B/partial R2 with exact R1 recheck, capture-off and no unqualified model/mutation. The audit report retains installed package and native source identities; its external provider is explicitly scripted.

All **seven** workflows passed at that exact runtime source: [Plugin CI](https://github.com/bateau84/loom/actions/runs/43611682053), [installed V2 routing](https://github.com/bateau84/loom/actions/runs/43611681904), [installed questions](https://github.com/bateau84/loom/actions/runs/43611681946), [boot/trust](https://github.com/bateau84/loom/actions/runs/43611681986), [routing guard](https://github.com/bateau84/loom/actions/runs/43611681911), [workspace packaging](https://github.com/bateau84/loom/actions/runs/43611681897) and installed Stage 3 mechanics. The [status record](learning-automatic-stage3-redo-status.json) distinguishes this runtime evidence from documentation-only commits.

**Not accepted:** these are bounded installed mechanics, not actual native R1 or R2 Reviewer executions, a full 100-task multi-Session E11 journey, genuine Evaluator reasoning, protected Q5 content transfer, exact Q4 admitted-input→execution/source-consumption provenance, an approved included-only provider budget or forced crash/power-loss proof. The original review and correction are authored, appropriately qualified source relationships; native review delivery stays withheld.

Q4 native causal provenance remains unqualified. Q5 retains its failed native parent-inline protected-transfer counterexample; Loom withholds protected delivery. Genuine Evaluator interpretation and E11 remain unproven, and an included-usage dispatch route remains unqualified. No automatic model request, paid fallback, raw transcript/tool-content collection, canonical instruction mutation or experiment activation is introduced by these corrections.
