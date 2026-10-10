---
type: discovery
title: Continuity Journeys, Liveness Probes and Operator Recovery Tests
description: Incident-derived complete-user-journey test obligations for the proposed Changing Course Without Losing Progress milestone.
tags: [loom, discovery, testing, liveness, fault-injection, isolation, recovery]
---

# Continuity journeys and adversarial probes

**Status:** candidate acceptance matrix for discovery and specialist assessment; no tests run and no production state accessed.  
**Source baseline:** `functionality-anchor-requirements-coherance@7f0ddd14a5c970e39b2778ecb341b872b406865d`, 2026-10-09.  
**Companion:** [Foundational discovery and architectural alternatives](change-without-losing-progress.md).  
**Boundary:** independent of the unfinished OCI adapter, staged adapter files and current active session. No implementation, installation changes, approvals or changes to accepted authority are implied.

## Test the actual progress graph

A Loom execution graph may be acyclic while the *real progress graph* still has circular dependencies. Explore the composition:

`accepted intent/Plan + current attempt + user decisions/OQs + role/attachment + permission/effect scope + budget + evidence applicability + reviews + Git/host operation outcomes + installation state`.

Every probe requires at least **two** independently owned boundaries. Unit tests for individual tools are useful but cannot establish that a legitimate downstream consumer can finish.

A bounded model can start with these axes:

| Axis | Representative states |
| --- | --- |
| Intent | interviewing, draft-ready, accepted, abandoned/superseded |
| Workflow | active, paused, blocked/waiting, cancelled, completed/archived |
| Task attempt | pending, admitted, executing, completed, failed/blocked, interrupted, outcome unknown |
| OQ | absent, unanswered, answered but not incorporated, incorporated/deferred, obsolete |
| Review | pending, passed for exact version, failed, stale, independent-re-review required |
| Permission | eligible, approval required, denied, effects unknown |
| Budget | available, preflight insufficient, depleted with progress, depleted without progress |
| State-store/install | healthy, upgrading, older writer, failed upgrade, unsupported newer schema, plugin fails to start |
| External effect | no operation, admitted-but-unobserved, completed, failed, still-running, remote-unknown |

This cross-product is **not** an assertion that every combination is reachable. Enumerate reachable transitions, verify both local safety and eventual ability to continue/exit, and minimize counterexamples. Test interleavings and stale callbacks, not simply dependency cycle checks.

### Outcome vocabulary and judgement

- **Real success:** finished required user outcome with accepted proof and independently required review.
- **Successful continuation:** unfinished goal remains recoverably runnable with applicable previous work intact.
- **Genuine wait:** specific external/user authority or resource required, with exact owner, missing condition, and resume trigger.
- **Safe terminal exit:** explicit user-abandon/cancel path, work preserved, no invented completion or quiescence.
- **Failure:** valid task lost, unnecessary rerun, denied with no meaningful path, circular prerequisite, fabricated PASS, unobserved effects retried, unauthorized effect, or real installation state touched by test.
- **Not sufficient:** a cancel button when feasible continuation exists; an explanatory next-action facade that issues another tool denial; mock-only “success”; or a suite that reproduces the same implementation predicate in its expected result.

## Core representative journeys (candidate must-pass acceptance)

