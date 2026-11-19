---
type: Architecture
title: Workload-aware model routing — provider-free foundation
description: Assignment-scoped tier decisions, conservative security floors, model-class reuse, and exact limits before native dispatch qualification.
tags: [loom, model-routing, workload, policy, safety]
timestamp: 2026-11-19T00:00:00Z
---

# Workload-aware model routing — provider-free foundation (#239)

**Status:** The user accepted this **provider-free foundation** as a separately mergeable milestone on 2026-11-19, following independent review of [PR #240](https://github.com/bateau84/loom/pull/240) at `e393132beba4286cb13c13156cf06a5257aff0f0` (F-01, F-02 in provider-free scope, F-03A and F-04 PASS; six CI workflows PASS). This does **not** accept F-03B as proven or authorize production model routing. The production adapter stays disabled/unqualified. [#205](https://github.com/bateau84/loom/issues/205) and [#206](https://github.com/bateau84/loom/issues/206) remain blockers to live included-only dispatch. The separately tracked [#242](https://github.com/bateau84/loom/issues/242) covers protected native assignment-level admission if a future design requires such a guarantee.

**Follow-up:** an internal request-local bridge now connects this planner to the 2.3.0 hooks **only in an isolated qualification fixture**. All 19 installed local-provider mechanics cases pass on exact CLI/SDK 2.3.0. It does not activate production routing or make the fixture's supplied assessment/inventory authoritative; see the [request-local qualification boundary](initial-routing-qualification-206.md).

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

`WorkloadDecisionJournal` in `src/workload-admission.ts` explicitly takes the existing Loom Action store and its shared SQLite connection. It stores a **candidate-only** record and separates two different identities:

- **Stable logical-work uniqueness key:** the project-local Action ID, plan node ID and intended agent ID. It deliberately **excludes mutable Action/Plan revisions, Session ID and caller-provided objective/assignment IDs**; renaming an Action, editing the plan, reopening the database, or selecting the node from another Session cannot silently mint a second candidate. Separate plan nodes can have separate candidates. A fresh admitted assignment epoch is impossible without protected native evidence.
- **Mutable source-revision fence:** the caller's saved Session focus, Action revision, current Plan revision and selected node/source digest are checked within the same SQLite write transaction. Old revisions are stale; current revisions cannot override an earlier candidate. Exact replay returns the stored record only when the full candidate, work source and decision are identical; changed risk/model/account/quality/config/new assignment IDs are conflicts.

Independent file-backed SQLite connections and process reopen retain the first candidate and its original source evidence. The additive candidate database schema is **version 2** to prevent silently interpreting unmerged draft-version-1 revision-key records under the stronger stable-key semantics; encountering that prior version fails closed without deleting or rewriting it. There is no automatic migration or installed production usage of this module. The journal does not change the Action database's `user_version`, add a producer to existing runtime hooks, or authorize a provider request.

- Only an explicit **new-assignment candidate for an existing current saved Action/plan node** is journalable. `continuation` and `safe-next-phase` are refused. A real safe phase boundary requires an **authoritative native execution fence** not available to this provider-free module; a self-declared boundary is insufficient.
- The SQLite schema is additive, opt-in and versioned separately. Partial schema, corrupted records, stale work revisions, wrong Session selection and conflicting reassessment fail visibly.
- The journal's work identity is stable across process restarts but **not proof of a human-originating independent objective**, protected Session admission, native side-effect safety, or account-backed entitlement. The saved Action focus remains a navigation fact, never a native authorization grant. All stored results have `status: candidate-only`.

### Internal request-local host candidate (mechanics qualified)

`src/request-local-model-routing.ts` reuses the pure workload planner through
`experimental.model.resolve` and checks the resulting native model at
`model.request`. Its only caller is an isolated fixture supplying configuration,
inventory and assignment evidence. The production adapter and candidate
journal remain separate and inactive for this path.

Before each callback's decision, the bridge reads the native Session to
establish its owner and stored model selection. A compatible explicit choice
is preserved; a conflicting explicit choice is denied, not silently replaced.
A same-provider choice replaces the hook's full model reference with the
planned exact model/variant. The request guard re-evaluates supplied policy
and validates the actual route; it does not consume a receipt keyed by
Session or request kind. This accommodates speculative title selection and
compaction's reuse of an already resolved model.

The existing assignment inputs remain **policy evidence**, not proof that
each native continuation is a fresh assignment. No protected work epoch,
assignment-wide model affinity, provider-account authority, quota settlement,
or live spending permission is added. In particular, [native generate](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/core/src/session/generate.ts#L56-L73)
and [compaction retries](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/core/src/session/compaction.ts#L618-L705)
can resend a prepared request without invoking `model.request` again. This
candidate cannot establish fresh admission for every physical send.

### F-03B: protected native work admission — future assignment-level boundary (#242)

**Scoped decision, accepted 2026-11-19:** the OpenCode 2.3.0 `experimental.model.resolve` hook chooses a model for a **single new request before request construction** and does **not** change the Session's stored model. This is a narrower, already host-ordered boundary; no separate assignment-wide execution-epoch receipt is needed merely to select a same-provider model/variant for that one request. A fresh native subagent can also begin with a model chosen at **creation**. Neither case should silently be represented as permission to reassign an active child or repeat completed tool effects.

**F-03B remains a distinct, unproven host guarantee** whenever Loom proposes to *switch an existing Session/child at an assignment-wide safe boundary*, claims durable exactly-once work-epoch admission, or needs to assert no pending effects before replacement. Only the **OpenCode host**, or an equivalent protected controller inaccessible to model-authored instructions, can attest those properties. Loom's Action/Plan selection, fresh UUID, asserted difficulty, SQLite journal, and per-request model resolver cannot prove an assignment-wide safe epoch.

To qualify **assignment-wide transitions** (not request-local selection), the minimum host-owned evidence is a protected, non-replayable *admission receipt* associating: the actual native caller/parent/child Session and effective agent; originating request/continuation lineage; the exact intended logical work and an immutable epoch/assignment identity; the native point **before** first dispatch; and a fence proving that no active child, streamed output, pending tool effect or uncertain retry can be reassigned. A new receipt must be distinguishable from revisions or corrective attempts on the same original request, be durable across restart, reject concurrent duplicate admissions, and be unavailable to model-authored metadata. The native hook must enforce the fence rather than merely report what an agent said happened. Requested model/variant, native account/attempt and billing policy still require independent #205/#206 protection.

**Required acceptance counterexamples for any future assignment-wide transition:** Action rename, plan re-save, same-task different Session, fabricated user text, a still-running background child, interruption after tool effects, ambiguous provider outcome, duplicated/cancelled admission, credential change, restart, and same-origin corrective attempts. Unknown/missing native evidence must deny model escalation or reassignment; it cannot be represented as a fresh safe boundary by changing the ID.

This boundary is **not present in PR #240** and is not required to merge the **approved provider-free foundation**. It remains a required, **unsatisfied guarantee** for any future assignment-wide/in-place model switching or claims of protected new-work epochs, tracked in [#242](https://github.com/bateau84/loom/issues/242). A request-local same-provider routing adapter must instead prove correct per-request selection, its pre-transport guard, explicit model/user authorization and the #205/#206 billing gates. A new-child cross-provider route must also demonstrate model-specific authorization at native dispatch; OpenCode's agent-name permission alone is insufficient. PR #240 implemented neither approach; the follow-up request-local candidate is fixture-only and does not enable live routing.

A real native route cannot be created or resumed from the journal. Native boundary authentication, installed-host propagation and request-level identity belong to the separate #205/#206 qualification and #239 Milestone B; do not promote these candidates into execution authority.

## Known boundaries and remaining work

1. **Foundation milestone (approved for separate integration):** pure routing, strict configuration validation and opt-in, candidate-only saved-work journal. No autonomous difficulty classifier, trusted runtime admission, learned ranking, real cost attribution or live model request. Routing-disabled behavior is untouched; the journal is **not** an execution-admission receipt.
2. **Milestone B — host-qualified dispatch:** qualify the **request-local** `experimental.model.resolve` interface against exact installed 2.3.0. It supports **same-provider** model/variant changes per request, not provider swaps, without Session mutation. A fresh subagent's explicit model choice is a separate child-creation/authorization boundary. Verify requested vs actual route, explicit overrides, auxiliary/continuation kinds, restart/concurrency, unknown billing denial and account/attempt binding through #205/#206 before activation. **Assignment-wide model switching or work-epoch claims are additionally gated by F-03B/#242**.
3. **Milestone C:** compare quality and cost per **complete originating engineering objective**, including correction attempts, independent review, provider usage, outcomes and human intervention, before adjusting automatic thresholds or rankings.

A plain plugin hook, self-declared risk label, model catalog, route hash or synthetic quota attestation cannot independently certify spending or task correctness. Provider-enforced no-paid limits, loaded-plugin failure boundaries, protected role permissions and independent review remain separate requirements.

## Verification boundary

The provider-free suite in `tests/workload-routing.test.mjs` checks ordinary/complex/security-critical tier selection, same-agent concurrent plans, assessed versus missing/uncertain inputs, requested reasoning/quality floors, independence, unknown/paid billing, absent reasoning capability, agent/role conflicts, account-sensitive fingerprints and the exact complete-record size boundary. `tests/workload-admission-native.test.ts` exercises **real Bun SQLite** writes/reads, reopened files, two connections, conflicting reassessments, stale source/selection refusal and schema corruption. These checks do **not** establish native dispatch, protected host provenance or live-model acceptance.

The new `tests/installed_request_local_routing.py` suite separately targets
request-local mechanics on a packed candidate and exact CLI/SDK 2.3.0 with a
scripted local provider. Its 19 mechanics cases pass, with complete stopped-host
trace revalidation and archive/install/source byte equality. The observed
generate retry uses two provider attempts after one request guard. These results
do not qualify an included-only account, trusted workload source, every
physical retry, or production allowlisting under #205/#206.

See the [existing routing contract](model-routing.md), [initial-route qualification](initial-routing-qualification-206.md), [native request identity](native-request-identity.md) and [OpenCode 2.3.0 compatibility](opencode-2.3.0.md).
