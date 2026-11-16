---
type: Playbook
title: "Stage 3: automatic learning implementation"
description: "Automatic source-linked descriptions, durable recovery, authorized readers and explicit native and model qualification limits for PR #233."
tags: [loom, learning, evidence, recovery]
timestamp: 2026-11-15T00:00:00Z
---

# Stage 3: automatic learning implementation

**Bounded Stage 3: merged through [PR #233](https://github.com/bateau84/loom/pull/233) at `e1c6a66c4c6ff2d23881c07533715d59a45000a1` on 2026-11-15.** Independent installed-host qualification of production source `4cf442510c29aa1387b1ce7e2de6716d926f5452` established GO for this bounded release and superseded the earlier qualification hold. The final pre-merge qualification update changed documentation, evidence and a reusable test harness only; production runtime and dependency manifests were unchanged from that independently tested source.

Stage 3 implements automatic, deterministic descriptions of existing permitted evidence. It does **not** establish whole-objective success, genuine Evaluator judgement or E11 acceptance. The accepted [whole-work architecture](learning-evidence-and-review-scope.md) and [Stage 2 private review foundation](learning-review-stage2.md) remain the basis. **Q4 and Q5 remain UNQUALIFIED; E11 remains NO-GO / UNPROVEN.**

The proposed [Stage 4 contract](learning-stage4-contract.md) carries this design forward and records a fresh host investigation, including OpenCode 2.3.0 source. It does not change the Stage 3 runtime or enable Evaluator dispatch.

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
| `evaluation-observations` | Complete member observations, using `after` and the immutable `report_id` |

Every public evaluation read checks native permission for the actual Action and learning database paths, cancellation and Session location. The store also enforces calling-Session ownership. Project membership and an intended recipient name do not grant access. The six operations do not dispatch a model, and Loom excludes its evaluation reads from recursive evidence capture. A surrounding native Code Mode execution can still create its own observation and later report revision; qualification preserves those events.

The evaluation result object has a 262,144 canonical-character allowance. This excludes native/tool envelopes and is not a UTF-8 byte guarantee. A member report that cannot fit inline returns `body: null`, `body_paginated: true`, `observation_count` and `observations_operation: "evaluation-observations"`. To reconstruct it, supply its `batch_id`, `member_key` and immutable `report_id`, then follow `next_after` until null. Every observation page repeats `report_id` and `report_sha256`. A wrong report identity or invalid cursor fails. Combined member pages also respect the result allowance without consuming a cursor for an omitted item; some member bodies may require observation pages even when they fit individually.

Required original hashes and source-store identity are checked at publication and readback. Missing or changed required originals withhold the derived body. Analysis authority is not a cross-Session disclosure or declassification grant.

## Shutdown, backup and recovery

The Action and learning databases have separate read snapshots; the boundary is a vector, not a cross-database atomic snapshot. Source revalidation detects unavailable dependencies. This is not a power-loss durability guarantee or reconciliation of an old backup with uncertain external execution.

The Bun SQL adapter now owns prepared-statement lifetime for production materialized `get`, `all` and `run` operations. It finalizes each execution on success or failure; reusable query handles do not retain native statements between executions. Plugin teardown cancels learning work and disposes registrations before closing its owned connections. The assembled Bun 1.4.2 shutdown regression and independent fresh-process countercheck now pass: no retained production statement remains usable after disposal, and later statement finalization changes no original source bytes. This does not prove power-loss durability.

The existing [stopped-state backup procedure](manual-backup-restore.md) still requires every writer and connection to be stopped. The offline utility inspects disposable copies, not original or preserved backup databases. When any evaluation table is present, it requires the complete evaluation v1 table/column set and a valid singleton version marker. Truly pre-Stage 3 learning databases remain supported. An incomplete schema is rejected without a successful backup manifest or restore destination, even when SQLite integrity checks and file checksums pass.

## Verification and remaining gates

The two earlier independent source reviews assessed Stage 3 at `b0f73cf345d2eb8d54e58c093831b6792ee2216d` and `1636650affe623d972ae9401fae715defe68039b`. The F-01–F-05 backup-schema, shutdown, capture-gap, documentation and orphan-sidecar-test corrections remain in place, including explicit stopped-writers byte-preservation tests. F-06 (oversized member observation readback) and F-07 (combined member response size) were corrected in `e7afc3ef32933cb253c67c176d2c85b652cec611`. Head `4cf442510c29aa1387b1ce7e2de6716d926f5452` strengthens both regression populations so they actually exceed the relevant allowance. Both regressions and registered help for all six readers pass in the current CI.

The later **Independent Product Acceptance Review** at `a5e9ee8dadb34ddd68b1bc1a1642cfbac0d3938e` returned bounded Stage 3 **CONDITIONAL** and full E11 **NO-GO**. It could inspect source/workspace/CI but did **not** execute an independent installed host. Its *PA-F02* identified a real user-facing defect: `loom_insights` help still claimed that automatic reporting and scheduling were absent. Commit `55efdb41a2af69560cb623d47a9ec93b69e98ba9` corrected the registered help and five evaluation reader examples, and added a registered-callback regression that executes the public examples. This is distinct from the earlier cold-review F-02 SQLite issue.

### CI associated with the reviewed source

**Reviewed implementation/test head:** `4cf442510c29aa1387b1ce7e2de6716d926f5452` (OpenCode 2.2.6, Bun 1.4.2). All seven workflows associated with this head passed. The installed Stage 3 workflow checks out and asserts this **exact PR source head**. The other six workflow logs identify GitHub's merge composition `b85b22564c4734628f391c4a2c8478da9d95b490`, combining that source with base `b235ed712b471fd25fc9b0ec12eb805f0e5ad4be`. These implementation-owner CI receipts are separate from independent installed execution. Only the external model provider is scripted; no paid/live-provider or genuine Evaluator claim follows.

| Workflow associated with reviewed head | Verified result |
| --- | --- |
| [Plugin CI](https://github.com/bateau84/loom/actions/runs/43715516610) | PASS: repository/fixture typechecks, 387 core, 430 native across 53 files, six Code Mode and 241 Python tests, production bundle |
| [Installed Stage 3 mechanics](https://github.com/bateau84/loom/actions/runs/43715516589) | **PASS: eleven bounded installed-product checks, including SIGKILL recovery** |
| [Installed V2 routing](https://github.com/bateau84/loom/actions/runs/43715516631) | PASS |
| [Installed questions and Stage 1/2](https://github.com/bateau84/loom/actions/runs/43715516632) | PASS |
| [Installed boot/trust](https://github.com/bateau84/loom/actions/runs/43715516788) | PASS |
| [Installed routing guard](https://github.com/bateau84/loom/actions/runs/43715516602) | PASS |
| [Learning qualification workspace](https://github.com/bateau84/loom/actions/runs/43715516619) | PASS |

The installed candidate produced original native evidence, triggered background processing, published source-linked reports, and preserved historical authored R1/A → finding → correction B → partial R2 with exact recheck scope. It denied foreign and revoked readers, caught up previously blocked sources after a separate host restart, created attributable later revisions, respected capture-off and made no unqualified model or instruction mutation call.

A new **stopped-writers backup/restore** check closed both databases, froze the actual source files *after* native shutdown, verified original/backup/restored file hashes and manifest, then booted an isolated restored host. The original report and R2 finding relationship were recovered through public Loom tools; foreign and revoked reads stayed denied.

A separate installed **large-population acceptance** created 501 authored objectives through native Loom APIs from one original ledger record with capture off. Automatic cold-start catch-up processed **502 frozen members** and reported **1,003 unique source references**. Public member and source pagination covered every item without fabricating 501 independent originating requests. No direct evaluator call, fake batch injection or manual report creation was used.

A follow-up evidence review at `af152bd94156d3c489d01c72e198ff3bea2d8e67` identified the strongest remaining false-confidence case: a crash with a nonempty but incomplete committed member population. The installed harness now starts the actual packed OpenCode host, polls committed checkpoint receipts using a coherent read-only SQLite snapshot, **SIGKILLs the real server process after a committed checkpoint**, and restarts in a separate process. Current [run 43715516589](https://github.com/bateau84/loom/actions/runs/43715516589) observed one checkpoint and verified the same frozen 502-member batch identity and checkpoint receipt, completion of all 502 members, exactly one logical batch and one overall publication, and authorized public reconstruction of all 1,003 original sources. A newly authored source after the crash appears in a later report descended from that frozen boundary; actual Code Mode readback events may produce additional intervening versions, so the check verifies their immutable predecessor chain and complete source pages rather than asserting one invocation equals one record. These are real installed-host observations, **not** a simulated kill or a directly invoked processor.

The CI section of the [machine-readable status](learning-automatic-stage3-redo-status.json) records these implementation-owner run identities and their scope. Its separate final-qualification section records the independent execution and GO below; CI receipts alone do not constitute that approval.

### Independent final installed qualification

The [independent qualification record](learning-stage3-independent-qualification.json) contains the exact commands, versions, package/host/runtime hashes, native audit hashes, individual observations and scope decision. This was a follow-up assessment with prior review context available. Independent execution used a fresh checkout and new npm installations, isolated home/configuration/cache/state, native Sessions and databases. It reused neither implementation-owner database state nor CI receipts as execution evidence. It ran on the review workspace's Linux host, without claiming different physical hardware.

The tested plugin was `loom-plugin@2.0.0-alpha.1`, SDK `2.2.6`, packed from clean source `4cf4425`. OpenCode was unmodified `2.2.6`; local verification used Bun `1.4.2`, Node `24.22.1` and Python `3.12.14`. All 37 production runtime files matched the installed package. The package SHA-256 was `d40bc20c3068e46892eb8c4695bc7c0a6beab23be7e49ed719dfc129ada78d17`. Only the external model provider was scripted. Source creation, scheduling, persistence and public readback used real production owners and native host interfaces.

| Independent proof | Observed outcome |
| --- | --- |
| Existing installed Stage 3 suite | **11/11 PASS**, including automatic discovery, historical R1/A and partial R2/B, capture-off, blocked-source restart, stopped-state restore and authorized readback |
| Forced termination | Actual SIGKILL, exit `-9`, after **1 committed checkpoint**; the same **502-member** frozen batch recovered all members and **1,003 original source references**, retaining the checkpoint and producing **one logical batch / one overall publication** |
| Later evidence during recovery | Original membership stayed frozen; the late source appeared in a later revision whose ancestry reaches the recovered batch. This independent run observed 1,151 later source references and 15 intervening revisions; these counts are run-specific native observations |
| F-06: oversized observations | **271,991-character** stored member body; all **32 observations** reconstructed exactly through two `evaluation-observations` pages of **257,285 / 15,229** canonical characters, with pinned report ID/checksum and no duplicates |
| F-07: combined member pages | All **9 members** reconstructed across **4 pages** of **252,363 / 250,579 / 249,485 / 44,225** canonical characters; eight individually fitting bodies totaled **907,544** characters, and three deferred bodies were reconstructed |
| Native page authorization | Foreign Session, wrong report ID and invalid cursor denied. Switching the same Session to a read-denied agent blocked observation/member/source pages with native permission-denial receipts; restoring permission recovered the same report |
| Damaged and missing originals | Separate stopped-host changes/deletions of isolated original relationship records withheld dependent observation and overall bodies. Untouched members remained readable; missing source identities were reported unavailable |
| Historical identity | Reads, permission changes, restarts and source loss preserved the tested report ID/checksum and exactly one publication |
| Ordinary boot and routing | Baseline / installed / restarted / removed states passed without model prompts. Unqualified routing enabled: **0 provider requests**; routing disabled control: **1 scripted request**, successful |
| Supporting production regressions | **70/70 native tests across 6 files**, including publication rollback, lost COMMIT acknowledgement, scheduler, all six registered readers, startup isolation and routing guards |

The supplemental [installed reader harness](../tests/installed_learning_stage3_readers.py) passed all **6 checks** in a separate final portable run. Native source generation used 100 historical WorkRefs and 80 authored findings, with capture disabled until startup catch-up. SQLite was observed read-only until explicit stopped-host original-source faults; no evaluation batch, checkpoint or report was injected. This is synthetic authored work, not a genuine 100-task engineering or Evaluator journey.

The existing Stage 3 native audit contains **5,485 receipts**, SHA-256 `5fd149d8c250a551b7b8cd0c15207bfc7e431f26d9e6acc587389c1fb4d27612`. The final supplemental audit contains **1,644 receipts**, SHA-256 `1431508b31eeb9b57939368f87a1138e28a4b1a6d91e5033b7a8ddf9aa724371`. The complete run bundle retains both audits, reports, host logs, readback pages, package and command record. Raw audit contents are synthetic test data; compact receipts are retained in the repository qualification record.

### Repeat the bounded installed checks

Use a clean checkout containing this qualification update. Keep all output outside the repository. These commands rerun its production candidate; the independent record above retains the exact historical `4cf4425` commands and artifacts.

```bash
qualification_dir=$(mktemp -d)
qualified_head=$(git rev-parse HEAD)
npm install --prefix "$qualification_dir/host" --no-audit --no-fund @opencode/cli@2.2.6 bun@1.4.2
PATH="$qualification_dir/host/node_modules/.bin:$PATH" bun install --frozen-lockfile
mkdir "$qualification_dir/package"
npm pack --json --pack-destination "$qualification_dir/package" > "$qualification_dir/package/pack.json"
npm install --prefix "$qualification_dir/install" --no-audit --no-fund "$qualification_dir/package/loom-plugin-2.0.0-alpha.1.tgz"
python3 tests/installed_learning_stage3.py \
  --repository "$PWD" --expect-head "$qualified_head" \
  --opencode "$qualification_dir/host/node_modules/.bin/opencode" \
  --plugin "$qualification_dir/install/node_modules/loom-plugin" \
  --artifact "$qualification_dir/package/loom-plugin-2.0.0-alpha.1.tgz" \
  --report-directory "$qualification_dir/stage3"
python3 tests/installed_learning_stage3_readers.py \
  --repository "$PWD" --expect-head "$qualified_head" \
  --opencode "$qualification_dir/host/node_modules/.bin/opencode" \
  --plugin "$qualification_dir/install/node_modules/loom-plugin" \
  --artifact "$qualification_dir/package/loom-plugin-2.0.0-alpha.1.tgz" \
  --report-directory "$qualification_dir/readers"
```

Expected results are exit 0 and `status: "PASS"` in both `stage3/report.json` (11 checks) and `readers/report.json` (6 checks), with finalized `audit.ndjson` files whose hashes match the reports. Reader artifacts also include complete observation/member pages and damaged/missing-source readbacks. The reader harness retains its disposable private state for inspection. These commands neither call a live model nor qualify E11.

### Why bounded Stage 3 may ship separately

The [accepted implementation specification](learning-native-evidence-spec.md) identifies E11 as a future assembled acceptance target. The [product-authority statement at the reviewed revision](https://github.com/bateau84/loom/blob/4cf442510c29aa1387b1ce7e2de6716d926f5452/docs/requirements/learning-retrospectives/index.md#product-authority-compatibility-and-unresolved-decisions) permits capture and authorized descriptive reporting at the existing bounded level while operator/host dependencies remain open. The evidence-limits section of the [accepted architecture](learning-evidence-and-review-scope.md) explicitly separates useful descriptive automation from trusted independence and experiment authority. The new independent evidence closes the qualification hold for that safe subset; it does not redefine those future promises or grant merge authority.

### Product limits that remain

This bounded implementation intentionally produces deterministic descriptions, not genuine Evaluator judgments. It does **not** establish actual native Reviewer admission, same-invocation supplied/retrieved source exposure (Q4), enforced protected incoming transfer (Q5), complete multi-Session/100-task E11 synthesis, included-only model entitlement/billing, or direct human provenance. Structured protected delivery remains withheld; no fallback or simulated native receipt may be used to mark E11 complete.

The installed run now exercises blocked permission, graceful host restart, complete stopped-state restore, source revalidation, large-population chunking **and forced SIGKILL after one committed checkpoint before overall publication**. This does **not** prove every interruption boundary (including during atomic overall publication), power-loss durability, cross-database atomicity or external-effect reconciliation. A complete E11 acceptance claim remains **NO-GO / UNPROVEN** until upstream and operator gates are qualified and a genuine authorized Evaluator journey is executed.
