---
type: Architecture
title: Workload-aware model routing — Milestone A provider-free policy
description: Assignment-scoped tier decisions, conservative security floors, model-class reuse, and exact limits before native dispatch qualification.
tags: [loom, model-routing, workload, policy, safety]
timestamp: 2026-11-18T00:00:00Z
---

# Workload-aware model routing — policy-only candidate (#239)

**Status:** Milestone A implemented in **draft PR #240**, not independently accepted. No native dispatch uses this planner. The production routing adapter remains disabled/unqualified for managed subscription routing. [#205](https://github.com/bateau84/loom/issues/205) and [#206](https://github.com/bateau84/loom/issues/206) remain blockers to activation even after [OpenCode 2.3.0 compatibility #238](https://github.com/bateau84/loom/pull/238) merged.

## Intent

Assign the smallest *eligible* model capability and reasoning tier for a bounded work assignment without multiplying native agent definitions or assuming that a low-cost model can satisfy consequential security/quality obligations. The caller can submit a difficulty preference, but cannot authorize paid usage, change tool permissions, waive independent review or certify provenance through this API.

The policy is pure. It does not register `experimental.model.resolve`, mutate native Sessions, create or resume a subagent, consume quota, or record durable decisions. It calls the existing `planModelRoutes` with an exact work-specific policy; the old agent-only call continues unchanged. Even if the legacy route configuration includes `paid-fallback: true`, workload plans consider **included** inventory only. Inventory labels are supplied test data here, **not** actual billing proof.

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

These are illustrative names, not a current OpenCode model catalog or pricing recommendation. The existing model-class/provider ordering, explicit aliases and exact reasoning support are reused. `minimum-tier` is a conservative role/agent floor: agent overrides never lower inherited role floors.

## Assignment boundary and decision rules

`planWorkloadRoutes(config, agentId, inventory, assignment)` takes a bounded `assignmentId`, an `objectiveId` for correlation, a declared `boundary` of `new-assignment`, `safe-next-phase`, or `continuation`, optional requested tier and zero or more recognized risk factors.

- **Standard:** existing role/agent policy, with no missing-tier fallback.
- **Advanced floor:** `complex`, `concurrency`, `persistence`, `recovery`.
- **Frontier floor:** `authority`, `containment`, `credentials`.

The selected tier is the maximum of the request, risk floor, and all configured agent/role minimums. A cheap requested tier cannot lower a mandatory floor. Later independent assignments may choose a cheaper tier, but a `continuation` is **not** a safe new selection boundary and returns `unsafe-boundary`. These fixed risk classifications are conservative policy defaults for this prototype, **not** independently verified claims that a particular file touches an authority boundary. An eventual trusted work-admission boundary must supply real source and scope evidence rather than accepting a model's claims as authority.

The decision record includes assignment/objective/agent, normalized risk factors, requested/resolved tier, reasons, selected class/effort, and the planned route if eligible. It carries a deterministic digest and enforces a **4,096-byte UTF-8 decision-record bound**, including opaque route identifiers. **It is reproducible after serialization, not persisted by this implementation and not host-attested.** A second attempt ID does not prove an independent user objective; `objectiveId` is correlation data, not provenance.

## Known boundaries and remaining work

1. **Milestone A:** pure routing and strict configuration validation only. No autonomous difficulty classifier, learned model-quality ranking, actual cost or live model request. Routing-disabled behavior remains untouched.
2. **Milestone B:** qualify `experimental.model.resolve` against exact installed 2.3.0. Its host implementation supports **same-provider** model/variant changes per request, but not provider swaps; native new-child model overrides are a separate authorization boundary. Prove actual chosen route, start/continuation/auxiliary behavior, restart/concurrency, unknown billing denial, and account/attempt binding through #205/#206 before activation.
3. **Milestone C:** compare quality and cost per **complete originating engineering objective**, including correction attempts, independent review, provider usage, outcomes and human intervention, before adjusting automatic thresholds or rankings.

A plain plugin hook, self-declared risk label, model catalog, route hash or synthetic quota attestation cannot independently certify spending or task correctness. Provider-enforced no-paid limits, loaded-plugin failure boundaries, protected role permissions and independent review remain separate requirements.

## Verification boundary

The provider-free suite in `tests/workload-routing.test.mjs` checks ordinary/complex/security-critical tier selection, same-agent concurrent plans, missing tier/model/variant, unknown/paid billing, agent/role conflicts, invalid values, unsafe continuation boundaries, deterministic decision correlation and routing-disabled compatibility. These are **pure module checks**, not installed-host or live-model acceptance.

See the [existing routing contract](model-routing.md), [initial-route qualification](initial-routing-qualification-206.md), [native request identity](native-request-identity.md) and [OpenCode 2.3.0 compatibility](opencode-2.3.0.md).
