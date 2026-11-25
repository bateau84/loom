---
type: Architecture
title: "Restricted Evaluator execution lifecycle"
description: "A durable consumer for authorized evaluation effects, with controlled-host qualification and the precise missing production authority boundary."
tags: [loom, learning, evaluator, execution, recovery, qualification]
timestamp: 2026-11-25T00:00:00Z
---

# Restricted Evaluator execution lifecycle

**Implement the positive execution lifecycle as a consumer of an actual authority owner. Keep the production adapter absent until a real native/account route is qualified and separately authorized.** The selected native realization is a fresh, dedicated Evaluator Session with a fixed method, source scope and account route. It reuses OpenCode's execution and history; it introduces no agent runtime, scheduler or production provider integration.

This progresses S4 in [#227](https://github.com/bateau84/loom/issues/227) beyond the [read-only admission assessment](learning-stage4-admission.md). It implements the consumer work expressly permitted by [Stage 4 contract §4.3 and §6](learning-stage4-contract.md). The two local stores now retain an immutable admission and authoritative outcome observations, while the existing review owner arbitrates the sole local issue claim. **No production execution grant, live account reservation or genuine Evaluator reasoning is established.** Fixtures exercise their own authority and zero-cost synthetic effects only.

The contract, [native evidence specification](learning-native-evidence-spec.md), [host trust contract](learning-host-trust-contract.md), QS-002/QS-005 and OC-002/003/004 retain their accepted meanings. Q4 exact invocation provenance, Q5 protected transfer, independent originating requests, human treatment approval and provider billing remain separate guarantees. Already-authorized original-work analysis need not wait for guarantees it does not require.

## Current baseline and decision

Development starts from main `9e9697a105693b54054d8036b1cc88edfb0fcd01`, the #248 squash merge. The applicable [post-merge push CI](https://github.com/bateau84/loom/actions/runs/45506213413) passed. The other installed qualification workflows are PR-triggered; their accepted #248 evidence is historical baseline evidence, not newly rerun post-merge qualification.

An independent architectural assessment preceded the lifecycle implementation. It selected a trusted-adapter consumer with production unavailable. The assessment considered native direct Sessions, native subagent delegation, transient generation, fixed Claude profiles, transport-hook counters and a new provider/runtime. It performed source inspection, not implementation or account tests. Final implementation and installed evidence belong in the PR receipt, with their exact revisions.

| Realization | Decision and reason |
| --- | --- |
| Fresh native Evaluator Session, exact method and fixed model/account, qualified authority at actual sends | Preferred restricted realization. Native input/history APIs support useful recovery. A real authority adapter is still required. |
| General → native `subagent` → Evaluator | Retain where native delegation is the qualification subject. It adds an initiating model request and background notices without supplying missing budget/account authority. |
| `session.generate` | Does not provide the full installed agent/tool/history path and retries prepared requests. It does not solve original-result recovery or account authority. |
| Single native Claude profile | Can remove one profile-rotation branch. It does not establish shared capacity, billing containment, internal retries or durable settlement. |
| Local permit flags, quota-probe leases or per-project budget counters | Rejected as substitutes for actual authority. They lose effect history on rollback and do not own provider spending. |
| New proxy, scheduler, agent runtime or provider integration | No concrete evidence justifies the added deployment, credential and recovery ownership. The missing guarantee belongs at the existing host/provider/account boundary. |

## What the consumer implements

`EvaluatorExecution` accepts only the existing preparation pins: `batch_id`, `request_id`, `manifest_sha256` and canonical initial `attempt_id`. Its operations are `execute`, `recover` and `cancel`. These are **internal owner methods**, not new registered tools or configuration switches. `Learning` constructs the consumer **without an integration**; every operation rejects with `evaluator-execution-authority-unavailable` before mutation. Public tool arguments cannot supply an adapter, grant, account, result or budget allowance.

The integration is a trusted code boundary, not a permission inferred from a TypeScript interface or serialized receipt. A future production implementation must qualify all of its actual guarantees before connection.

| Owner | Responsibility |
| --- | --- |
| Existing preparation/source owners | Validate the complete frozen request and exact originals; preserve same-owner reads, native permissions and source restrictions. |
| `EvaluatorExecution` | Hide preparation/inventory/reservation/claim/execute/recovery ordering; compare effective bindings; never retry an uncertain effect. |
| Existing `ReviewIssues` | Supply the canonical initial issue and one exclusive `claimed-now` transition. A processing lease is never consulted for an execution permit. |
| `EvaluationStore` in existing `learning.sqlite` | Immutable admission envelope, append-only receipt mirrors, retained enrollment marker, exact local identity and backup integrity. No authoritative spending pool. |
| Trusted execution authority | Prepare the actual recipient without source transfer/inference; resolve grants; atomically reserve the real shared policy/account pool; enforce every allowed send; maintain restore-independent inventory; reconcile, fence and settle. |
| Evaluator / independent assessor | Genuine original-work interpretation and its reasoning assessment. Neither schemas nor scripted results satisfy this responsibility. |

The authority receives the prepared method and declared budget-policy reference; it must resolve their actual authority rather than accepting those declarations as grants. The effective grant binds the exact method manifest, recipient, host, provider/model/account/credential revision, source/account/budget authority references, expiry and explicit request/input/output allowances. The admission freezes that grant with the actual reservation, shared pool and authority epoch. There are no default numerical allowances.

Resource accounting belongs to the actual shared pool, including independent issues and other participating consumers. The local database retains only the authority's reservation and settlement observations. A provider-enforced no-paid guarantee remains separate from this local resource-policy accounting. Existing quota recovery-probe leases are untouched.

## Effect and recovery ordering

1. Authorize the caller and revalidate exact preparation, source membership and canonical issue.
2. Consult the authority's durable inventory **even when local execution rows are absent**.
3. Prepare the exact native recipient without content/inference, then reserve capacity atomically at the shared owner.
4. Persist the immutable per-issue admission before claiming the issue.
5. Revalidate current source/method/recipient/account authority and expiry, obtain the current held-reservation receipt, and acquire the existing review owner's exclusive claim.
6. Only a fresh `claimed-now` path may call the adapter's execution operation. The authority must revalidate and durably consume at the actual effect boundary, including native retry, auxiliary, fallback and restart paths.
7. Persist scoped outcome/result-reference/accounting receipts. Reconcile the original result after failure or lost acknowledgement; never wake native work to perform a recovery read.

The source callback rechecks current authorization, source availability, expiry and recipient authority for every original read. It does not broaden `LearningSources`, retain a new raw transcript, or turn a parent read into recipient transfer authority. The adapter must authorize the actual recipient and transfer before receiving content; general Q5 protection is not claimed.

Claim validation completes its asynchronous native checks, invokes and awaits the consumer's final caller-authorization callback, then reads the current durable reservation and applicable local authority policy without further awaited work. The consumer requires that callback to have completed, validates and mirrors the returned receipt, and checks the latest accepted observation before synchronously claiming. The immutable reservation envelope and an earlier inventory response are insufficient. Source validation remains separate: ongoing execution may legitimately retain uncertain accounting while its source reads require live permission.

This ordering detects reservation changes during the consumer's awaited checks. It is not a transaction across authority and review databases. Another process can change authority after the final observation; the authority must reject that change at the actual send, retaining a consumed local claim if no effect is admitted. A production adapter unable to provide this final authoritative observation remains unqualified.

| Situation | Implemented consumer behavior |
| --- | --- |
| Two contenders for one issue | Existing canonical claim admits at most one new local execution call. The authority must independently enforce one effect against stale replicas/restored state. |
| Different issues contend for one pool | The consumer requires the authority's atomic reserve result; no local estimate or independent pool is substituted. |
| Reservation ACK or local admission ACK lost | Recover the same external reservation. If no local claim exists, the reserved issue can continue through the original claim path; no replacement reservation or recipient is created. |
| Claim ACK lost, crash after claim, or unknown native result | Retain the consumed claim. Replay reconciles only; it never receives a replacement permit. |
| One contender fails or aborts | Its reservation is shared, not owned by that invocation. Cleanup may cancel only after durable canonical readback matches its own preallocated claimant ID; otherwise reconcile without cancellation or release. Explicit `cancel` remains the separate canonical cancellation operation. |
| Execution throws | Query existing authority inventory where possible; preserve uncertainty if unavailable. A transport error is not proven non-admission. |
| Cancellation, expiry or revocation | Refuse new effects/reads. Ask the authority to fence; never release merely because the caller stopped or a deadline passed. |
| Result appears after cancellation/lost acknowledgement | Keep the original native input/result identity and authority accounting. No interpretation publication or successful engineering outcome is inferred. |
| Native result available, local write failed | Recover that exact result reference without another model call. Raw content remains with its authorized native owner. |
| Source/readback rights revoked | Accounting can reconcile against an existing saved admission; returning result/recipient metadata still requires current source and readback permission. |
| Conflicting terminal receipts | Reject the conflicting observation. Previously admitted work cannot become proven non-admission through an intermediate unknown receipt; settled/released facts cannot be silently rewritten. |

Receipts distinguish `reserved`, `unknown`, `admitted`, `not-admitted`, `completed`, `failed` and `cancelled` from `held`, `uncertain`, `released` and `settled` budget states. A release requires authoritative fenced non-admission and zero usage. Settlement requires a fence, authoritative terminal usage within the reservation, and no remaining effect authority. A completed native result is not an accepted Evaluator interpretation.

Only `reserved` + `held` + unfenced + null usage/result is eligible for a fresh claim. `reserved` + `uncertain` is valid recovery evidence but cannot claim or enter execution. Fenced reservations, unknown/admitted effects, cancelled or terminal outcomes, and released/settled accounting remain recovery-only. An exact older held receipt cannot override newer uncertainty already retained in the mirror. A lost claim acknowledgement never permits another execution: matching durable claimant identity allows an owner fence; missing, different or unreadable ownership permits reconciliation only.

Here, effect admission is the execution authority's **budgeted effect boundary**. A provider can deny that effect after OpenCode has already admitted and delivered the input. Fenced zero-send proof can therefore justify releasing the provider reservation while native admission and source exposure remain real. The consumer never promotes an effect `not-admitted` receipt to canonical native `proven-non-admission`; it records `unknown`, preserving any earlier `issued` observation and the consumed claim. Recovery and additional-issue arbitration retain that uncertainty. A genuine native pre-admission rejection requires its own qualified evidence; no full Q4 claim is needed to keep these existing boundaries distinct.

### Restore protection

Local preparation IDs are deterministic over their inputs, but the preceding Stage 3 batch has a local allocation. An older snapshot can therefore produce different local request IDs for the same original frozen work. The consumer supplies a semantic enrollment key over source-store/owner, original source boundary, membership, method and policies, excluding that random batch allocation. **This hash supplies idempotency identity only.** The authority must already recognize the approved enrollment and retain its inventory independently of the restored Loom stores.

If an authority returns a previously enrolled effect under different local pins, execution is fenced. This increment does not silently rebind or repair the request. A production profile also needs a qualified treatment of lost/changed source-store identity or rollback of the authority itself; a fresh namespace must never mean fresh permission. Neither a local checksum nor paired backups provide that external guarantee.

The optional `learning_execution_*` tables share the existing learning database. An enrollment digest on the existing preparation row survives loss of the extension; a retained marker with missing records rejects execution and backup certification. Partial or unsupported extension state affects this optional capability, not Stage 3. Complete older snapshots without a marker still require external inventory before any effect. Repair of marked-but-missing local execution history remains a separately bounded recovery operation; ordinary reads/saves do not reconstruct it from guesses.

## Current native evidence and missing production boundary

The official v2 release inventory checked on November 25 still identifies **2.4.1** as the newest v2 release. The generic latest-release endpoint points to a different release channel. Source revisions examined are 2.3.0 `a6b15d33daf6ab7d35569f6d711fdb630b9f04e7`, 2.4.1 `6f0514052a3c859894ad01bb14cc14dda1e44b96`, and development `244491841dea5735c4c069ddc217e1e5f16126bd`. [Inspected source fingerprints](learning-restricted-execution-source-evidence.json) make this limited investigation reproducible; it is not exhaustive host or account qualification.

- Native explicit-ID [Session creation](https://github.com/anomalyco/opencode/blob/6f0514052a3c859894ad01bb14cc14dda1e44b96/packages/core/src/session.ts) and [prompt/inbox admission](https://github.com/anomalyco/opencode/blob/6f0514052a3c859894ad01bb14cc14dda1e44b96/packages/core/src/session/inbox.ts) are useful on the existing 2.3.0 baseline. A repeated input ID returns the original input; changed submitted bytes do not create a conflict automatically. Check actual persisted content before any permitted wake.
- **Native restart can resume an uncertain effect independently of Loom.** [Durable execution claims](https://github.com/anomalyco/opencode/blob/6f0514052a3c859894ad01bb14cc14dda1e44b96/packages/core/src/session/execution.ts) survive shutdown, and [startup recovery resumes them](https://github.com/anomalyco/opencode/blob/6f0514052a3c859894ad01bb14cc14dda1e44b96/packages/core/src/session/execution/restart.ts). The same relevant behavior exists on 2.3.0. Input deduplication does not establish one provider effect.
- [Generate](https://github.com/anomalyco/opencode/blob/6f0514052a3c859894ad01bb14cc14dda1e44b96/packages/core/src/session/generate.ts) retries a prepared request through [ModelRetry](https://github.com/anomalyco/opencode/blob/6f0514052a3c859894ad01bb14cc14dda1e44b96/packages/core/src/model-retry.ts). The retained installed evidence in [#244](https://github.com/bateau84/loom/pull/244) and [#245](https://github.com/bateau84/loom/pull/245) already demonstrates two sends after one preparation guard. This is not rerun merely to repeat that accepted finding.
- The inspected [plugin hooks](https://github.com/anomalyco/opencode/blob/6f0514052a3c859894ad01bb14cc14dda1e44b96/packages/plugin/src/promise/session.ts) and [model/account resolution](https://github.com/anomalyco/opencode/blob/6f0514052a3c859894ad01bb14cc14dda1e44b96/packages/core/src/model-resolver.ts) do not provide the required shared-budget, effective billable account/credential-generation, per-send and terminal-settlement receipt. Native integration allowlists and a fixed Claude profile do not supply those missing facts.

The exact missing guarantee is a **trusted restricted execution enrollment with shared capacity, actual send enforcement and durable outcome reconciliation**. Its responsible owners are the OpenCode execution/provider boundary and the actual account/resource-policy authority; Loom owns the consumer and local mirrors. The smallest change supplies that guarantee for one fixed route, not universal Q4/Q5 or a general new orchestration system.

Before connecting a production adapter, prove same/different-issue contention, changed effective credentials/account, no-paid enforcement, native retry/auxiliary/resume rejection or accounting, in-flight cancellation, lost acknowledgement and result recovery, and restore with independently retained authority inventory. Use an already authorized included-only account; discovering billing behavior by allowing a paid request is outside scope. [#205](https://github.com/bateau84/loom/issues/205) and [#206](https://github.com/bateau84/loom/issues/206) remain relevant and unresolved. No dependency upgrade is justified by the inspected evidence.

## Qualification and next increment

Evidence must retain four separate levels:

1. **Deterministic implementation:** actual preparation/stores/claims, controlled authority contention, corruption, crash/recovery and negative controls.
2. **Installed mechanics:** exact packed Loom source, unmodified OpenCode 2.3.0, dedicated local controlled provider, actual native inputs/results/restart and attempted additional sends. Fixture definitions and synthetic source work remain fixtures.
3. **Real execution/account authority:** not established by either level above. Production adapter remains absent.
4. **Genuine Evaluator reasoning (S3):** requires original work, actual installed Evaluator/Agent Run Audit and independent assessment. Scripted responses cannot pass.

The [S3 handoff](learning-evaluator-s3-handoff.md) specifies the original-work candidate, operator authorizations, source/account/budget scope and independent assessment. Interpretation publication (S5), automatic scheduling (S6), full Q4/Q5 and E11 remain separate work. Source modification semantics remain the existing unresolved product question.

MINOR-01 strengthens the existing Stage 4 oracle: each intended driver job must reconcile with its native prompt, input, assistant steps, execute result and exact provider follow-up sequence. An additional invocation using an already legitimate driver identity is rejected. Expected tool follow-ups are explicit; this fixture supplies title text without inference and plans no compaction. The original no-effect checks remain. This improves qualification for the next boundary; it does not reopen #248's accepted read-only scope.

The next production increment is to connect **one actual qualified authority adapter** and run the narrowly authorized S3 audit. Until then, this delivery is a tested lifecycle consumer and executable controlled-host composition, with production unavailable. It does not claim complete S4, S3, Q4, Q5 or E11 acceptance.
