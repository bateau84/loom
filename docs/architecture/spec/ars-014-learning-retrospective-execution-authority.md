---
type: Architectural Specification
title: "Retrospective execution: one production authority route"
description: "Owner handoff for a fixed Evaluator route, preserving actual-send, account, billing, source-release and recovery obligations without reopening settled host investigations."
tags: [loom, learning, evaluator, execution, authority, qualification]
timestamp: 2026-11-27T00:00:00Z
---

# One production authority route

**The remaining production dependency is an actual host/provider/account
authority for one fixed Evaluator route.** Connecting a frozen retrospective
population to the existing consumer does not supply that authority. Keep the
production adapter absent until the owner guarantees below are implemented,
qualified on the exact installed host and separately authorized for use.

This handoff applies the existing [restricted execution
contract](../design/ard-012-learning-restricted-execution.md) to the retrospective source kind. It
does not request another execution lifecycle, provider proxy, scheduler or
transcript store. `EvaluatorExecution`, `EvaluationStore`, `ReviewIssues`,
preparation and the original-source owners retain their responsibilities.

## Current evidence and scope

The reconciliation baseline is Loom main
`902d4f3` after #249 and #251–#257, with SDK/CLI qualification pinned to
OpenCode **2.3.0**. Read-only GitHub checks on **2026-11-27** found:

