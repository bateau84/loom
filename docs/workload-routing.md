---
type: Architecture
title: Workload-aware model routing — Milestone A provider-free policy
description: Assignment-scoped tier decisions, conservative security floors, model-class reuse, and exact limits before native dispatch qualification.
tags: [loom, model-routing, workload, policy, safety]
timestamp: 2026-11-18T00:00:00Z
---

# Workload-aware model routing — policy-only candidate (#239)

**Status:** Milestone A **remediation candidate** in draft PR #240, after independent review NO-GO at `4a6ca197`. No native dispatch uses this planner. F-01 and F-04 are patched, F-02 has an explicit policy-only input contract, and F-03 adds durable saved-work candidate records; **protected native boundary admission remains UNPROVEN and is not being claimed as complete.** The production routing adapter remains disabled/unqualified for managed subscription routing. [#205](https://github.com/bateau84/loom/issues/205) and [#206](https://github.com/bateau84/loom/issues/206) remain blockers to activation even after [OpenCode 2.3.0 compatibility #238](https://github.com/bateau84/loom/pull/238) merged.

## Intent

Assign the smallest *eligible* model capability and reasoning tier for a bounded work assignment without multiplying native agent definitions or assuming that a low-cost model can satisfy consequential security/quality obligations. The caller can submit a difficulty preference, but cannot authorize paid usage, change tool permissions, waive independent review or certify provenance through this API.

The planner is pure. It does not register `experimental.model.resolve`, mutate native Sessions, create or resume a subagent, or consume quota. An **optional, explicit provider-free journal** can now persist candidate decisions against an existing saved Loom Action/plan selection; it is not registered in the production plugin. It calls the existing `planModelRoutes` with an exact work-specific policy; the old agent-only call continues unchanged. Even if the legacy route configuration includes `paid-fallback: true`, workload plans consider **included** inventory only. Inventory labels are supplied test data here, **not** actual billing proof.

## Configuration (optional; only for the pure planner)

The existing agent/role `model-class` and `reasoning` form **standard**. The optional `workload-tiers` map supports complete `advanced` and `frontier` entries. A tier absent from all applicable roles/agent overrides is **unavailable**, never replaced with a lower or unrelated model class. A given tier is resolved from an explicit agent override first, otherwise from one consistent inherited role value; conflicting role values fail validation. `null` removes a tier override from a config layer, revealing a lower-priority inherited value.

```yaml
agents:
  architect:
    roles: [architecture]
  critic:
    roles: [acceptance]
roles:
  architecture:
    model-class: standard-engineering
    reasoning: medium
    workload-tiers:
      advanced: {model-class: deep-engineering, reasoning: high}
      frontier: {model-class: frontier-engineering, reasoning: high}
  acceptance:
    model-class: standard-review
    reasoning: high
    minimum-tier: advanced
    workload-tiers:
      advanced: {model-class: deep-review, reasoning: high}
      frontier: {model-class: frontier-review, reasoning: high}
model-classes:
  standard-engineering: {models: [model-regular]}
  deep-engineering: {models: [model-deep]}
  frontier-engineering: {models: [model-frontier]}
  standard-review: {models: [model-review]}
  deep-review: {models: [model-review-deep]}
  frontier-review: {models: [model-review-frontier]}
```

These are illustrative names, not a current OpenCode model catalog or pricing recommendation. The existing model-class/provider ordering, explicit aliases and exact reasoning support are reused. **Workload planning requires an explicit supported reasoning variant** on each selected inventory row; absent capability evidence is ineligible even when legacy agent-only routing would accept it. `minimum-tier` is a conservative role/agent floor: agent overrides never lower inherited role floors.

## Assignment boundary and decision rules

`planWorkloadRoutes(config, agentId, inventory, assignment)` takes bounded `assignmentId`/`objectiveId`, a declared `boundary` (`new-assignment`, `safe-next-phase`, `continuation`), optional requested tier and reasoning, recognized risk factors, an explicit assessment, required quality constraints and an `included-only` spending envelope. The following are **caller-supplied policy inputs, not protected host provenance**:

- `assessment: {status: assessed|uncertain, confidence: high|medium|low, sourceRef}` — missing, uncertain or not-high-confidence assessments return `assessment-unverified`; an **assessed** empty risk list is distinct from missing evaluation. The source reference is a bounded correlation ID; its authenticity must be supplied by a future protected admission adapter.
- `quality: {minimumTier, minimumReasoning, independence: required|not-required}` — missing quality constraints return `quality-constraints-missing`. Their floors cannot be weakened by the requested tier or reasoning. Independence is an **unfulfilled verification obligation**, not a model-selection result.
- `requestedReasoning` raises required effort **within the selected tier/model class**, without forcing a different model class. Unsupported or missing evidence for that exact variant returns unavailable.
- `spending: included-only` is mandatory. Requests for paid usage cannot enter this policy-only route; the existing runtime billing guard remains blocked.