| ID | Starting user workflow + perturbation | Observable pass criterion | Principal competing authority |
| --- | --- | --- | --- |
| J01 | Ask an ordinary code/research question while another governed workflow exists | Authorized inspection succeeds without converting the question into a new product Objective | Conversation binding vs task admission |
| J02 | Begin fuzzy intent; open user question; abandon it; start unrelated bounded change | Interview superseded without accepting unwanted Anchor; new work admitted in same conversation | Intent state vs session rebinding |
| J03 | Start small bug fix; discover structural/product significance; promote into accepted Objective | Explicit user authority acquired where needed; original evidence retained; no fake completion or mandatory cancellation | Request-depth restriction vs Objective identity |
| J04 | Request reviewed Plan **only**; no implementation | Plan reviewed and returned, Objective remains incomplete; future Task paths checked honestly | Plan review vs execution DAG |
| J05 | Compile user-owned decision wait; Reviewer rejects its wording before presentation; Planner changes it | Old unasked wait safely superseded; revised question presented only after appropriate review; no answer of obsolete question needed | Plan edit vs waiting Step vs OQ admission |
| J06 | Plan a mandatory specialist contribution with currently unavailable host role | Missing path recognized before an unusable Plan is treated as admitted; preserve unrelated work | Static role registry vs live host roster |
| J07 | Brainstorm produces advice; it is reviewed; receiver consumes and resolves exact advice | Original digest/evidence directly visible to authorized receiver; no OQ-as-transport | Advisory result vs receiver authority |
| J08 | Answer technical OQ; two authorized consumers need it | Both read the same existing answer/evidence directly; each records treatment when necessary; missed notification does not hide answer | OQ persistence vs notifications |
| J09 | An OQ responder discovers a second dependent question; attempted cycle between owners | Exact blocked owner/decision identified; cycle is not disguised as “waiting for another dispatch” | OQ consumer graph vs routing |
| J10 | During implementation, a late fault needs investigation; diagnostic evidence arrives | Investigation uses scoped safe effects; owning producer can repair without unrelated routing reset | Diagnostic authority vs current execution stage |
| J11 | Reviewer fails bounded implementation; repairer fixes; independent re-review passes | Authorship preserved, no self-approval, no need to recreate whole Plan | Reviewer evidence vs repair vs gate receipt |
| J12 | A/B completed; another session commits unrelated files; C changes responsibilities and splits Wave | Applicable original attempts for A/B remain consumable after review; no Worker reruns solely due to unrelated HEAD | Work result vs Git/global HEAD vs recompile |
| J13 | Change B's **actual** accepted obligation or input consumed by A | Inapplicable results not reused; reason names actual changed contract/input; original history remains | Semantic applicability vs immutable attempt |
| J14 | Rename Wave, reword objective, reorder unrelated future Tasks | Preserve unaffected results, gates whose reviewed scope truly remains identical, and exact provenance | Broad fingerprint vs material semantics |
| J15 | Replace a completed producer's dependency after another consumer used it | Affected consumers become stale and must be revalidated; unaffected consumers continue | Dependency closure vs review version |
| J16 | Admit a 24-Task mixed-role Wave with ≥52 required dispatches under default 40 | Detect insufficient automatic capacity before beginning; present bounded alternative or genuine resource authorization, not repeated surprise stops | Compiled graph vs budget |
| J17 | Role owns an OQ requiring a permitted verification command | Command effects evaluated against exact OQ attempt or authorized target; a Step-only grant is not an artificial prerequisite | Capability admission vs OQ attachment |
| J18 | Two sessions modify the same file and share Git index; each attempts commit | No false byte authorship or accidental inclusion of other's changes; explicit isolation/handoff/concurrency resolution | File scope vs staging vs actual Git index |
| J19 | Valid local commit then remote push response is lost | Local commit retained; inspect remote before retry; “unknown” is never published-as-success | Operation outcome vs publication |
| J20 | A active; user pauses A, starts B, cancels B, resumes A | A's rights/records preserved; B cancellation does not require dummy success; in-flight A effects remain visible | Binding vs lifecycle vs operation state |
| J21 | Original General session disappears; user restores A through a new authorized coordinator | Fenced ownership transfer, no replayed admission; exact prior proof preserved | Session ownership vs disaster recovery |
| J22 | Start an external host operation, lose the parent response, then pause/cancel | No new A operations; existing operation remains explicitly running/unknown until observed; no unsafe replay | Cancellation vs host quiescence |
| J23 | Child finishes while parent dies before observing its completion; duplicate notifications arrive later | Exactly one completion/consumer transition, no duplicate execution and no fabricated result | Attempt receipts vs delivery |
| J24 | Running workflow exhausts a bounded retry budget, but new evidence materially changes strategy | Real bounded continuation or explicit resource wait; no unlimited hidden retries | Progress evidence vs budget counters |
| J25 | Implementation done, documentation/OKF verification unavailable | Implementation receipts persist; workflow honestly records unfinished dependent gate, with owner and resume path | Attempt outcome vs Task/Objective satisfaction |
| J26 | Full Objective completed after unrelated revisions, failed review, pause and user answer | Independent Product Acceptance and completion use current evidence only, no old gate PASS laundering | Task/Wave/Objective rollups vs accepted product |

