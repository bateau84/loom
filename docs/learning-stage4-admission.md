---
type: Architecture
title: "Stage 4: Evaluator execution-admission assessment"
description: "A bounded, read-only admission boundary over durable preparation and canonical issues, with explicit missing authority and no execution permit."
tags: [loom, learning, evaluator, admission, recovery, qualification]
timestamp: 2026-11-24T00:00:00Z
---

# Stage 4: Evaluator execution-admission assessment

**Expose a capability-specific admission assessment through the existing insights reader. Keep execution unavailable until the actual recipient, effective method, source, model/account and budget authorities are connected and qualified.**

This is a bounded increment of S4 in [issue #227](https://github.com/bateau84/loom/issues/227). An authorized caller can inspect an exact prepared request and its current canonical initial issue, including a consumed claim or uncertain native outcome. A successful assessment read grants no effect permit. The subsequent [restricted execution consumer](learning-restricted-execution.md) implements admission/outcome persistence and lifecycle ordering against a trusted adapter; the production adapter and real account/budget authority remain unavailable. This assessment still grants no authority and does not establish S3, complete S4, Q4, Q5 or E11 acceptance.

## Derived from

- [Stage 4 contract](learning-stage4-contract.md), especially capability-specific scope in section 3, ownership and immutable records in sections 4.1–4.2, effect/recovery ordering in section 4.3, and S4-A/E/F/G.
- [Durable preparation](learning-stage4-preparation.md) and [native evidence specification](learning-native-evidence-spec.md): immutable requests, canonical issue arbitration, source access and uncertain effects.
- Accepted [QS-002](requirements/learning-retrospectives/qs-002-recover-interrupted-batches.md), [QS-005](requirements/learning-retrospectives/qs-005-bound-background-analysis.md), [OC-002](requirements/learning-retrospectives/oc-002-review-admission-and-evidence-basis.md), [OC-003](requirements/learning-retrospectives/oc-003-protected-source-and-derived-report-access.md) and [OC-004](requirements/learning-retrospectives/oc-004-evaluation-processing-and-publication.md), carried forward by the Stage 4 contract despite historical authoring-status labels.
- The [unfinished obligation register](https://github.com/bateau84/loom/issues/227#issuecomment-6918622661). Its old assignment stop points are historical; its unresolved capability distinctions remain applicable.

## Read the assessment

First obtain the preparation through `loom_review prepare-evaluation` or `loom_insights evaluation-preparation`. Copy its exact identities into:

```json
{
  "operation": "evaluation-admission",
  "batch_id": "PREPARATION_BATCH_ID",
  "request_id": "PREPARATION_REQUEST_ID",
  "manifest_sha256": "EXACT_MANIFEST_SHA256",
  "attempt_id": "EXACT_INITIAL_ISSUE_ATTEMPT_ID"
}
```

Invoke this through `loom_insights`. The attempt identity comes from the preparation response's `issue.attempt.attempt_id`. All four selectors are required; the operation derives the canonical initial issue from the persisted request. It accepts no recipient, account, authority, reservation, retry decision or effect metadata from the caller. Unknown fields and mismatched selectors reject the read.

The response format is `loom-evaluation-admission-assessment/v1`. It reports the local source-store/request/issue identities, current issue state, missing or unsupported execution capabilities and recovery limitations. This is not the future `loom-evaluation-admission/v1` envelope: no host-prepared recipient or authoritative reservation is available to freeze in such an envelope.

The native integration rechecks both existing database read permissions and the calling Session's location. Existing preparation validation checks the owner, source-store identity, method mapping, complete frozen membership and exact required originals. Configuration is refreshed after asynchronous authorization before describing its state. Capture-off or invalid configuration blocks source processing but does not by itself deny an otherwise authorized historical assessment read.

No read creates or repairs preparation, claims an issue, acquires a processing lease, reserves quota, creates a native recipient, dispatches a model or publishes an interpretation. Incomplete preparation is repaired only through the existing explicit preparation operation, preserving its original identity.

## Authority and ownership

| Evidence or owner | Established meaning | Missing execution authority |
| --- | --- | --- |
| Native calling context and source-file permissions | Current caller may inspect this private view | Another receiving Evaluator's source access or transfer grant |
| `EvaluatorPreparation` and `EvaluationStore` | Immutable declared method/request and exact authorized source membership | Effective installed method, model settings or native delivery |
| `ReviewIssues` | Namespaced canonical initial issue, local attempt and durable claim history | Native admission, successful reasoning or provider effects |
| Declared method, route, source and budget policy references | Identified declarations with local integrity checks | A grant, effective account binding or budget allowance |
| Existing workload/routing owners | Candidate selection and their qualified denial behavior | A qualified S4 route or execution permit |
| Shared quota state | Existing failure, cooldown and probe arbitration | Durable per-intent execution-budget accounting |

The implementation stays in [EvaluatorPreparation](../src/evaluator-preparation.ts), using [EvaluationStore](../src/evaluation-store.ts), [ReviewIssues](../src/review-issues.ts), [LearningSources](../src/learning-sources.ts) and the existing [runtime reader](../src/learning-runtime.ts). There is no admission journal, new scheduler, third evidence database or synthetic grant provider.

The [production model-routing entry](../src/model-routing-adapter.ts) remains unavailable for positive managed routing; [current routing qualification](initial-routing-qualification-206.md) does not qualify a positive account. Historical candidate adapters and [workload candidates](../src/workload-admission.ts) cannot supply that authority. [Shared quota reservations](../src/quota-state.ts) include expiring recovery-probe leases; those are not the Stage 4 contract's atomic policy/account-pool reservations. This operation does not mutate them.

## States and recovery invariants

| Observed condition | Assessment meaning |
| --- | --- |
| Intact request, authorized reader, unclaimed initial issue | Local preparation is available; execution is still blocked by missing/unsupported authority |
| Missing preparation write, changed original, conflicting identity or corrupt state | Incomplete/unavailable or rejected read; no substitute request or issue |
| Declared method or policy without its effective authority owner | Not established; a reference or checksum does not upgrade it |
| Claimed or unknown issue | Claim remains consumed; native outcome requires qualified reconciliation |
| Issued issue | Native call was started; this does not prove native admission or completion |
| Proven non-admission | Preserve the original consumed issue; another issue still needs canonical retry authority |

A null effect permit means this assessment grants no permission. A null reservation reference and accounting marked not established do **not** mean zero historical spending, proof of nonexecution, or permission to release previously uncertain budget. Unsupported reservation/reconciliation remains explicit.

Processing-lease expiry, a disappeared worker, an idle native Session, cancellation or lost acknowledgement never resets an issue. Replaying this read or changing the claimant cannot acquire another permit. Reads preserve the existing issue state, including uncertainty; a proven non-admission cannot reopen that same consumed intent. Production retry authority remains unavailable.

The exact attempt selector detects disagreement with the caller's remembered issue. It is not a native receipt or a general rollback detector. Paired local backups are not atomic with host history or spending. Missing/restored rows cannot justify another effect, and this operation cannot reconstruct missing external history. Its recovery guarantee is continued denial without mutation, not full native or budget reconciliation.

Q4 same-invocation provenance, Q5 protected transfer, originating-request independence, human treatment approval and provider billing remain separate qualifications. Q4/Q5 do not become blanket prerequisites for all useful analysis of already-authorized evidence. The present blocker is the absence of qualified execution authority for the selected request. Source-access checks keep their existing exact-source behavior; the independent question of later original-source modifications remains unresolved.

The generic review claim method retains its local arbitration contract. No production execution path is introduced. Structured `record ask` reviews remain preparation-only, and stored preparation classification still protects replay through ordinary review tools. Ordinary unstructured questions or native agent calls outside this preparation chain are not globally confined by the assessment; no Q5 enforcement claim follows from it.

## Alternatives and decision

| Option | Benefit and cost | Decision |
| --- | --- | --- |
| Derive a current assessment from existing owners | Explains exact per-request blockers and consumed-state recovery without stale grants or new persistence | Selected |
| Persist a denial-assessment journal | Could preserve prior checks, but adds schema, backup and stale-status semantics without supplying authority | Defer until a concrete historical-assessment requirement exists |
| Build budget/effect state around fixture-owned grants | Can test an imagined lifecycle, but does not establish actual recipient/account/policy authority | Rejected for this increment |
| Retain only the global Stage 3 blocker | Preserves denial but cannot distinguish prepared, consumed or uncertain issue state or capability-specific gaps | Preserve legacy behavior; add the dedicated reader |

The new operation belongs in insights because it reads current state. Adding a review lifecycle operation or another orchestration owner would not improve its guarantee.

## Newer host evidence

The repository remains on the paired OpenCode 2.3.0 baseline. The newer official [2.4.1 release](https://github.com/anomalyco/opencode/releases/tag/v2.4.1), published November 23, was inspected at commit `6f0514052a3c859894ad01bb14cc14dda1e44b96`. These are **source findings**, not an installed 2.4.1 qualification or account/billing test:

- [Code Mode](https://github.com/anomalyco/opencode/blob/6f0514052a3c859894ad01bb14cc14dda1e44b96/packages/core/src/codemode/tool.ts#L203-L217) now gives inner calls unique native call IDs and nests their permission display under the outer call. The old shared-inner-ID limitation is scoped to the previously inspected 2.3.0 implementation. Unique inner IDs alone do not establish the contributing admitted-input set.
- [Subagent dispatch](https://github.com/anomalyco/opencode/blob/6f0514052a3c859894ad01bb14cc14dda1e44b96/packages/core/src/tool/plugin/subagent.ts#L194-L217) still discards the prompt result and supplies no protected parent tool identity; [runner context construction](https://github.com/anomalyco/opencode/blob/6f0514052a3c859894ad01bb14cc14dda1e44b96/packages/core/src/session/runner/llm.ts#L191-L219) does not supply the missing admitted-input contribution receipts.
- The inspected [model/transport/retry hook interfaces](https://github.com/anomalyco/opencode/blob/6f0514052a3c859894ad01bb14cc14dda1e44b96/packages/plugin/src/promise/session.ts#L72-L157) still lack the needed send-attempt/account/credential-generation receipt. [Generation](https://github.com/anomalyco/opencode/blob/6f0514052a3c859894ad01bb14cc14dda1e44b96/packages/core/src/session/generate.ts#L43-L76) prepares once and retries the prepared request. These paths do not establish a request-bound budget or billing guarantee.

No qualified positive execution authority was established on those inspected paths. This is not a whole-repository absence claim. No dependency upgrade is needed for the read-only increment, and newer source APIs alone do not enable dispatch.

## Acceptance and evidence limits

The following are falsifiable acceptance criteria, not claims that tests or independent implementation review have already passed:

1. An authorized intact preparation yields the exact namespaced request, manifest and initial attempt identities, with blocked execution and explicit capability reasons.
2. Foreign callers, revoked source permissions, missing/changed originals, damaged mappings, wrong selectors and unsupported authority fields fail closed. Declared budget/account/model metadata never yields a permit.
3. Capture/configuration changes during native authorization are reflected by the new reader without revoking otherwise authorized historical inspection or treating configuration as a grant.
4. Concurrent same/different-request reads, restart and expired processing leases leave request/issue/claim and quota state unchanged. Claimed, issued, unknown and rejected issues preserve their distinctions; lost state is never repaired by a read.
5. Preparation replay and structured-review replay keep their existing restrictions. Stage 3 history, scheduling and public readers, ordinary engineering tools and routing guards remain functional under optional admission failure.
6. Registered-tool and isolated installed-host checks observe no native recipient creation, Evaluator dispatch, new provider effect or instruction mutation attributable to this operation. Scripted-provider mechanics remain distinct from real reasoning and account qualification.

Positive shared-budget contention, crash-after-reservation, authoritative result reconciliation and rollback after native execution are outside this read-only operation. The subsequent [restricted execution lifecycle](learning-restricted-execution.md) implements and exercises those mechanics with controlled authority. Production host/provider/account authority and genuine Evaluator reasoning remain **unqualified**. Denial tests and preserved local claim history do not close those full S4 cases. Execution receipts and independent review belong in the implementation PR and issue register with their exact revisions and limitations.

## Smallest next increment

Establish one restricted analysis route whose actual recipient, effective installed method, exact permitted source scope, model/account and bounded resource policy have qualified authority. Useful analysis of already-authorized evidence need not wait for unrelated independent-pattern or human-treatment contracts. No route is enabled by this document.

The subsequent [restricted execution lifecycle](learning-restricted-execution.md) reuses the issue owner and implements immutable per-issue admission, consumed-claim ordering and reconciliation as a consumer of a trusted shared-pool authority. Production remains unconnected. Uncertain reservations must remain held; provider-owned retries and billing require their own enforcement evidence. Source revocation, cancellation and restore must fence new effects without inventing nonexecution. Genuine Evaluator reasoning then requires the [separate S3 qualification](learning-evaluator-s3-handoff.md); interpretation publication, automatic Stage 4 scheduling and assembled E11 remain later obligations.
