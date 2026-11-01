---
type: Architecture
title: "Proposal: safe native OpenCode V2 model fallback at a pre-output retry boundary"
description: "Upstream 2.1.4 and dev source audit; proposes a restricted host-owned retry replacement and native account lease, with deterministic acceptance obligations and explicit blockers."
tags: [loom, opencode, model-routing, compatibility, upstream]
timestamp: 2026-10-25T00:00:00Z
---

# Proposal: safe native OpenCode V2 model fallback

**Status: PROPOSED / NOT IMPLEMENTED.** No upstream patch or installed-host
fallback acceptance is claimed. The GitHub connection can read
`anomalyco/opencode` but has **no upstream push permission**. This document
is an implementation proposal for an upstream review, **not** a Loom-side
workaround.

**Pinned evidence:** OpenCode [`v2.1.4`](https://github.com/anomalyco/opencode/tree/v2.1.4)
(commit `68bc26b7da1990ce10ffecfbc1e09eb13aa5d824`, dated in the V2
changelog 2026-10-23) and upstream `dev`
(`32b57015e5b491a789fba1534ecb472e676c9d8e`, read on 2026-10-25).
The `dev` root package still identifies version `2.1.4`; its
`SessionRetryDecision` remains **only** `{retry:false}` or
`{retry:true,delay:number}`. The newer source inspected does not expose
a native replacement model or account lease. Do not infer that
all possible future host versions share this limitation.

## Verdict

**Feasible with a narrow, host-owned extension, but not as a one-field
plugin change.** The execution loop already has the required
pre-output boundary; the public hook lacks authority to use it.
A safe first increment must address four linked concerns:

1. Let plugins *nominate* an exact replacement at the host-computed safe retry
   boundary, not mutate a running Session or its persisted selected model.
2. Enforce the safe decision inside the host, using current-attempt **and
   active-turn** evidence, including provider-hosted effects and unknown
   execution/restart history.
3. Bind a real native connection for the replacement and pin the selected
   runtime route across subsequent attempts/steps, instead of resolving a
   different active account on each continuation.
4. Keep existing assistant-step publication and model-specific WS/compaction
   state honest when the model changes.

An extension that implements only `session.retry.decision.nextModel` can
silently change credentials, misattribute recorded assistant output or replay
side effects. It must **not** be shipped as safe fallback.

## 2.1.4 dispatch lifecycle, directly traced

| Stage | Tagged upstream source | Concrete behavior |
| --- | --- | --- |
| Model selection | [runner/model.ts#L77-L100](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/session/runner/model.ts#L77-L100) | Use explicit Session model; otherwise select agent model if available, else global default |
| Native credentials | [model-resolver.ts#L370-L408](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/model-resolver.ts#L370-L408) | Resolve **currently active** integration connection when building a new runtime model |
| Context reload | [session/context.ts#L145-L168](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/session/context.ts#L145-L168) | Load tools, history and selected model; history may contain provider-specific native windows |
| Request build | [session/model-request.ts#L230-L380](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/session/model-request.ts#L230-L380) | Build LLM request from already resolved model; `model.request` edits headers/base URL, not model or credentials |
| Provider/tool processing | [runner/step.ts#L76-L145](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/session/runner/step.ts#L76-L145) | Stream events; local tools are forked only after `Tool.Called` publication; tool fibers are joined/settled |
| Output started | [publish-llm-event.ts#L440-L500](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/session/runner/publish-llm-event.ts#L440-L500) | Set `outputStarted` on text/reasoning start and tool input/call; provider-hosted tool calls can also have side effects |
| Retry/continuation split | [runner/step.ts#L170-L205](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/session/runner/step.ts#L170-L205), [#L262-L278](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/session/runner/step.ts#L262-L278) | A failed stream is classified, retry hook runs, and host branches to `Retry` when no output started or `Continue` when output already exists |
| Public hook | [runner/retry.ts#L34-L54](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/session/runner/retry.ts#L34-L54), [plugin session.ts#L128-L139](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/plugin/src/promise/session.ts#L128-L139) | Plugin may change retry and delay, **not selected model**; host does not expose `outputStarted` |
| Next attempt | [runner/llm.ts#L203-L310](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/session/runner/llm.ts#L203-L310) | `runStep` reloads context and rebuilds native request on retries; `Retry` shares assistant message ID, `Continue` makes new ID and synthetic continuation |
| Native transport | [model-transport.ts#L115-L135](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/session/model-transport.ts#L115-L135), [#L511-L545](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/session/model-transport.ts#L511-L545) | WS state and provider continuation checkpoints are owned by Session; must not survive route replacement |

A key detail: [publisher.startAssistant](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/session/runner/publish-llm-event.ts#L127-L150)
can record `session.step.started` **before** `outputStarted` is true.
Moreover, the retry branch explicitly invokes `publisher.startAssistant()`.
Therefore `outputStarted === false` alone does not establish that a
same-message-ID change would have correct historical model attribution.

Another detail: [provider-error.ts#L80-L116](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/ai/src/provider-error.ts#L80-L116)
makes `QuotaExceeded` **non-retryable** by default; a generic `RateLimit`
is retryable. [Classifier rules](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/ai/src/provider-error.ts#L225-L311)
use affirmative quota evidence, not every HTTP 429. A new replacement
decision may explicitly authorize a safe cross-route retry on
`QuotaExceeded` without permitting pointless same-route retry.

## Minimal proposed public extension

Prefer a **new narrowly named `session.retry.route` hook**, or an
equivalent backward-compatible optional field on `session.retry`.
This is an illustrative shape, **not an existing or approved SDK API**:

```ts
interface RetryRouteEvent {
  readonly sessionID: Session.ID
  readonly agent: Agent.ID
  readonly failed: {
    model: Model.Ref
    connection: OpaqueNativeConnectionRef | undefined // identity only, never tokens
    failure: "quota-exhausted" | "rate-limited" | "provider-error" | "transport" | "other"
    confidence: "confirmed" | "unknown"
  }
  readonly attempt: number
  readonly boundary: {
    outputStarted: boolean
    stepStarted: boolean
    localToolEffects: "none" | "possible" | "observed"
    hostedToolEffects: "none" | "possible" | "observed"
    priorTurnEffects: boolean
    delivery: "not-sent" | "rejected" | "accepted" | "ambiguous"
    replacementSafe: boolean // computed by host, not plugin
  }
  decision:
    | { retry: false }
    | { retry: true; delay: number; replacement?: {
        model: Model.Ref
        expectedConnection?: OpaqueNativeConnectionRef
      } }
}
```

This does **not** grant the plugin credentials or a stream implementation.
The plugin supplies the exact provider/model/variant and optionally an
opaque expected native connection identity. OpenCode resolves and validates
all native models, capability overlays, permission boundaries and native
connection identity. A mismatch fails closed. The plugin continues to own
model class priority, subscription attestations and paid-fallback policy.

**Compatible default:** no registered replacement hook/field means no
change to current scheduling, provider use, history or failure handling.
Existing `session.retry` callbacks keep the same shape and behavior;
do not send extended events to them until the versioned API supports it.
A hook refusal or missing candidate does not invoke a second provider.

### Host-owned transition (first supported increment)

A safe transition is **inside `SessionStep.attempt` after the provider and
tool fibers have settled, after the publisher snapshot is available, and
before `Outcome.Retry` commits or schedules another attempt**.
`SessionRunner.runStep` then applies the already validated replacement on
the next physical attempt, rebuilding the entire request and tool snapshot
through the native model resolver.

A host must check all of the following. A confirmed, authoritative quota
rejection is distinct from a transport exception whose delivery or remote
effects are unknown: receiving a provider's quota response does not by itself
forbid early fallback, but an ordinary HTTP 429 without reliable classification
must not be called `quota-exhausted`.

A host must check all of the following:

- The failure is classified and an **explicit** replacement was proposed;
  the retry budget permits it. A confident quota-exhaustion signal may be
  eligible even though the *original* route is nonretryable.
- The **entire active turn**, not merely this physical attempt, has no
  visible/reasoning/tool-input output and no local or provider-hosted tool
  effects or uncertain side effects. Any uncertainty fails closed.
- The current attempt has **not** published a durable assistant-step start
  (`publisher.hasStarted() === false`). This intentionally conservative
  first increment avoids misattributing an assistant record. If this blocks
  some providers, a separate design must atomically settle the old record
  and start a new assistant ID before extending eligibility.
- Neither cancellation/restart/move, nor ambiguous delivery or a lost
  execution lease, has occurred. A request for which provider-hosted side
  effects cannot be excluded is **not** eligible for transparent replacement.
- Target model, variant and tools are supported by the current native
  catalog; requested reasoning is retained **exactly**. No silent downgrade,
  no guessed model identity and no global-default fallback.
- A confirmed eligible native connection is selected and pinned. If the
  plugin supplied an expected opaque identity it must match the actual
  native connection. Unauthorized metered/unknown routes are rejected by the
  policy/plugin gate and must never be inferred as included by provider name.
- Session tool permissions, input, agent role, instructions and durable
  history are unchanged. Only the resolved model route for the future
  transport is replaced.

Use an internal typed `RetryWithRoute` outcome so an untrusted callback
cannot mutate the already dispatched request. Close the Session's old WS
transport/checkpoint before the replacement and re-resolve native provider
capabilities and the chosen connection under a **native turn-scoped lease**.
The lease pins the *connection identity*, not a frozen OAuth access token:
safe native credential refresh for the same account is allowed, but a different
account must never be selected implicitly. Give the native resolver an internal
`resolveModelForConnection(model, variant, connection)` path so every future
attempt/Step uses the chosen account rather than calling `connection.active()`
anew. A new `Model.Ref` by itself is insufficient because
`ModelResolver.resolveModel` otherwise reads the current active connection
again.

The resulting effective route is **turn-local** and must be used on every
later Step of the same execution. Do not change the user's persisted
`Session.model` merely to force a retry. On process loss, either restore
an authoritative durable lease safely or fail closed and require a fresh
user turn; never resume a partly executed action under an inferred account.

For provider-specific *native* compaction windows, reuse the existing
[history replay boundary](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/session/history.ts#L20-L85),
which rejects foreign model/provider windows. Never forward a checkpoint
or native replay window from the failed route as if it belonged to the
replacement model.

### Execution state decision table

| Host evidence | Replacement | Existing native behavior |
| --- | --- | --- |
| Confirmed quota exhausted, no Step.Started, no turn effects, exact permitted native alternative | **May replace** after revalidation and native lease | New provider request, one final continuation |
| Step.Started but no content | **Reject in first increment** | Ordinary same-route retry/failure; record attribution remains correct |
| Text or reasoning started | **Reject** | Normal incomplete-stream continuation on the pinned route, or fail |
| Tool input/call emitted, local tool started/settled, or provider-hosted effect possible | **Reject** | Existing tool settlement and continuation rules |
| Transport accepted/ambiguous, potential unseen effect | **Reject unless explicitly proved harmless by native driver** | Existing transport recovery; no cross-provider guess |
| Connection changed between selection and dispatch | **Reject** | No use of a different account without a new verified boundary |
| Target missing tool support or required reasoning variant | **Reject** | No variant downgrade |
| Only unknown-billing or unauthorized metered route exists | **Reject** | Never silently spend |
| Canceled, moved, resumed after uncertain process death | **Reject** | Native interrupted/recovery result, no new replay |

These checks must be **enforced in host code after all plugin callbacks**,
not trusted from a plugin-computed boolean.

## Deterministic upstream tests to add with the implementation

Use actual native test seams in
[`session-step.test.ts`](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/test/session-step.test.ts),
[`session-runner-retry.test.ts`](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/test/session-runner-retry.test.ts),
[`session-runner-tool-events.test.ts`](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/test/session-runner-tool-events.test.ts),
[`session-model-request-hooks.test.ts`](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/test/session-model-request-hooks.test.ts),
and [`session-model-transport.test.ts`](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/test/session-model-transport.test.ts).
Tests listed here are **planned**, not implemented or passed:

1. **Early quota failure succeeds:** A local primary provider raises
   `QuotaExceeded` *before* `step-start`/output; native validated hook
   nominates secondary provider for the **same model**. Assert one primary
   and one secondary `doStream`, final output only from secondary, zero tool
   effects and correct native assistant/model attribution.
2. **Late content is immutable:** Produce text-start, reasoning-start, or
   tool-input-start before error in separate cases; inject a replacement.
   Assert no secondary request, no record mutation and exact normal
   Continue/failure semantics.
3. **Tool replay prevention:** Emit actual `Tool.Called`, run native test
   executor and fail. Assert one tool execution and **zero** secondary calls.
   Repeat for provider-hosted tool calls and a tool whose effect may be
   running at cancellation.
4. **Step-start/no-output guard:** Emit provider `step-start` then fail.
   Assert explicit rejection of replacement even though
   `outputStarted=false`; correct assistant attribution.
5. **Native account lease:** Resolve `provider-A/account-1`, activate
   `account-2` while the stream is active and after a tool continuation.
   Assert native requests never silently move to account-2; once a fresh
   turn begins, revalidation may choose a new account.
6. **Target verification:** Missing model, tools, requested reasoning
   variant, invalid/expired connection, and rejected paid/unknown billing
   all block before target transport. No raw credentials reach plugin
   traces.
7. **WebSocket isolation:** A failed route with a native checkpoint must
   close/clear it before new model transport. Verify no replay of the old
   WS continuation or provider-specific native compaction window.
8. **Cancellation/restart/compaction:** Cancel during the retry decision,
   reload after interrupted/fallen process with unknown side effects,
   and compact before retry. Never resurrect an unsafe replacement or
   replay previously committed effects.
9. **Disabled and old plugin compatibility:** Existing hook-only retry,
   native default routing, auxiliary titles/compaction and explicit
   Session model selections behave exactly as they did without this
   feature. No extra transport attempt and no implicit paid fallback.
10. **Installed V2 adapter qualification:** Actual packed Loom plugin
    with local V2 providers must observe native selected provider,
    model, account identity and reasoning across the switch. Concurrent
    processes must use **the separate product quota interface**; a
    fake in-test quota/router cannot satisfy this gate.

A test that only calls a newly introduced pure helper does **not** prove the
real host retry boundary; include deterministic integrated `SessionRunner`
execution and separate opt-in real-provider acceptance.

## Alternatives considered

| Option | Result |
| --- | --- |
| Existing `session.retry` + `session.switchModel` | **Unsafe**: hook has no host-safe boundary, switch mutates persisted model outside the running request, and account affinity is not atomic |
| `ctx.agent.transform` | **Supported for initial model selection on 2.1.4**, not an in-flight replacement |
| `session.model.request`, HTTP/WS rewriting | **Insufficient**: already-resolved model and provider auth are owned by host; protocol rewrite cannot promise correct native execution |
| Virtual provider or model gateway | **Out of scope**: takes over provider protocol/credentials and cannot guarantee native tool/account semantics |
| Post-interruption new prompt on main agent | **Safe supported operational alternative** when explicitly a new turn, using saved Loom state and independently verified quota. Not transparent replay |
| Proposed host-owned retry-route hook with native lease | **Preferred**: smallest reliable path, but requires runner, resolver, transport and publication coordination |

Prior related upstream work:
[`#20100`](https://github.com/anomalyco/opencode/issues/20100)
and [`#20105`](https://github.com/anomalyco/opencode/pull/20105)
address configurable transient model fallback;
[`#47846`](https://github.com/anomalyco/opencode/pull/47846)
attempted connected-account rotation. The latter two PRs were closed by
automated age/engagement cleanup, **not** by a documented technical
rejection. None is a supported shipped plugin API.

## Implementation decision and limits

**Recommend an upstream feature discussion/issue first**, with the restricted
boundary and native connection semantics above. Do **not** implement
`nextModel` alone or monkey-patch OpenCode internals from Loom. Review
whether requiring `!publisher.hasStarted()` leaves enough usable
pre-output failures; if not, add a separately reviewed, durable assistant
attempt transition before widening replacement eligibility.

**No upstream code, tests, or PR created as part of this source-only
investigation.** The host design is feasible in principle, but safety is
**UNPROVEN** until an upstream branch supplies native execution and
provider/account/stream/tool negative tests. Real-provider verification is
also **UNPROVEN** and needs explicit permitted account access and spending
authorization.

## Depends on

- [Loom native initial routing design](model-routing-v2-dispatch.md) — the
  consuming plugin must use supported OpenCode V2 boundaries, not own
  credentials or transport
- [Loom model route policy](model-routing.md) — ordered eligible provider
  choices, billing guards and strict reasoning
