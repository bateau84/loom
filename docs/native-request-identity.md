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

Findings below are grounded in *tagged 2.2.0 host source* and [deterministic source-modeled counterexamples](../tests/test_native_request_identity.py). The tests reproduce indistinguishable public callback shapes; **they are not recorded installed-host traces**, nor proof that a live subscription request was billed to either account. I additionally inspected the tagged [v2.2.4 Promise hooks](https://github.com/anomalyco/opencode/blob/v2.2.4/packages/plugin/src/promise/session.ts#L62-L140) and [model resolver](https://github.com/anomalyco/opencode/blob/v2.2.4/packages/core/src/model-resolver.ts#L453-L468); the decisive identity fields remain absent. That is a **source check only**, not 2.2.4 installed acceptance.

## Supported surfaces versus missing guarantees

| Host surface | Evidence that is usable | Missing for this work | Status |
| --- | --- | --- | --- |
| `model.request` hook | `kind` = primary/compaction/title/generate; Session, agent, model before send | Unique request/attempt IDs, transport-bound account | **AVAILABLE** for request kind; **PARTIAL** overall |
| `retry` hook | Session, agent, model, normalized error, numeric retry ordinal and decision | Request kind, unique owner attempt and resolved account | **PARTIAL** |
| `integration.connection.active()` | Current credential *record ID* or an environment variable *name* | Proof that this value is what the actual provider request used; real env-backed account identity | **PARTIAL** |
| `http.request` and `http.response` | `kind` and a shared Request object *within one HTTP wrapper*; response status/headers | Link to other hooks and native account; completed body/stream proof; universal WebSocket coverage | **AVAILABLE** for an HTTP request/headers pair only; **PARTIAL** for quota attribution |
| Experimental WebSocket hooks | Request kind on handshake/send/receive | Bound account, unique exchange/attempt identity, completed outcome | **PARTIAL** |
| `session.step.*`, `session.retry.scheduled`, `session.execution.*` | Session/assistant-message IDs, retry ordinal and lifecycle observations | A native request/account join; execution terminal events carry only Session identity | **PARTIAL** |
| Account-scoped `recordFailure` / `recordSuccess` | Guarded methods already implemented in [shared quota storage](shared-subscription-quota.md) | Authoritative native attempt/account evidence to call them | **BLOCKED** |

### Tagged source paths

- [Promise Session hook interfaces](https://github.com/anomalyco/opencode/blob/v2.2.0/packages/plugin/src/promise/session.ts#L58-L152): request hook has `kind`; retry hook has `attempt` (an ordinal), but not `kind` or stable request ID.
- [Native request preparation and hooks](https://github.com/anomalyco/opencode/blob/v2.2.0/packages/core/src/session/model-request.ts#L230-L385): the request, HTTP interceptors and retry callback are prepared separately, without a shared published correlation ID.
- [Native resolver](https://github.com/anomalyco/opencode/blob/v2.2.0/packages/core/src/model-resolver.ts#L449-L465): `integration.connection.active()` then `connection.resolve()` happens while building the native model, but the resolved connection reference is not attached to request/settlement callbacks.
- [Active connection and OAuth refresh](https://github.com/anomalyco/opencode/blob/v2.2.0/packages/core/src/integration.ts#L729-L765), [connection schema](https://github.com/anomalyco/opencode/blob/v2.2.0/packages/schema/src/connection.ts#L18-L38): credential record ID can be stable through token refresh, while env name is not an account; independent plugin lookup is not an atomic transport lease.
- [Retry construction](https://github.com/anomalyco/opencode/blob/v2.2.0/packages/core/src/session/runner/retry.ts#L32-L53), [compaction using that policy](https://github.com/anomalyco/opencode/blob/v2.2.0/packages/core/src/session/compaction.ts#L640-L675), [title failures](https://github.com/anomalyco/opencode/blob/v2.2.0/packages/core/src/session/title.ts#L71-L103): `retry` is neither unambiguously typed by request kind nor a complete feed of nonretryable outcomes.
- [Step lifecycle](https://github.com/anomalyco/opencode/blob/v2.2.0/packages/schema/src/session-event.ts#L333-L391), [execution terminal schemas](https://github.com/anomalyco/opencode/blob/v2.2.0/packages/schema/src/session-event.ts#L244-L262), [retry scheduled schema](https://github.com/anomalyco/opencode/blob/v2.2.0/packages/schema/src/session-event.ts#L574-L585): assistant-message identity is not a transport-attempt identity. [Session execution](https://github.com/anomalyco/opencode/blob/v2.2.0/packages/core/src/session/execution.ts#L108-L143) settles a busy period, not every concurrent native request.
- [Primary retries/continuations](https://github.com/anomalyco/opencode/blob/v2.2.0/packages/core/src/session/runner/llm.ts#L205-L310) and [stream/tool work](https://github.com/anomalyco/opencode/blob/v2.2.0/packages/core/src/session/runner/step.ts#L73-L151): more than one native call can be involved in a Session turn. [AISDK plugin hooks](https://github.com/anomalyco/opencode/blob/v2.2.0/packages/plugin/src/promise/aisdk.ts#L1-L22) are model-construction hooks, not a per-attempt authenticated settlement API.

HTTP 200 means headers arrived, **not** a successful completed model stream. Header inspection cannot safely substitute for native account attribution: credentials are secret, some transports use WebSocket, and headers need not reveal a stable billing account.

## Failing counterexample: late auxiliary B versus primary A

A compaction uses actual native account **B**. The same Session then makes a primary request with native account **A**, using the same agent/model. The public hook sequence can be:

```text
model.request(session=S, agent=general, model=M, kind=compaction)
model.request(session=S, agent=general, model=M, kind=primary)
retry(session=S, agent=general, model=M, attempt=1, error=provider.quota)
```

Two distinct real explanations produce this **same observable sequence**:

| Origin of final retry | Account that should own the quota error |
| --- | --- |
| Late callback from compaction | B |
| Callback from newer primary | A |

No rule based only on Session/model/agent, order or retry ordinal can pick the correct account in both worlds. **“Attribute to latest primary” incorrectly exhausts A when B actually failed.** See [`tests/test_native_request_identity.py`](../tests/test_native_request_identity.py) for eight deterministic indistinguishability witnesses. The existing [candidate integration tests](../tests/model-routing-quota-integration-native.test.ts) implement a conservative ambiguity fence; they do not establish positive native account binding.

## Case-by-case pairing

| Case | Current pairing | Safe Loom response |
| --- | --- | --- |
| Dispatch request kind | **Yes**, for kind only | Use the kind for guarding; never infer account/settlement |
| HTTP operation to its response headers | **Yes**, inside its own HTTP wrapper only | No success or account quota write from HTTP status |
| Repeated primary attempts | **No exact join** | Treat any conflicting owner as unattributed |
| Primary plus delayed compaction/title/generate | **No exact join** | Preserve ambiguity fence; classified unsafe retries can be suppressed |
| Nonretryable auxiliary failures or successful streams | **No complete per-attempt feed** | Never invent a successful probe or quota report |
| Tool continuation / another primary request | **No exact join** | Message/step IDs cannot stand in for attempt IDs |
| Cancellation, subscriber loss, delayed execution terminal | **No exact owner** | Never let an old terminal release a newer reservation |
| Restart / prior pending request | **No durable proven join** | Old unmatched reports remain unknown |
| Credential activation, refresh, environment-backed login | **No dispatch-bound account** | A fresh `active()` lookup cannot authorize account-level accounting |

## Smallest required host guarantees

These are **needed for an eventual supported OpenCode interface**, not statements that v2.2.0 implements them.

1. **Native identity:** unique opaque `requestID` for each logical model invocation (including primary, title, compaction and generate) and unique `attemptID` for each actual provider send. Carry both through pre-send admission, retry and terminal outcome, with Session ID, request kind, agent, model and ordinal. Never derive identity from Session ID/ordinal; IDs cannot collide after restart.
2. **Bound native connection:** the host exposes its resolved non-secret credential/account reference at a **host-owned last pre-transport admission point** and uses that exact connection for the send or rejects before transport. Subsequent refresh, retry, WebSocket reuse and tool continuation must not silently change accounts. A plugin-side `connection.active()` query is *not* this guarantee. Credential ID alone does not attest included billing; env names without real account identity remain unknown.
3. **Final per-attempt settlement:** a host-authored terminal event carrying both IDs and actual bound connection after completed stream or final error. Typed quota/rate-limit/auth evidence may include verified HTTP status and retry-after. Distinguish provider refusal, auth-resolution failure, incomplete stream, cancellation and process loss; **no event** and HTTP 200 do not mean success.
4. **Ordering, duplicates, loss:** pre-send decision settles before any I/O. Late and duplicate outcomes remain tied to the original attempt; concurrent contenders cannot claim one attempt as different accounts. Clearly define denied dispatch, cancelled attempts, event loss, recovery and restarted process behavior. Old evidence cannot override a newer quota recovery epoch.
5. **Compatibility/privacy:** old plugins continue native behavior; managed routing without required evidence must refuse transport. Do not expose keys, access/refresh tokens, authorization headers or prompt/response bodies in identity callbacks or logs. Unknown/unsupported required identity fields block managed routing, not merely weaken its evidence.

**Ownership:** OpenCode owns native credential selection, transport, lifecycle and outcome; Loom owns routing policy and existing quota `reserve`, `recordFailure` and `recordSuccess` calls. This proposal does not grant Loom native transport replay, tool replay or a subscription entitlement. An exact identity-equivalence and credential-refresh revision rule belongs to upstream before implementation.

## Illustrative upstream API — not implemented or accepted

One possible *narrow* extension is a request ID on `model.request`, paired with a host-owned pre-send admission and per-attempt settlement. Equivalent supported APIs are acceptable; these names/shapes are **examples only**:

```ts
type NativeConnectionRef =
  | { type: "credential"; id: string; revision?: string }
  | { type: "env"; name: string } // never an account ID
  | { type: "unknown" }

type NativeAttempt = {
  sessionID: string
  requestID: string       // logical model invocation; preserved across retries
  attemptID: string       // distinct actual transport send
  kind: "primary" | "compaction" | "title" | "generate"
  agent: string
  model: { providerID: string; id: string; variant?: string }
  connection: NativeConnectionRef // bound in the native resolver, not plugin lookup
}

interface BeforeNativeSend extends NativeAttempt {
  decision: { allow: true } | { allow: false; reason: string }
}

interface NativeAttemptSettled extends NativeAttempt {
  outcome: "succeeded" | "failed" | "cancelled" | "unknown"
  error?: { type: string; status?: number; retryAfterMs?: number }
}
```

A hook that *observes* one connection but allows native transport to use another is **insufficient**. So is adding `attemptID` only to `retry`: title failures, successful completions and nonretryable errors need the same join. Upstream must specify event identity and atomicity before two independent implementations could safely interoperate. This identity proposal is separate from the larger [host-owned live fallback proposal](opencode-v2-safe-live-fallback.md).

## Installed-host acceptance required before activation

These are **future tests**, not results of this investigation. Use a version-matched installed OpenCode host, scripted local provider, fake distinguishable account identities and independently recorded actual transport selection, without real paid traffic.

| Test | Required result |
| --- | --- |
| I-01 Primary send | One known kind and actual bound credential; IDs propagate to completed stream |
| I-02 429 retry | Fresh attempt ID per network send, same logical request ID; matching typed error |
| I-03 Delayed compaction B after primary A | B error never exhausts A |
| I-04 Concurrent title/compaction/primary | Unique IDs and correct per-kind terminal owner, including nonretryable errors |
| I-05 Tool continuation | Subsequent primary has distinct attempt; old terminal cannot settle it |
| I-06 Credential switch before send | Bound account is revalidated or rejected **before** transport |
| I-07 OAuth refresh | Identity remains properly account-bound; refresh revision semantics documented |
| I-08 HTTP 200, then stream error | No false success; final failure identifies own attempt |
| I-09 WebSocket reuse/fallback | Exchange/fallback attempt and account identity retained |
| I-10 Cancellation and restart | No invented success, no accidental ID reuse or unproven lease restoration |
| I-11 Duplicate/out-of-order events | Idempotent settlement; stale quota evidence cannot poison newer recovery |
| I-12 Existing plugins/unknown capability | Old plugin behavior preserved; managed routing fails before unsafe send |

**Next step:** raise/align this narrowly scoped contract upstream, *without submitting an upstream patch here*. Only supported host code plus installed positive acceptance can unblock the request/account dependency in [#206](https://github.com/bateau84/loom/issues/206). [#204](https://github.com/bateau84/loom/issues/204) separately must prove account-bound included/no-paid billing. [#207](https://github.com/bateau84/loom/issues/207) cannot truthfully record success/recovery before that evidence exists. **Current managed-routing status remains BLOCKED.**

## Depends on

- [Model routing](model-routing.md) — Candidate policy and billing restrictions
- [Shared subscription quota](shared-subscription-quota.md) — Account-scoped state and revision fences
- [Safe native fallback proposal](opencode-v2-safe-live-fallback.md) — Separate retry-switch authority, unimplemented
- [OpenCode 2.2.0 qualification](opencode-2.2.0.md) — Current matched SDK/CLI baseline
