# Automatic AOS learning — behavioral requirements

**Status:** Draft requirements authored against the user-accepted architecture in [PR #233](https://github.com/bateau84/loom/pull/233), for independent requirements assessment. No requirements are claimed implemented. The concept's independent architecture GO does not constitute implementation or requirements acceptance.

## Intended behavior

Loom should record permitted work evidence with the correct Session, agent, dispatch and historical Task scope, so a later Reviewer knows what it really assessed—even when one review covers 100 tasks or multiple Sessions. While engineering proceeds, Loom should opportunistically process new evidence, retain attributable provisional reports, and build **whole-objective and multi-Session retrospectives** automatically. The overall history matters more than local Task success claims.

Example: 100 mixed engineering tasks produce artifact A. Reviewer R1 receives a frozen, authorized request and reviews actual material, reporting defects associated with two distinct attempts. A corrective dispatch produces B; R2 reviews only part of B. The later retrospective can reconstruct R1's real evidence basis, R2's partial coverage, the correction and eventual outcome without counting 100 Task completions as 100 successful objectives. Denied Session evidence remains denied in derived reports.

There is **no automatic skill/agent/directive mutation**, no built-in directive evaluation, no unqualified independent-objective claims, and no automatic unapproved full-content capture or paid model fallback. The operating conditions for protected source retention, report declassification and model budgets remain explicit operator decisions.

## Behavioral Requirements

- [BR-001 — Preserve execution attribution](br-001-preserve-execution-attribution.md)
- [BR-002 — Preserve historical work scopes](br-002-preserve-historical-work-scopes.md)
- [BR-003 — Preserve requested review subjects](br-003-preserve-review-requested-subjects.md)
- [BR-004 — Preserve actual review basis and qualified findings](br-004-preserve-review-basis-and-verdict.md)
- [BR-005 — Expose source evidence and coverage gaps](br-005-expose-source-evidence-and-gaps.md)
- [BR-006 — Evaluate accumulated work automatically](br-006-run-evaluation-automatically.md)
- [BR-007 — Prioritize whole-work and longitudinal learning](br-007-prioritize-whole-work-learning.md)
- [BR-008 — Persist revisable evaluation history](br-008-persist-revisable-evaluation-history.md)
- [BR-009 — Present controlled system-improvement recommendations](br-009-present-controlled-system-improvements.md)

## Quality Scenarios

- [QS-001 — Concurrent execution attribution](qs-001-concurrent-execution-attribution.md)
- [QS-002 — Recover interrupted evaluation batches](qs-002-recover-interrupted-batches.md)
- [QS-003 — Synthesize large frozen populations without omission](qs-003-synthesize-large-frozen-populations.md)
- [QS-004 — Protect derived reports under restricted source access](qs-004-protect-derived-reports.md)
- [QS-005 — Bound optional automatic analysis](qs-005-bound-background-analysis.md)

## Obligation Contracts

- [OC-001 — Host observation and dispatch provenance](oc-001-host-observation-and-dispatch-provenance.md)
- [OC-002 — Review admission and effective evidence basis](oc-002-review-admission-and-evidence-basis.md)
- [OC-003 — Protected source and derived-report access](oc-003-protected-source-and-derived-report-access.md)
- [OC-004 — Evaluation processing and publication meaning](oc-004-evaluation-processing-and-publication.md)

- [Change log](log.md)

## E1–E14 architecture acceptance coverage

These map to the [approved concept's E1–E14 proposals](../../learning-evidence-and-review-scope.md). They are **future assembled-product verification duties**, not tests executed by this requirements commit.

| Scenario | Governing requirements | Key observation |
| --- | --- | --- |
| E1 | BR-001, OC-001, QS-001 | Correct concurrent/nested and reused-dispatch attribution |
| E2 | BR-002, QS-001 | A late result preserves original work scope |
| E3 | BR-005, OC-003 | Retrieval and explicit gaps under distinct capture authorization |
| E4 | BR-003, OC-002, QS-003 | Frozen authorized review membership across 1/10/100 tasks |
| E5 | BR-002, BR-004 | R1's A contract and R2's partial B contract remain separate |
| E6 | BR-004, OC-002 | Review author, subjects and access receipts are distinct |
| E7 | BR-008, OC-004 | Later contradictory review revises interpretation, not source |
| E8 | BR-007 | One linked objective with failed corrections, not three successes |
| E9 | BR-008, OC-004, QS-002, QS-003 | Frozen over-limit batch resumes without missing/duplicate members |
| E10 | BR-006, QS-002 | Failure/interruptions without idle still enter backlog |
| **E11** | **BR-001–BR-009; OC-001–OC-004; QS-001–QS-005** | **Real assembled 100-task → native R1 → corrected B → partial R2 → automatic multi-Session evaluation → restart/authorized public read** |
| E12 | BR-007, BR-009 | Overall analysis challenges misleading local positives |
| E13 | BR-006, QS-005 | Disabled/denied/quota-limited automation cannot disable ordinary work |
| E14 | BR-005, BR-008, OC-003, OC-004, QS-002, QS-004 | Restored sources, checkpoints and report readership retain their qualification |

**E11 false-confidence control:** The same admitted R1 invocation must be associated with (1) the frozen requested manifest and artifact revision, (2) the actual source material supplied, and (3) the authorized sources actually accessed. A prompt containing only a manifest reference plus synthetic citations **cannot** prove retrieval. The reconstructed report distinguishes requested, supplied, retrieved, cited and claimed-inspected states; an unauthorized otherwise-valid Session must not access an unrestricted derived report.

## Product authority, compatibility and unresolved decisions

- **Accepted user intent:** accurate evidence and review-scope attribution; automatic processing; broad whole-work evaluation; durable checkpointed history; evidence-backed, user-gated improvements.
- **Approved architecture reference:** [Review-scoped evidence and whole-work retrospectives](../../learning-evidence-and-review-scope.md) and [issue #227](https://github.com/bateau84/loom/issues/227). Implementation details in that document constrain downstream realization but do not invent extra product obligations.
- **Existing system boundaries:** Current Loom has partial bounded capture, exact historical `WorkRef` support, objective readers and independently scoped reviews, but no automatic retrospective engine or general full-content retention.
- **Operator decisions still open:** eligible protected-payload collection classes, retention/deletion defaults, derived-report disclosure/declassification authority, qualified model-route authorization and spending/resource limits. These are NOT assigned defaults here. Capture and authorized descriptive reporting may be delivered at their existing bounded level without misrepresenting missing content.
- **Native host qualification still open:** exact normal-subagent invocation binding, opaque nested operations, reliable automatic access to original histories across compaction, trusted originating-request independence and final-provider exposure; weak signals cannot be upgraded to proof.
- **Out of scope:** agent-directive evaluation, experiments, instruction mutation, automatic canonical promotion, replacing Loom's orchestrator, arbitrary new SQL schemas, a mandatory per-Task review gate and blanket claims of model comprehension/causal skill effects.

## Next verification and handoff

1. Independent requirements Assessment/QA: verify source authority, no invented product policy, cross-document consistency, falsifiability, correct E1–E14 coverage, and actual compatibility with current Loom.
2. Resolve only material operator-owned decisions before implementing the dependent capture/disclosure/model-spending features; unaffected bounded work may proceed.
3. Produce the implementation-facing design/spec and a dependency-aware delivery plan from accepted BR/QS/OC semantics, reusing the current Store/Observer, historical WorkRefs, objectives and review tools.
4. Qualify and execute the installed E11 chain through actual product-owned capture, admission, evidence-access, evaluation, persistence, recovery and readback. Scripted local providers prove mechanics only; genuine authorized model work qualifies reasoning quality.
