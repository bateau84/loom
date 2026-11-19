---
type: Architecture
title: "OpenCode 2.3.0 native send identity and account-binding qualification — issue 205"
description: "Source, installed-host discriminators, observable limits, minimal host/provider contract and bounded acceptance matrix."
tags: [loom, opencode, native, billing, routing, qualification]
timestamp: 2026-11-19T00:00:00Z
---

# Native send identity and effective billing account — OpenCode 2.3.0

**Decision: PARTIAL host mechanics / BLOCKED effective native attempt-and-billing identity.** The exact pinned `@opencode/plugin@2.3.0` + installed `@opencode/cli@2.3.0` can apply a same-provider, request-local model choice and validate the resulting model at request *preparation*. It cannot, through inspected supported plugin fields, bind **each physical send**, the effective billable account, credential revision, provider-enforced no-paid policy and its eventual outcome together. **Zero real provider/account/model routes have qualified.**

This is a **host-contract investigation** for [#205](https://github.com/bateau84/loom/issues/205), not implementation of an upstream interface, authorization for real provider inference or satisfaction of [#206](https://github.com/bateau84/loom/issues/206). See the older [2.2.0 source-modelled witnesses](native-request-identity.md) for historical context; they are not current version evidence.

## Evidence and exact provenance

| Mechanism or claim | Direct evidence at 2.3.0 | What is proven |
| --- | --- | --- |
| Model selection/guard | [Native resolver](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/core/src/session/runner/model.ts#L94-L125) and [session hook definitions](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/plugin/src/promise/session.ts#L62-L150) | Model choice is **same-provider/request-local**; `model.request` sees resolved model/kind but not an attempt ID or billable principal. |
| Credential preparation | [ModelResolver.prepare](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/core/src/model-resolver.ts#L437-L505) | Native provider integration calls `connection.active()` then `connection.resolve()`, and builds the runtime model. No supported plugin-visible, transport-bound **effective provider billing account/credential generation** is produced by these calls. A stored connection ID is not authoritative proof of who is billed. |
| Prepared auxiliary requests | [Generate once, retry prepared](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/core/src/session/generate.ts#L39-L73), [compaction delivery loop](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/core/src/session/compaction.ts#L618-L713) | **Each retry can make another provider attempt without rerunning `model.request`**. Quota/policy changes between sends are not covered by a request-preparation guard. |
| Primary retries | [Session runner retry](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/core/src/session/runner/retry.ts#L36-L68) and [request preparation](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/core/src/session/model-request.ts#L353-L454) | `retry.attempt` is a *numeric ordinal*, not a globally unique send identity, and contains no kind or billable principal. |
| HTTP and WebSocket hooks | [Session plugin contract](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/plugin/src/promise/session.ts#L95-L147) and [native request wrapper](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/core/src/session/model-request.ts#L374-L434) | HTTP request/response expose a paired Request object for that HTTP call, not a durable attempt ID, settlement or effective account. WS handshake occurs at connection establishment/reuse, while frames lack a host-bound billing principal and per-send attempt ID. HTTP hooks are not guaranteed to be used by every provider transport. |
| Installed same-provider mechanics | [Merged Loom PR #243](https://github.com/bateau84/loom/pull/243) at tested `217a80088239c13d0e115087f99b510afa73f57e`, [installed-routing CI](https://github.com/bateau84/loom/actions/runs/44569443361/job/135720158088) | **19/19 local-provider cases** passed, with actual selected model/variant. Crucially, **generate retry: 1 resolve, 1 `model.request`, 2 provider sends**; primary retry: **2/2/2**. This is real installed-host *mechanics*, not real subscription billing. |
| Independent source-modelled ambiguities | [2.3.0 witness tests](../tests/test_native_request_identity_230.py), plus [historical tests](../tests/test_native_request_identity.py) | Two distinct hidden account/attempt histories can project to identical public hook fields. These are **source-modelled counterexamples**, not captured provider traces. |

**Supported in part:** native selected request model, variant, Session ID, agent and kind; early route refusal while hooks are registered; per-HTTP Request object linkage for paired HTTP hooks. **Not established:** native immutable attempt ID, native actual effective billing principal/credential revision, provider no-paid policy enforced through an untrusted-plugin failure, or final per-attempt settlement after cancellation/crash.

### Concrete retry counterexample

The exact installed 2.3.0 request-local fixture produces:

| Path | `experimental.model.resolve` | `model.request` | Local provider sends |
| --- | ---: | ---: | ---: |
| Primary retry | 2 | 2 | 2 |
| Prepared generate retry | 1 | 1 | 2 |

Thus **counting model.request approvals cannot count or authorize all physical sends**. A second prepared send can happen after the first attempt fails, without fresh plugin-side quota eligibility or identity validation. A provider-side enforced no-paid guarantee is especially important for this path and for the **plugin-not-loaded** case.

The new 2.3.0 Python witness file also models separate compaction/primary retries, HTTP 200 preceding an unknown streamed result, WebSocket re-use and different effective credentials projecting to identical public callback data. It intentionally annotates synthetic private send/account IDs; those annotations are **never represented as observed native fields**.

## Smallest contract that can unblock #205

The host/provider integration must establish a **send-time** boundary, not just a Session or request-preparation boundary. Field names below are proposals, not currently supported OpenCode SDK types.

1. **Atomic per-send admission.** For each physical HTTP/WS/model send (including prepared retries), the host assigns an immutable `attemptID` and binds Session, native agent, `kind`, exact provider/model/variant, policy revision and the route ultimately sent. Re-check before any provider I/O; do not reuse an approval when a retry creates a new send or when a connection changes.
2. **Effective account and auth-generation binding.** Verify, through a provider-supported method, the effective non-secret billing principal/seat/workspace and credential revision actually used for that send, after native auth resolution. If identity cannot be verified or changes before transport, deny managed dispatch. A plugin-side `connection.active()` lookup, OAuth token label or catalog metadata does not establish this.
3. **Independently enforced included-only restriction.** The effective billing account must have a provider-enforced, pre-send no-paid mode/lock or equivalent immutable host-controlled restriction that survives plugin unload and retries. If no supported provider offers this guarantee, all managed routes stay **BLOCKED**, irrespective of correct model selection. This proof is distinct from #205's attempt correlation and remains a [#204/#206](subscription-billing-qualification.md) prerequisite.
4. **Settled outcome per attempt.** Stream completion, quota failure, cancellation, retry and lost/ambiguous outcomes must retain the same `attemptID` and effective account. Treat HTTP status 200, a Session step ID, a retry ordinal, or a plugin failure to receive settlement as **insufficient**. Unknown outcomes remain unknown and must not exhaust a newer request's account.
5. **Failure boundaries and privacy.** Never expose raw credentials/headers/body contents in the audit contract. Missing, stale, duplicated or contradicted admission/settlement evidence fails closed. Denial must occur in a trusted host/provider component when Loom is unloaded; plugin hooks may add restrictions but cannot be the sole guard.

An illustrative host/provider result could be:

```typescript
type QualifiedNativeSend = {
  readonly attemptID: string           // new for EACH physical send/retry
  readonly sessionID: string
  readonly agent: string
  readonly kind: "primary" | "compaction" | "title" | "generate"
  readonly route: { providerID: string; modelID: string; variant?: string }
  readonly effectiveAccount: {
    state: "verified"
    providerAccountID: string          // opaque, non-secret and provider-attested
    credentialGeneration: string
  }
  readonly billing: {
    mode: "included-only"
    enforcement: "provider" | "trusted-host"
    policyRevision: string
  }
}
// Settlement is later keyed by attemptID and its immutable account binding.
// This is a *proposed* behavioral contract, not an implemented API.
```

The trust boundary must be inside native host/provider send admission and must cover WS frames, prepared retries and changed credentials without a time-of-check/time-of-use gap. Merely exposing these fields after transport does not guarantee no-paid behavior.

## Deterministic conformance matrix (not yet all executed)

| Case | Required outcome | Current evidence |
| --- | --- | --- |
| New same-provider primary request with exact configured variant | Model selection and pre-preparation route guard agree | **PASS, installed scripted 2.3.0** (#243) |
| Prepared generate retry, two native sends | A *fresh* host-account/no-paid admission for each send | **BLOCKED**; installed send counts prove why a preparation hook is insufficient |
| Prepared compaction retry after eligibility/account change | Fresh send-time check, otherwise deny before second send | **Unqualified installed scenario**; native source shows the retry loop |
| Delayed auxiliary B quota error while primary A is active | Attribute only to B's distinct send; do not exhaust A | **BLOCKED**, source-modeled indistinguishable `retry` fields |
| Credential replacement between preparation and send, including WS reuse | Rebind effective principal/generation or deny before provider I/O | **BLOCKED**, no supported provider-attested binding |
| HTTP 200 followed by stream failure | No success/settlement from headers alone | **BLOCKED**, source-modeled negative case |
| Cancelled/unknown send, crash/restart and duplicated late settlement | Preserve exact attempt identity and unknown outcome; no false quota updates | **BLOCKED**, no host attempt-outcome join |
| Plugin never loaded, absent guard or provider opts into paid extra usage | Provider/host denies chargeable send independently | **BLOCKED**, no qualified provider no-paid control |
| Exact included-only provider account, model/variant and billable principal | Approved disposable account, provider-signed proof, positive installed real-provider send | **NOT RUN; authorization and evidence missing** |

Tests in `tests/test_native_request_identity_230.py` assert **observable ambiguity** from exact public hook field sets. They are not a replacement for the installed host and cannot prove a host/provider capability's total absence.

## Related upstream work (not existing guarantees)

- [OpenCode #60468](https://github.com/anomalyco/opencode/issues/60468) proposes debug-only transport attempt IDs and timing through HTTP/WS fallback. That would improve **diagnostics and correlation**, but the proposal is **open**, limited to debug observability and does **not** attest effective billing account or enforce included-only sending.
- [OpenCode #55985](https://github.com/anomalyco/opencode/issues/55985) proposes public per-call completion events for title/compaction, which could improve outcome attribution. It is **open**, does not cover pre-send authorization or per-transport credential binding.
- Do not duplicate these requests when proposing the smallest #205 contract. The missing mandatory capability is **trusted per-send account/no-paid admission and immutable outcome binding**, not merely a request-ID log field.

## Disposition and owner

**#205: PARTIAL request-local selection; BLOCKED per-send attempt/account attribution. #206: BLOCKED for production included-only routing.** Next required evidence comes from the **OpenCode host maintainer/provider integration** for per-send identity and settlement, and from the **billing provider** for enforced no-paid restrictions. Loom owns policy, verified route checking, conservative quota state and fail-closed integration, but cannot truthfully manufacture the missing native facts.

A smallest upstream-ready extension should add a protected per-send admission/settlement contract (or an existing supported equivalent), with deterministic tests for all rows above. File or modify an upstream request only after reviewing related upstream proposals and obtaining authorization; this investigation does not grant that authorization.

**Do not switch live managed routing on, grant paid fallback, infer subscription eligibility from scripted fixtures or replace the host's credential resolver.** [#239](https://github.com/bateau84/loom/issues/239) stays open for the complete workload routing capability, with [#242](https://github.com/bateau84/loom/issues/242) applying only to stronger assignment-wide transitions.