**Source-based examples to reproduce:** `work.ts` `invalidateTaskResult` and `inspectTaskSemanticClosure`, `workflow.ts` `applyTaskPlan`, `index.ts` `reusableCompletedTaskIds` and `loom_work_reconcile`, `oq.ts` `reconcileQuestion`, `lifecycle.ts` `cancelWorkflow`, `runtime.ts` writer/version fences. See [source map](change-without-losing-progress.md#source-anchors-pinned-to-this-baseline). These are candidates, not claims that every J-ID currently fails.

## Adversarial installation, rollback and manual recovery journeys

Each scenario must run against **synthetic state roots** and isolated OS/OCI environments only. No copying, opening, or mounting the user's live `execution-state.sqlite`, Git metadata, credentials, or installed configuration.

| ID | Injected failure | Expected result and decisive proof |
| --- | --- | --- |
| R01 | A registered schema migration callback throws before transaction commit | Prior database state and schema version unchanged; no durable success receipt; correct subsequent retry |
| R02 | Kill process during `BEGIN IMMEDIATE` transaction, before commit | SQLite recovery returns pre-transaction state; no half-updated Task/review/ledger |
| R03 | Kill process after one committed version step but before next one | Earlier committed steps remain exact and idempotent; restart resumes from durable ledger, not from guessed memory |
| R04 | Old build attempts write after new build advanced shared schema | Old writer fails closed without losing legitimate already-committed newer work |
| R05 | An incompatible new build attempts an old store; missing migration path | Clear diagnostic and read-only option; no speculative format rewrite |
| R06 | A new build successfully migrates but later proves defective | Operator can distinguish **code rollback** from **data rollback**, preview possible post-upgrade data loss, and safely choose forward repair or verified snapshot restoration |
| R07 | Plugin import crashes before tools register | Offline standalone inspector remains usable without importing broken plugin or starting migration |
| R08 | Main SQLite file copied without WAL, then restored | Negative test rejects incomplete/uncertain backup; correct SQLite backup mechanism yields restorable integrity |
| R09 | Bad main DB/WAL or incorrect project marker | Quarantine/diagnostic state; no synthesized proofs, foreign project adoption or automatic deletion |
| R10 | Disk full or permission denied during backup/restore | Original remains intact; no partial switch, clear operator remedy |
| R11 | Restoration stops between staging and activation | Recover from an explicit phase/receipt; repeated operator invocation does not combine incompatible generations |
| R12 | Previously admitted external tool may still be running during restore | Disclose uncertainty; fence new admission, do not claim quiescence, avoid replay or double publication |
| R13 | Restore valid pre-upgrade snapshot after new-version legitimate writes happened | Prevent silent rollback of user work; require explicit impact/delta analysis and operator consent |
| R14 | Adversarial test run contains ambient HOME/XDG, host state mount, symlink escape, unexpected network or engine socket | Refuse before launching any code; independent production-state canary unchanged |
| R15 | OCI/rootless runtime unavailable or selected offline image missing | Honest capability wait; no implicit pull, ambient host execution fallback or mislabelled integration PASS |
| R16 | Runtime restored but evidence/Plan/Step receipts inconsistent | Recovery leaves completion/acceptance unproven; precise affected records and reviewed resumption path |

**Existing proof to preserve:** `runtime.ts` uses SQLite WAL, transactional storage and installation-wide upgrade ledger; `scripts/run-unit-tests.py` creates private process roots; `test-isolation.ts` checks those roots and explicitly does not offer OS containment. Full operational recovery and completed-upgrade rollback have **not** been demonstrated by reading those sources.

## Test realization layers and admission

| Level | Permitted during discovery | Required isolation/positive evidence | What success does NOT prove |
| --- | --- | --- | --- |
| S0 — static and model | Read-only source/model analysis | Pinned source ref; no plugin import or product state | Real host hook composition |
| S1 — private synthetic process | Optional when exact test source is reviewed | Fresh process-private HOME/XDG/LOOM paths, synthetic database, no real project marker, no listeners; witness of selected root | Kernel-level containment |
| S2 — OCI offline | Optional after separate safety review | Rootless disposable container, finite copied inputs, no host mounts, credentials, socket, network or Git state; no implicit pulls; immutable image/source identity | That normal installed OpenCode behaves identically |
| S3 — fresh real OpenCode | Later proof stage; not required to begin discovery | Disposable host/config/project and isolated state; exact plugin/host build attestation and deliberate test credentials only | Safety of doing the same against production state |
| S4 — real user installation | **Excluded from discovery** | Separate authorization and operational safety plan required | Never used for discovery claims |

Failure to establish isolation is a **hard test preflight denial**, not permission to fall back to ambient commands. The existing OCI adapter remains a separately unfinished candidate. Do not add adapter-specific implementation tasks to this discovery PR.

## Cross-component assertions (test oracle)

For each J/R case record:

1. **Input identity:** accepted contract revision, relevant artifacts/bytes, agent roles, authority boundaries and disposable runtime identity.
2. **Actor/action:** which actual agent or user owns the transition and which granted capability was used.
3. **Observed fact:** actual host event, original attempt/evidence, review receipt, Git/remote state, backup integrity or explicit unknown; *not* a model's unsupported narrative.
4. **Admission decision:** what Loom allowed, denied or routed, and why. A read-only preview cannot be used as proof of permission.
5. **Preservation:** which results remained applicable, which were invalidated for real changes, and whether original history is still directly inspectable.
6. **Final journey outcome:** full completion, genuine wait, safe cancelled exit, or actionable defect. Classify false positive/negative transitions separately.
7. **Composition debt:** number of manual reconciliation/attach/dispatch tools, repeated prompts, unnecessary test/Worker reruns and extra review handoffs.
8. **Safety:** no fabricated PASS, effect scope violation, cross-session attribution, contamination of host state, or unobserved repeated remote mutation.

### Success targets for milestone acceptance

- All critical J01–J26 journeys demonstrate their specified behavior across relevant permutations; at least one integrated J12+J20+J11+J17+J26 journey must complete without operator state reconstruction.
- R01–R16 simulated recovery behavior is classified accurately; zero tests read or write real state; failed preflight never executes tests.
- A result accepted as applicable for a particular contract/input tuple remains consumable by every legitimate downstream consumer evaluating that same tuple.
- A physically missing original observation remains missing; independent review and user consent cannot be synthesized.
- No required journey depends on cancel-and-restart when the original work is safe and feasible to continue.
- Measure **actual simplification**: redundant record fields removed; fewer manually issued control-plane transitions; fewer special-case admission branches; no added “resolver” that duplicates independent decisions.

## Red-team probes for the architecture alternatives

Before selecting an architecture, ask each candidate to produce a finite trace for:

1. **State contradiction:** Task “complete” in one projection, “pending” in another after crash. Which *single fact* decides applicability without inventing evidence?
2. **Shared Git file:** two agents both wrote one file. Show why exact-file commit cannot prove per-agent byte authorship.
3. **Unanswered wait under Plan review:** which operation permits editing an unasked question without requiring its answer?
4. **Changed contract:** what input/version/authority invalidates exactly one Task and its consumers, preserving independent Tasks?
5. **Answer transport:** show one answer read by three authorized specialists with *zero additional questions*.
6. **Unknown remote effect:** describe safe resume after an unobserved push without duplicating publication.
7. **Multi-process upgrade:** kill one writer between old/new schema epochs; show no mixed admission.
8. **Broken plugin:** restore or inspect without loading the plugin or trusting the database field that failed to migrate.
9. **Reviewer independence:** same Reviewer repairs and then tries to independently PASS their own bytes; deny without trapping the whole goal.
10. **Budget minimum:** prove a valid DAG that needs more than configured dispatch capacity is flagged before starting, with an honest resource decision.

**A candidate design fails discovery if it can explain these cases only by extra model-authored reconstruction, synthetic evidence, manually editing SQLite, or adding another top-level orchestration authority with overlapping facts.**

## Open validation issues

- Which OpenCode host hooks can attest actual process/remote-operation termination, and which cannot?
- Can an effect-based executor be realized locally with bounded adapters for Git/files and a contained general-command mechanism without retaining a name-based deny policy?
- Which semantic fields and concrete artifacts contribute to a Task's relevant-input identity? Exclude descriptive cosmetic edits, but never underapproximate consumed external state.
- What is the minimum scope of independent review for advisory work vs authoritative handoff?
- How should exact-user authorization for recovery/intent changes be bound when the broken plugin cannot load?
- Which operator procedures require exclusive writer quiescence and which support inspection of a safe snapshot while writers exist?

The assigned specialists should treat these as falsifiable engineering questions, not approval requirements invented by this document.
