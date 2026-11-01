---
type: Architecture
title: "Native request identity and account-bound quota attribution"
description: "Issue #205: OpenCode 2.2.0 SDK/CLI audit, counterexamples, blockers, and upstream acceptance contract."
tags: [loom, opencode, quota, model-routing, upstream, compatibility]
timestamp: 2026-11-01T00:00:00Z
---

# Native request identity and account-bound quota attribution

**Issue:** [#205](https://github.com/bateau84/loom/issues/205); tracked under [#203](https://github.com/bateau84/loom/issues/203).  
**Verdict: BLOCKED for exact account-bound quota attribution.** Existing OpenCode hooks identify *some* aspects of a request, but do not reliably link the native account and transport attempt to later failures and completions. This is an **investigation**, not authorization to re-enable managed routing or submit upstream code.

## Baseline and evidence

Loom pins `@opencode/plugin@2.2.0` in [package.json](../package.json). Its [installed routing workflow](../.github/workflows/installed-model-routing-acceptance-v214.yml) installs a separate unmodified `@opencode/cli@2.2.0` and runs local scripted-provider **negative** controls. [PR #190](https://github.com/bateau84/loom/pull/190) is merged, but the production [`registerModelRouting()`](../src/model-routing-adapter.ts) still reports `not-connected` for managed routing on an unqualified host/SDK pair. The historical 2.1.4 candidate is **not** the production path.

Findings below are grounded in *tagged 2.2.0 host source* and [deterministic source-modeled counterexamples](../tests/test_native_request_identity.py). The tests model six pairwise ambiguous public callback observations and two narrower negative examples; **they are not recorded installed-host traces**, nor proof that a live subscription request was billed to either account. I additionally inspected the tagged [v2.2.4 Promise hooks](https://github.com/anomalyco/opencode/blob/v2.2.4/packages/plugin/src/promise/session.ts#L62-L140) and [model resolver](https://github.com/anomalyco/opencode/blob/v2.2.4/packages/core/src/model-resolver.ts#L453-L468); the decisive identity fields remain absent. That is a **source check only**, not 2.2.4 installed acceptance.

## Supported surfaces versus missing guarantees

| Host surface | Evidence that is usable | Missing for this work | Status |
| --- | --- | --- | --- |
| `model.request` hook | `kind` = primary/compaction/title/generate; Session, agent, model before send | Unique request/attempt IDs, transport-bound account | **AVAILABLE** for request kind; **PARTIAL** overall |
| `retry` hook | Session, agent, model, normalized error, numeric retry ordinal and decision | Request kind, unique owner attempt and resolved account | **PARTIAL** |
| `integration.connection.active()` | Current credential *record ID* or an environment variable *name* | Proof that this value is what the actual provider request used; real env-backed account identity | **PARTIAL** |
| `http.request` and `http.response` | `kind`, the same Web `request: Request` object within one HTTP wrapper, and `response: Response` with `response.status` | Link to other hooks and native account; completed body/stream proof; universal WebSocket coverage | **AVAILABLE** for an HTTP request/headers pair only; **PARTIAL** for quota attribution |
| Experimental WebSocket hooks | Request kind on handshake/send/receive | Bound account, unique exchange/attempt identity, completed outcome | **PARTIAL** |
| `session.step.*`, `session.retry.scheduled`, `session.execution.*` | Session/assistant-message IDs, retry ordinal and partial lifecycle events including `session.step.streamed` and `session.step.failed` | A native request/account join; execution terminal events carry only Session identity | **PARTIAL** |
| Account-scoped `recordFailure` / `recordSuccess` | Guarded methods already implemented in [shared quota storage](shared-subscription-quota.md) | Authoritative native attempt/account evidence to call them | **BLOCKED** |

### Tagged source paths

- [Promise Session hook interfaces](https://github.com/anomalyco/opencode/blob/v2.2.0/packages/plugin/src/promise/session.ts#L58-L152): request hook has `kind`; retry hook has `attempt` (an ordinal), but not `kind` or stable request ID.
- [Native request preparation and hooks](https://github.com/anomalyco/opencode/blob/v2.2.0/packages/core/src/session/model-request.ts#L230-L385): the request, HTTP interceptors and retry callback are prepared separately, without a shared published correlation ID.
- [Native resolver](https://github.com/anomalyco/opencode/blob/v2.2.0/packages/core/src/model-resolver.ts#L449-L465): `integration.connection.active()` then `connection.resolve()` happens while building the native model, but the resolved connection reference is not attached to request/settlement callbacks.
- [Active connection and OAuth refresh](https://github.com/anomalyco/opencode/blob/v2.2.0/packages/core/src/integration.ts#L729-L765), [connection schema](https://github.com/anomalyco/opencode/blob/v2.2.0/packages/schema/src/connection.ts#L18-L38): credential record ID can be stable through token refresh, while env name is not an account; independent plugin lookup is not an atomic transport lease.
- [Retry policy](https://github.com/anomalyco/opencode/blob/v2.2.0/packages/core/src/model-retry.ts#L42-L59) starts with ordinal 1 and increments before the first `retry` callback, so the first reported `attempt` is **2**, not 1. [Retry construction](https://github.com/anomalyco/opencode/blob/v2.2.0/packages/core/src/session/runner/retry.ts#L32-L53), [compaction using that policy](https://github.com/anomalyco/opencode/blob/v2.2.0/packages/core/src/session/compaction.ts#L640-L675), [title failures](https://github.com/anomalyco/opencode/blob/v2.2.0/packages/core/src/session/title.ts#L71-L103): `retry` is neither unambiguously typed by request kind nor a complete feed of nonretryable outcomes.
- [Step lifecycle](https://github.com/anomalyco/opencode/blob/v2.2.0/packages/schema/src/session-event.ts#L333-L391) includes `session.step.streamed` (response-body boundary) and `session.step.failed` (step failure); neither exposes native transport attempt and effective billing account together. Other step events, [execution terminal schemas](https://github.com/anomalyco/opencode/blob/v2.2.0/packages/schema/src/session-event.ts#L244-L262), [retry scheduled schema](https://github.com/anomalyco/opencode/blob/v2.2.0/packages/schema/src/session-event.ts#L574-L585): assistant-message identity is not a transport-attempt identity. [Session execution](https://github.com/anomalyco/opencode/blob/v2.2.0/packages/core/src/session/execution.ts#L108-L143) settles a busy period, not every concurrent native request.
- [Primary retries/continuations](https://github.com/anomalyco/opencode/blob/v2.2.0/packages/core/src/session/runner/llm.ts#L205-L310) and [stream/tool work](https://github.com/anomalyco/opencode/blob/v2.2.0/packages/core/src/session/runner/step.ts#L73-L151): more than one native call can be involved in a Session turn. [AISDK plugin hooks](https://github.com/anomalyco/opencode/blob/v2.2.0/packages/plugin/src/promise/aisdk.ts#L1-L22) are model-construction hooks, not a per-attempt authenticated settlement API.

The HTTP callback uses the native `request` object on both `http.request` and `http.response`, with `response.status` on the Web Response object. HTTP 200 means headers arrived, **not** a successful completed model stream. Header inspection cannot safely substitute for native account attribution: credentials are secret, some transports use WebSocket, and headers need not reveal a stable billing account.

## Failing counterexample: late auxiliary B versus primary A

A compaction uses actual native account **B**. The same Session then makes a primary request with native account **A**, using the same agent/model. The public hook sequence can be:

```text
model.request(session=S, agent=general, model=M, kind=compaction)
model.request(session=S, agent=general, model=M, kind=primary)
retry(session=S, agent=general, model=M, attempt=2, error=provider.quota)
```

Two distinct real explanations produce this **same observable sequence**:

| Origin of final retry | Account that should own the quota error |
| --- | --- |
| Late callback from compaction | B |
| Callback from newer primary | A |

No rule based only on Session/model/agent, order or retry ordinal can pick the correct account in both worlds. **“Attribute to latest primary” incorrectly exhausts A when B actually failed.** See [`tests/test_native_request_identity.py`](../tests/test_native_request_identity.py) for six pairwise ambiguity demonstrations plus two smaller checks (lost pending state after restart and HTTP 200 preceding success/failure). They use source-shaped data, not host event captures or production quota attribution. The existing [candidate integration tests](../tests/model-routing-quota-integration-native.test.ts) implement a conservative ambiguity fence; they do not establish positive native account binding.

## Case-by-case pairing

| Case | Current pairing | Safe Loom response |
| --- | --- | --- |
| Dispatch request kind | **Yes**, for kind only | Use the kind for guarding; never infer account/settlement |
| HTTP operation to its response headers | **Yes**, using the same Web Request object and `response.status` inside one HTTP wrapper only | No success or account quota write from HTTP status |
| Repeated primary attempts | **No exact join** | Treat any conflicting owner as unattributed |
| Primary plus delayed compaction/title/generate | **No exact join** | Preserve ambiguity fence; classified unsafe retries can be suppressed |
| Nonretryable auxiliary failures or successful streams | **No complete per-attempt feed** | Never invent a successful probe or quota report |
| Tool continuation / another primary request | **No exact join** | Message/step IDs and `session.step.streamed` / `session.step.failed` cannot stand in for an attempt/account ID |
| Cancellation, subscriber loss, delayed execution terminal | **No exact owner** | Never let an old terminal release a newer reservation |
| Restart / prior pending request | **No durable proven join** | Old unmatched reports remain unknown |
| Credential activation, refresh, environment-backed login | **No dispatch-bound account** | A fresh `active()` lookup cannot authorize account-level accounting |

**Background compaction condition:** A delayed **background** compaction scenario requires a real overlapping auxiliary send. In tagged OpenCode 2.2.0 the compaction state defaults to `precompute: false`; `settings.precompute` must be enabled (with `settings.auto`) to exercise detached precomputation. The request-kind/retry ambiguity is not limited to this mode, but the background concurrency example must not be represented as the default behavior. <https://github.com/anomalyco/opencode/blob/v2.2.0/packages/core/src/session/compaction.ts#L257-L377>.

## Smallest required host guarantees

This is the **minimum upstream dependency for safe account-scoped quota accounting**, not a claim that OpenCode v2.2.0 already exposes it.

1. **Unique transport-attempt identity:** Every actual provider send (primary, compaction, title, generate, HTTP or WebSocket) gets a fresh opaque collision-resistant `attemptID`. An attempt cannot be confused with a Session ID, retry ordinal, assistant-message ID or an attempt from a prior process. Retries and continuations that cause another send have another `attemptID`.
2. **Actual effective billing account:** At a host-owned **last pre-transport admission boundary**, the native provider integration establishes which provider-scoped **effective billing principal** the provider will charge, **independently from the credential record ID**. The account can be `verified` with a non-secret, provider-accepted opaque account/workspace/seat reference, or `unknown`. The latter **must deny managed/account-scoped dispatch**. Resolving the active credential record via `connection.active()` is not proof of the actual billable identity. Credential refresh, replacement, OAuth method migration, header/auth transformations and reused WebSocket connections must be rebound or rejected **before any send**, even if the record ID is unchanged. The host defines equality of billing accounts from provider evidence, not a hash or string guess by Loom.
3. **Host-enforced pre-send authority:** The admission decision and actual native send use the **same established effective account and credential generation**. If the provider cannot attest the principal, the request changes auth, or the host cannot hold this invariant through transport, it rejects rather than claiming a lease. A plugin-side snapshot followed by an unrestricted request is insufficient.
4. **Final per-attempt settlement:** Each attempt's final completed stream, normalized failure (including nonretryable), cancellation or unknown/lost outcome retains its `attemptID`, the bound effective account, request kind and model. Header-only HTTP 200 and Session/step terminal events are insufficient. Duplicate/delayed/omitted events and restart must never attribute an outcome to a newer attempt or override newer quota recovery; missing settlement remains unknown.
5. **Privacy and compatibility:** No secrets, raw authorization headers, tokens or body content are exposed in correlation fields. Old plugins retain native behavior; managed routing without a verified account and required attempt binding fails closed. This **does not** prove entitlement to included-only billing; #204 separately owns provider-enforced no-paid assurance.

**Optional grouping ID (not required for the quota-safety minimum):** A future `requestID` could group attempts belonging to one logical operation. If added, the host must specify its lifecycle: an operation starts before the first `model.request`; each retry creates a new attempt but keeps that operation ID; a distinct compaction/title/generate operation or a new post-tool continuation starts a new operation. The native primary runner rebuilds `model.request` in its retry loop; the hook invocation is **not** a safe logical-operation boundary. The minimum quota contract above needs only `attemptID` plus the effective account, so no requester must invent this grouping identifier.

**Ownership:** OpenCode owns final authentication, the effective-account binding, the send boundary and settlement. The provider owns proof of billing principal and the included-only policy (#204). Loom owns the route policy and guarded SQLite `reserve`, `recordFailure`, and `recordSuccess`. This issue does not authorize changing native models in-flight or replaying tools.

## Illustrative upstream API — not implemented or accepted

An equivalent supported host API may be smaller or differently shaped. These example fields illustrate the **required guarantee**, not mandatory upstream names:

```ts
type EffectiveAccount =
  | {
      state: "verified"
      providerID: string
      billingPrincipalID: string // opaque provider-scoped billing account, not credential ID
      credentialRecordID?: string // optional comparison reference, NOT account proof
      authenticationMethodID: string // exact method (e.g. not merely "oauth")
      credentialRevision: string // must change if final authentication identity changes
    }
  | { state: "unknown" }

type NativeAttempt = {
  sessionID: string
  attemptID: string // fresh for each actual provider send; never a retry ordinal
  kind: "primary" | "compaction" | "title" | "generate"
  agent: string
  model: { providerID: string; id: string; variant?: string }
  account: EffectiveAccount // established after final native auth/provider setup
  requestID?: string // OPTIONAL logical-operation grouping, with separately defined lifecycle
}
interface BeforeNativeSend extends NativeAttempt {
  decision: { allow: true } | { allow: false; reason: string }
}
interface NativeAttemptSettled extends NativeAttempt {
  outcome: "completed-stream" | "failed" | "cancelled" | "unknown"
  error?: { type: string; status?: number; retryAfterMs?: number }
}
```

If plugins can change auth headers after the binding is established, the host must **re-establish the binding or refuse**. A matching credential ID is never a substitute. A settled event must describe the **actual send account**, not whatever `connection.active()` reports later.

## Installed-host acceptance required before activation

These are **future tests**, not results of this investigation. Use a version-matched installed OpenCode host, scripted local provider, fake distinguishable account identities and independently recorded actual transport selection, without real paid traffic.

| Test | Required result |
| --- | --- |
| I-01 Primary send | One actual provider-scoped effective billing account (or managed denial) and fresh attempt ID; same ID/account on completed stream |
| I-02 429 retry | Fresh attempt ID per send; retry error and final outcome match the failed attempt/account. If an optional logical request ID exists, its grouping is stable across retries. |
| I-03 Delayed compaction B after primary A | B error never exhausts A |
| I-04 Concurrent title/compaction/primary | Unique IDs and correct per-kind terminal owner, including nonretryable errors |
| I-05 Tool continuation | Subsequent primary has distinct attempt; old terminal cannot settle it |
| I-06 Credential switch before send | Bound account is revalidated or rejected **before** transport |
| I-07 OAuth refresh / method migration | Effective principal is re-verified after refresh or auth-method migration even if credential record ID stays unchanged; missing evidence denies |
| I-08 HTTP 200, then stream error | No false success; final failure identifies own attempt |
| I-09 WebSocket reuse/fallback | Every send/exchange binds the actual provider billing principal; auth or socket reuse that changes it is re-bound or rejected |
| I-10 Cancellation and restart | No invented success, no accidental ID reuse or unproven lease restoration |
| I-11 Duplicate/out-of-order events | Idempotent settlement; stale quota evidence cannot poison newer recovery |
| I-12 Existing plugins/unknown capability | Old plugin behavior preserved; an unknown effective billing account, transformed auth or missing attempt settlement blocks managed routing before unsafe send |

**Next step:** raise/align this narrowly scoped contract upstream, *without submitting an upstream patch here*. Only supported host code plus installed positive acceptance can unblock the request/account dependency in [#206](https://github.com/bateau84/loom/issues/206). [#204](https://github.com/bateau84/loom/issues/204) separately must prove account-bound included/no-paid billing. [#207](https://github.com/bateau84/loom/issues/207) cannot truthfully record success/recovery before that evidence exists. **Current managed-routing status remains BLOCKED.**

## Depends on

- [Model routing](model-routing.md) — Candidate policy and billing restrictions
- [Shared subscription quota](shared-subscription-quota.md) — Account-scoped state and revision fences
- [Safe native fallback proposal](opencode-v2-safe-live-fallback.md) — Separate retry-switch authority, unimplemented
- [OpenCode 2.2.0 qualification](opencode-2.2.0.md) — Current matched SDK/CLI baseline