| Tracking item | Controlling status and implication |
| --- | --- |
| [#203](https://github.com/bateau84/loom/issues/203) | Open. Managed production routing remains disconnected; no paid fallback or automatic resume is authorized. |
| [#205](https://github.com/bateau84/loom/issues/205#issuecomment-7023206933) | #244 is merged. Its account/send investigation remains PARTIAL/BLOCKED: no qualified effective billing principal, credential generation, per-send included-only admission or final settlement. The merge comment supersedes older draft wording. |
| [#206](https://github.com/bateau84/loom/issues/206#issuecomment-7023447371) | #245 is merged. Installed title, compaction and pre-dispatch cancellation mechanics do not qualify a production account. Its 27-case local-provider result does not activate routing. |
| [Native source-owner handoff](ars-003-learning-native-source-handoff.md) | The existing November 27 source check of 2.4.2 found no supported plugin exact-history/recipient-release contract. This handoff does not rerun that investigation or upgrade the pinned dependency. |

The [retained 2.3.0 evidence](../qualification/native-attempt-qualification-205.md) already shows
that a prepared generate request can send twice after one `model.request`
validation; [#245](https://github.com/bateau84/loom/pull/245) records the same
distinction for compaction. Repeating those host experiments cannot establish
the missing account authority. A provider account was not used for this
reconciliation, and no real production route is qualified by it.

The relevant upstream records were checked for concrete progress:

| Existing owner discussion | Observed state on November 27 | Remaining distinction |
| --- | --- | --- |
| [OpenCode #60468](https://github.com/anomalyco/opencode/issues/60468) | Open transport-timing proposal | Debug correlation does not enforce account-bound admission. |
| [OpenCode #55985](https://github.com/anomalyco/opencode/issues/55985) | Open auxiliary-completion proposal | Completion telemetry does not reserve resources or prohibit paid sends. |
| [OpenCode #62820](https://github.com/anomalyco/opencode/pull/62820) | Open, unmerged; inspected metadata head `45e2af3d9ed39a2638f4311af06d2c795907fdb5` | Proposed model HTTP hooks widen interception. Their stated scope excludes model-level WebSockets and does not supply the complete account/admission/settlement contract. No new source or installed qualification is claimed here. |
| [OpenCode #64438](https://github.com/anomalyco/opencode/pull/64438) | Open, unmerged; inspected metadata head `0a7c4b29f654e19468d5b639a94452a6ff08594b` | A primary assistant-message ID at preparation is not a fresh physical-send identity. |
| [OpenCode #61645](https://github.com/anomalyco/opencode/issues/61645) | Open permission-admission proposal | Race-safe effect admission and source release need their own owner enforcement. |
| [OpenCode #57424](https://github.com/anomalyco/opencode/issues/57424) | Open history-read proposal | A message-read API alone would not authorize cross-Session native release. |

These issue discussions and PR descriptions are proposals, not owner acceptance
or evidence of implementation. No upstream write was performed. No changed
accepted capability was found that would justify enabling a production adapter.

## Smallest owner implementation to request

Implement the existing
[`EvaluatorExecutionAuthority`](../../../src/evaluator-execution-contract.ts)
semantics for **one declared profile**: an exact host/SDK build, Evaluator method
and configuration, provider/model/variant, authentication method, effective
account and permitted source class. The operator supplies the bounded resource
policy; the implementation must not invent numerical limits or an account.

The profile may exclude unnecessary auxiliary kinds, transport fallback,
credential rotation and alternative routes. Exclusion is useful only if the
host/provider prevents those sends, including automatic native retry and
restart. An unsupported path must be denied at its effect boundary. A title
preference, plugin registration or configuration assertion alone is not that
fence. This permits a small fixed-route implementation without promising
universal dynamic routing or protected assignment-wide model transitions.

| Required implementation | Responsible owner | Minimum observable acceptance |
| --- | --- | --- |
| Enroll the exact retrospective request | Loom supplies the frozen population identity/digest, complete member/version/view scope, preparation/request/method/policy identity and canonical initial issue. The trusted authority validates its approved semantic enrollment. | Changed population, manifest, method, source namespace, requester or canonical attempt cannot reuse the enrollment. Reconstructed local IDs after restore do not create another permit. |
| Prepare the actual Evaluator recipient without inference or source transfer | OpenCode Session/execution owner, consumed by the adapter | Fresh exact Session, effective Evaluator method and host identity are established before reservation; a wrong/reused recipient is rejected. Requested agent/model fields alone are insufficient. |
| Bind the effective account at the final send boundary | OpenCode provider/credential resolver plus provider account owner | A provider-scoped billing principal, authentication method and credential generation are verified and kept bound through the actual send. Changed auth headers, refresh, active account or reused connection rebind under qualified authority or fail before sending. |
| Enforce included-only use independently of Loom | Provider or trusted host/account policy owner | Exhausted/unknown entitlement rejects before any metered request. This protection still holds when Loom fails to load or a hook disappears. Catalog prices, local quota estimates and a fixed profile name do not prove it. |
| Reserve and consume the real shared pool | Existing account/resource-policy owner | Same-issue contenders share one enrollment/reservation; different issues contend atomically for the same bounded capacity. Each physical send consumes current authority and receives a distinct attempt identity. |
| Cover all native effects in the profile | OpenCode execution/provider owner | Primary, tool continuation, retry, title, compaction, generate, provider-owned auxiliary calls and restart either use the same account-bound allowance or are demonstrably denied. HTTP/WS fallback and reuse are covered or fenced out. |
| Authorize exact source bytes for the recipient | Existing original-source/policy owner, called by the adapter | Every permitted source read binds original identity/version, view and actual recipient. Wrong recipient, changed source, permission loss and out-of-scope member/index return no unauthorized bytes. Available parent evidence is not automatically transferable. |
| Fence and reconcile the original effect | OpenCode execution/provider owner plus account/resource-policy owner | Lost acknowledgements, cancellation, process interruption and restart retain the original input/result/send identity and authoritative usage. Lookup does not wake native work. Unknown usage remains held/uncertain; release requires fenced zero-effect proof and settlement requires authoritative terminal usage. |
| Preserve inventory independently of Loom restore | Trusted execution/account owner | Restoring either an older paired Loom snapshot or lost local execution rows cannot erase an admitted/completed effect. Unavailable inventory is not absence. Authority rollback or changed namespaces are denied unless the supported recovery profile establishes continuity. |

The local consumer already owns the durable admission mirror, canonical claim
coordination and recovery ordering. The owner implementation must supply the
facts the mirror records; it must not reinterpret the mirror as the spending
pool or treat a TypeScript-shaped receipt as an external attestation.

`not-admitted` at the provider budget boundary must retain its narrow meaning.
Native input admission or source exposure may already have occurred. A zero-send
receipt can justify only the accounting conclusion it proves; it cannot erase
the canonical claim or manufacture native non-admission provenance.

## Source scope, Q4 and Q5 remain separate

Three decisions must remain distinct:

| Capability | Required authority for this bounded work |
| --- | --- |
| Ordinary authorized inspection | The existing source owner's supported interface, current reader permission, exact identity/version and permitted view. Useful current-caller inspection does not wait for universal provenance or protected transfer. |
| Evaluator execution with supplied originals | The actual recipient must be authorized for the exact selected bytes, method and route. The preparing caller's successful inspection is not a transfer grant. Source availability and valid v2 preparation do not authorize inference. |
| Q4 invocation provenance / Q5 protected transfer | Q4 separately proves native causal joins among invocation, admission, execution and source access. Q5 separately covers sealed recipient ingress, retained context and derived-output restrictions. Neither follows from the controlled lifecycle; neither is a blanket prerequisite for analysis whose authorized scope does not require it. |

The current native resolver's same-caller `session.context` path remains limited
to that actual caller. A new Evaluator Session must not use the preparing
Session's identity to retrieve native originals. Historical cross-Session raw
release, exact pre-compaction history and revocation ordered against protected
release remain governed by the
[native source-owner handoff](ars-003-learning-native-source-handoff.md).

A first production audit can select a genuinely useful population from source
classes already supported and authorized for its recipient, retaining explicit
gaps already declared by that exact frozen population. An available frozen
member that later changes or disappears cannot be downgraded to authorize
dispatch. It must not silently substitute summaries or current files for missing
originals. If the omitted originals are essential to the
question, select a different permitted objective or wait for the relevant
source owner. A declared gap does not validate unsupported content-dependent
reasoning. No new raw capture or alternative transcript store is needed.

## Owner acceptance and the next S3 step

The next owner deliverable is a supported implementation plus a qualification
receipt for the one profile above. Request its exact public integration seam,
effective-account and included-only evidence, per-send fence, durable inventory
and terminal settlement semantics. Where the provider cannot attest or enforce
those facts, return a specific unsupported capability; do not connect a
simulated authority to production.

Run the decisive positive and negative cases against that profile: one approved
effect; changed account/credential/model; expired or revoked reservation;
same/different-issue contention; wrong source/recipient; attempted retry and
auxiliary sends; lost ACK; cancellation and late result; interruption/restart;
and restored Loom state. Record actual physical sends, effective account,
reservation consumption and final result/usage separately. An uncertain or
completed execution must produce **zero new sends** on replay. Real-account
qualification and inference require separate operator authorization; this
handoff grants neither.

Once that route and the selected source/recipient scope qualify, follow the
[S3 original-work handoff](../../user-docs/learning-evaluator-s3-handoff.md): authorize one exact
real population, method, account and budget; let the genuine Evaluator inspect
its permitted originals; recover the same result without another inference;
then obtain an independent assessment of the reasoning. The earlier #236
trajectory is a candidate, not a mandatory or already available source set.

Report four separate outcomes: deterministic consumer correctness, installed
controlled-host mechanics, real authority/account qualification, and genuine
original-work reasoning. Scripted output establishes only mechanics. Keep
#227/#203/#205/#206 open for their outstanding scope; production routing,
automatic scheduling, paid fallback and unqualified retrospective execution
remain disabled.
