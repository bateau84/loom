# Reliability and simplification

**Status:** proposed for independent review; no implementation or runtime proof claimed.
**Authority:** [accepted Anchor](../../anchors/loom-reliability/anchor.md), commit `54e0c23543958640d763b5019c5f1d78b0c5b191`.

## Normative homes

| Artifact | Unique commitment |
| --- | --- |
| [BR-001](requirements/br-001-continuation.md) | Productive continuation, genuine waits and bounded resources |
| [BR-002](requirements/br-002-decisions-and-switching.md) | Asked/unasked amendment, abandonment and switching |
| [BR-003](requirements/br-003-demonstrable-simplification.md) | One Plan contract and independent simplification proof |
| [OC-001](obligation-contracts/oc-001-consistent-applicability.md) | Same tuple, same applicability at every boundary |
| [OC-002](obligation-contracts/oc-002-answer-access-and-use.md) | Direct information access distinct from transport and use |
| [OC-003](obligation-contracts/oc-003-original-facts-and-judgments.md) | Original truth, independent judgments, uncertainty and ownership |
| [QS-001](quality-scenarios/qs-001-production-inaccessible-verification.md) | Production-inaccessible verification before imports/setup |
| [QS-002](quality-scenarios/qs-002-controlled-upgrade-and-manual-recovery.md) | Pre-upgrade protection and plugin-independent release recovery |

Anchor guarantees are sourced; tuple relevance, finite continuation traces and stale-event treatment are ordinary Specifier choices making them falsifiable. No schemas, store selection or automatic prose interpretation are specified. Architect owns realization/preservation mechanisms; Designer owns human-facing journeys. No blocking peer question is needed to import settled Anchor meaning.

## Challenge to existing obligations

This bundle is the proposed controlling refinement for this milestone, not a global rewrite of unrelated authority. Earlier BR-021's holistic context, source ownership and independent Plan review remain meaningful. Its second model-authored executable Task contract, fresh-generation-only restriction for changed completed semantics, rich-snapshot adoption flags, exact tool names and fixed hierarchy shape are not constraints here: original consumed context stays immutable while current applicability is reassessed. One authoritative Plan-to-execution contract replaces duplicated authorship (BR-003/OC-001).

BR-027's exact-original-work pause boundary, retained context and honest in-flight state are preserved (BR-002/OC-003). Successful side-work completion is not required to return from cancelled B to A. The earlier question-consumer OC's per-consumer treatment remains; blanket clearing on reopen must not substitute for checking actual answer/consumer/input identity (OC-002). BR-008's real limits and no fabricated success remain; repeated routine prompts caused by internal bookkeeping are not genuine resource waits (BR-001). Upgrade documentation's transactional step recovery is not release-level restoration proof (QS-002).

These are documentary challenges, not reproduced code defects. Missing original proof may require new verification, not fictitious receipts or unrelated producer reexecution. Existing review-repair independence remains (OC-003). Internal-format compatibility is not required; attributable recoverable historical facts are.

## Decisive probes and trace coverage

External PR #168's catalogue at baseline `7f0ddd14` is input, not authority. Select discriminating traces rather than all permutations:

| Probe | Decisive observation | Obligations / catalogue coverage |
| --- | --- | --- |
| P1 | Finish A/B; unrelated-session commit plus controlled shared-file handoff; split C; restart; failed review/repair/independent re-review; routine permission resolution; finish Objective. Preserve applicable A/B; reject mixed-file authorship and self-approval. | BR-001/003, OC-001/003; Anchor journey 1; J11–15, J17–18, J23, J26 |
| P2 | Amend an unasked rejected question; separately amend an asked one retaining original provenance; abandon unanswered intent and perform different same-conversation work without fake acceptance. | BR-002, OC-002/003; Anchor journey 2; J02, J05 |
| P3 | Pause A with uncertain admitted effect; begin B, cancel B, return to A; late callback/duplicate notifications cannot authorize duplicate effects or B completion. | BR-001/002, OC-003; Anchor journey 3; J19–23 |
| P4 | One answer, two consumers, suppressed notifications and restart: direct original answer/evidence access; first finishes while second is pending; changed answer reassesses affected use. | OC-001/002; J07–09 |
| P5 | Required role unavailable or finite Plan's known minimum demand exceeds authorization: owned wait before admission, no substitution/overspend; remedy resumes original goal. | BR-001; J04, J06, J16, J24–25 |
| P6 | Attempt protected-state access at startup/import/setup/descendant and misdirected paths; independent restrictions prevent access. Synthetic sentinel only, no production oracle. | QS-001; Anchor journey 4; R14–15 |
| P7 | Verified complete recovery point; failure before commit, after earlier committed step, and defective plugin import; offline/manual restore with compatible code/fencing. Add newer work and interrupted restore; reject silent loss/mixed generations. | QS-002, OC-003; Anchor journey 4; R01–13, R16 |
| P8 | Compare fact ownership/write paths before/after; discard/rebuild projections; all boundaries agree without second authored Task contract. | BR-003, OC-001; independent simplification gate |

Record manual state repairs, unnecessary reruns/dispatches, contradictory decisions, Loom-caused blocks, unresolved operation outcomes and removed duplicate decisions. Required traces have zero manual state reconstruction, fabricated receipts, artificial recovery transitions or repeated routine continuation prompts. Genuine user decisions, external waits, resource authorization and newly necessary verification are classified separately. No latency SLA, exhaustive state-space proof or all-permutation requirement is invented.

Remaining coverage limits: coordinator takeover, every host-specific effect observer, corruption combination and scheduling permutation are not individually established. Architect/Planner must refine consequential realization seams without treating uncovered cases as guarantee exclusions. Reading documentary/source hypotheses cannot establish real host, backup, restore or journey behavior.

## Designer seam reconciliation

Read the parallel [continuity experience](../../design/loom-reliability/continuity-experience.md) through OKF on 2026-10-09. Its four journeys agree with this layer: completed-then versus usable-now versus independently-reviewed; exact pause admission boundary distinct from external quiescence; cancel B/return A without fake success; answer transport distinct from consumer treatment; pre-upgrade protection and plugin-independent consequence-aware recovery. Designer's summaries/confirmations are presentation, not extra authority. No observable contradiction or user-reserved meaning gap was found in this bounded comparison. Both remain proposed for independent requirements/design review; Architect must establish mechanisms and later assembled proof remains unperformed.

## Phase boundary

Reviewed authority and an independently reviewed holistic delivery Plan only; no implementation, adapter completion, live state reads, host tests, plugin imports, engines or production operations. Budget OQ `d0334518-1ed9-4d30-a976-059044f488c6` supplies at most eight initial potentially paid specialist dispatches; this is dispatch 2 with no retries, extras or paid children.