- **Standard:** existing role/agent policy, with no missing-tier fallback.
- **Advanced floor:** `complex`, `concurrency`, `persistence`, `recovery`.
- **Frontier floor:** `authority`, `containment`, `credentials`.

The selected tier is the maximum of the request, risk floor, work quality minimum, and all configured agent/role minimums. Reasoning is the maximum of the selected tier's configured reasoning, work quality minimum and requested reasoning. A cheap requested tier cannot lower a mandatory floor. Later independent assignments may choose a cheaper tier, but a `continuation` is **not** a safe new selection boundary and returns `unsafe-boundary`. These fixed risk classifications are conservative policy defaults for this prototype, **not** independently verified claims that a particular file touches an authority boundary. An eventual trusted work-admission boundary must supply real source and scope evidence rather than accepting a model's claims as authority.

The decision includes assignment/objective/agent, normalized risk factors, assessment status/source correlation, requested/resolved tier and reasoning, quality and independence obligations, policy-version digest, selection reasons, class/effort, and planned provider/model/**opaque accountID** if eligible. Its deterministic digest covers the account, so two different native accounts never share a fingerprint. The **complete emitted record including the digest** is UTF-8 bounded at **4,096 bytes**, with an exact boundary regression. The raw decision is reproducible, not host-attested. A second assignment ID does not prove an independent user objective; `objectiveId` is correlation data, not provenance.

### Optional restart-safe candidate journal (not wired to OpenCode)

`WorkloadDecisionJournal` in `src/workload-admission.ts` explicitly takes the existing Loom Action store and its shared SQLite connection. It binds a **candidate-only** record to the saved owner's Session focus, Action revision, current plan revision and selected plan node. The local SQLite transaction keeps source inspection and the first decision insert serialized. Duplicate candidate submission returns the exact stored record when identical; changed risk/model/account/quality/config, changed work identity or another assignment ID for the same scoped work is refused rather than silently updating the assigned model. Independent file-backed SQLite connections and process reopen retain the one candidate and the original source evidence. It does not change the Action database's `user_version`, add a producer to existing runtime hooks, or authorize a provider request.

- Only an explicit **new-assignment candidate for an existing current saved Action/plan node** is journalable. `continuation` and `safe-next-phase` are refused. A real safe phase boundary requires an **authoritative native execution fence** not available to this provider-free module; a self-declared boundary is insufficient.
- The SQLite schema is additive, opt-in and versioned separately. Partial schema, corrupted records, stale work revisions, wrong Session selection and conflicting reassessment fail visibly.
- The journal's work identity is stable across process restarts but **not proof of a human-originating independent objective**, protected Session admission, native side-effect safety, or account-backed entitlement. The saved Action focus remains a navigation fact, never a native authorization grant. All stored results have `status: candidate-only`.

A real native route cannot be created or resumed from the journal. Native boundary authentication, installed-host propagation and request-level identity belong to the separate #205/#206 qualification and #239 Milestone B; do not promote these candidates into execution authority.

## Known boundaries and remaining work

1. **Milestone A (candidate):** pure routing, strict configuration validation and opt-in saved-work candidate journal. Missing protected native work-origin/phase attestation is explicitly **UNPROVEN**, not a claim of complete Milestone A acceptance. No autonomous difficulty classifier, learned model-quality ranking, actual cost or live model request. Routing-disabled behavior remains untouched.
2. **Milestone B:** qualify `experimental.model.resolve` against exact installed 2.3.0. Its host implementation supports **same-provider** model/variant changes per request, but not provider swaps; native new-child model overrides are a separate authorization boundary. Prove actual chosen route, start/continuation/auxiliary behavior, restart/concurrency, unknown billing denial, and account/attempt binding through #205/#206 before activation.
3. **Milestone C:** compare quality and cost per **complete originating engineering objective**, including correction attempts, independent review, provider usage, outcomes and human intervention, before adjusting automatic thresholds or rankings.

A plain plugin hook, self-declared risk label, model catalog, route hash or synthetic quota attestation cannot independently certify spending or task correctness. Provider-enforced no-paid limits, loaded-plugin failure boundaries, protected role permissions and independent review remain separate requirements.

## Verification boundary

The provider-free suite in `tests/workload-routing.test.mjs` checks ordinary/complex/security-critical tier selection, same-agent concurrent plans, assessed versus missing/uncertain inputs, requested reasoning/quality floors, independence, unknown/paid billing, absent reasoning capability, agent/role conflicts, account-sensitive fingerprints and the exact complete-record size boundary. `tests/workload-admission-native.test.ts` exercises **real Bun SQLite** writes/reads, reopened files, two connections, conflicting reassessments, stale source/selection refusal and schema corruption. These checks do **not** establish native dispatch, protected host provenance or live-model acceptance.

See the [existing routing contract](model-routing.md), [initial-route qualification](initial-routing-qualification-206.md), [native request identity](native-request-identity.md) and [OpenCode 2.3.0 compatibility](opencode-2.3.0.md).
