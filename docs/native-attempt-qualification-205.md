---
type: Architecture
title: "OpenCode 2.3.0 native send identity and account-binding qualification — issue 205"
description: "Issue #205: exact OpenCode 2.3.0 source audit, prior installed retry evidence, missing account/attempt guarantees and proposed upstream acceptance contract."
tags: [loom, opencode, quota, model-routing, upstream, compatibility]
timestamp: 2026-11-19T00:00:00Z
---

# Native send identity and effective billing account — OpenCode 2.3.0

**Issue:** [#205](https://github.com/bateau84/loom/issues/205); parent [#203](https://github.com/bateau84/loom/issues/203).

**Verdict: BLOCKED for account-bound native admission and quota attribution.**
OpenCode 2.3.0 supports request-local selection and several transport observations.
The inspected public interfaces do not provide a supported join between each
actual provider attempt, its effective billing account and credential generation,
its admission decision, and its final outcome. No equivalent integration was
qualified by this investigation. Production managed routing remains inactive.

**Zero real provider/account/model routes have qualified.** This is an evidence
refresh of the existing #205 contract, not a new router,
upstream implementation, provider qualification or production allowlist. A missing
public guarantee is not proof that no private or future integration could supply
an equivalent. The host/provider owners must establish that equivalent before
Loom consumes it. [Current initial-routing gate](initial-routing-qualification-206.md)

## Baseline and evidence levels

The exact source pin is OpenCode `v2.3.0`, commit
[`a6b15d33daf6ab7d35569f6d711fdb630b9f04e7`][upstream].
The tag target and relevant primary-source files were fetched on 2026-11-19.
Loom's [package](../package.json) and [installed workflow](../.github/workflows/installed-model-routing-acceptance-v214.yml)
pin SDK/CLI 2.3.0; the local installed package versions were also checked.

| Evidence | What was actually checked | What it does not establish |
| --- | --- | --- |
| **S — pinned source** | Public Promise and Effect interfaces; native preparation, resolution, retry, credentials, HTTP/WS and outcome paths; selected built-in provider paths | An installed positive account/billing result or an exhaustive audit of all provider implementations |
| **N — prior installed native evidence** | The corrected PR #243 CI artifact: 19 mechanics cases, actual native hooks and an in-memory provider; report and sanitized trace hashes verified during this refresh | A new host run for this documentation change, real network billing, effective account identity or included-only entitlement |
| **M — source-modeled witnesses** | The existing eight [identity counterexamples](../tests/test_native_request_identity.py), rerun successfully during this refresh | Captured native A/B-account interleaving, real credentials or live provider receipts |

The [evidence manifest](native-request-identity-230-evidence.json) retains source
fingerprints, source ranges, the prior run's exact heads/artifact hashes, the
retry trace excerpt and the I-01–I-12 disposition. The original [2.2.0 audit](native-request-identity.md) remains historical. Its
source baseline has not been relabeled; current source evidence lives in this
report.

The prior installed run used PR source `217a80088239c13d0e115087f99b510afa73f57e`
and GitHub test merge `81e9de2a7cc0dd1897b30980827a905bff07cba7`.
Its report records `source_dirty: false`. Both have tree
`1abc84f202b47f0179f11dedfe4451713318cfd3`, also merged as
`35d5e8532944c8a674a82b865ef3c2d1ff64b612`.
[CI job and artifact owner][prior-ci]

## Supported observations and missing guarantees

**AVAILABLE** qualifies only the named narrow observation. **PARTIAL** means
useful mechanics exist but the account/attempt obligation is unsatisfied.
**BLOCKED** means no supported equivalent was established for that obligation.

| Surface | Usable evidence | Missing for account-bound dispatch | Status |
| --- | --- | --- | --- |
| `experimental.model.resolve` | Session, agent, request kind and same-provider model/variant replacement without changing the stored Session choice | Actual send identity, account, admission and settlement; resolution can be speculative or reused | **AVAILABLE** selection mechanics, S + N |
| `model.request` | Resolved model and kind at preparation; a loaded hook can reject preparation | A fresh invocation before every resend; effective billing principal and credential revision | **PARTIAL**, S + N |
| `http.request` / `http.response` | Shared request preparation supplies HTTP middleware; within one invocation the post-hook Request is passed to the response hook | Universal provider-I/O coverage, a protected final-auth binding, cross-hook attempt identity and completed-stream outcome | **PARTIAL**, S |
| `experimental.ws.*` | Handshake before socket selection; outbound and inbound frame interception | Published attempt/account/credential binding and account-bound final settlement | **PARTIAL**, S |
| `retry` | Session, agent, model, error and next-attempt ordinal on paths using `SessionRunnerRetry` | Kind, unique attempt/account owner and complete coverage of retry paths | **PARTIAL**, S |
| `integration.connection.active/resolve` | Credential-record or environment reference; credential resolution and OAuth refresh | A provider-verified billing principal held invariant through an actual send | **PARTIAL**, S |
| Session step/execution events | Assistant-message/Session lifecycle and some stream boundaries | A universal per-provider-attempt outcome joined to the effective account | **PARTIAL**, S |
| Quota `recordFailure` / `recordSuccess` | Guarded [Loom storage](shared-subscription-quota.md) already exists | Authoritative native evidence identifying which account/attempt to settle | **BLOCKED** |

The Promise and Effect Session payloads agree on these identity fields.
Neither publishes a model-send `attemptID`, verified billing principal or
credential revision. The separate `AISDK` hooks configure a model/SDK and do not
supply those guarantees. [Session interfaces][session-hooks] · [Effect interfaces][effect-hooks] · [AISDK hooks][aisdk-hooks]

### Selection, preparation and sending are different boundaries

The native resolver applies `experimental.model.resolve` before loading the
runtime model and accepts only same-provider replacements. [Resolver][resolve]
Title selection can resolve both a primary and a preferred candidate before
choosing one; compaction can reuse the primary context's already-resolved model.
A consumable receipt keyed only by Session/kind would therefore confuse
resolution with dispatch. [Title selection][context-title] · [Compaction selection][compaction-select]

The preparation function builds the request and invokes `model.request`, then
supplies separate HTTP/WS interceptors to the native transport. HTTP hooks can
reject or replace the Web Request on that path; a missing `model.request`
invocation does **not** prove that the HTTP/WS hooks are also skipped.
Those transport hooks still lack the required protected account/settlement
binding. Their availability must not be described as a universal, provider-
independent no-paid contract. [Request preparation][request] · [Transport hooks][request-transport]

### Installed counterexample: a prepared generate retry

The existing packed-host run produced these counts:

| Native local-provider case | Resolve calls | `model.request` approvals | Provider SDK invocations |
| --- | ---: | ---: | ---: |
| Primary retry | 2 | 2 | 2 |
| Prepared Session generate retry | 1 | 1 | 2 |

The generate trace contains, in order: resolve input, resolve output, request
input, request approved, provider invocation, injected provider failure, provider
invocation. There is no second resolve or request approval. The local provider
injects a retryable **503**, not a real-account quota failure. Session identifiers
in the retained trace are normalized to case names by the fixture. No real
provider credentials or network billing were used. [Prior installed evidence][prior-ci]

The source explains the difference:

- The primary retry loop reloads context and prepares another primary request.
  [Primary runner][primary]
- Session generate prepares once, then retries `llm.generate(prepared.request,
  prepared.options)`. Its `ModelRetry.retry` helper does not invoke the Session
  `retry` hook. Blocking only through that hook would miss this retry path.
  [Session generate][generate] · [Retry helper][model-retry]
- Compaction's delivery loop can resend a prepared request. It uses the Session
  retry policy for ordinary retryable failures, while payload/context reductions
  have their own resend branches. This is **source evidence** here; prepared
  compaction retries were not exercised in the retained PR #243 artifact.
  [Compaction delivery][compaction-retry]

Thus the observed counterexample disproves `model.request` as a universal
per-attempt admission gate. It does not prove that every transport intercept is
absent, that policy actually changed between those two attempts, or that a paid
request occurred.

### Credential identity is not a send-bound billing principal

The runtime resolver reads the active connection, resolves its credential and
constructs the model. The returned runtime record contains the model/ref and
capabilities, not an account/credential-generation receipt for later Session
hooks. OAuth refresh updates the stored value under the same credential ID.
The public connection schema exposes a record ID and broad authentication type,
or an environment name; those values do not establish the account the provider
will actually charge. [Model loading][model-load] · [Connection resolution][connection] · [Credential refresh][credential-refresh] · [Connection schema][connection-schema]

Provider metadata must be interpreted narrowly. For example, OpenCode Console
stores discovered account/organization metadata at login, while the current
ChatGPT plugin puts the Session ID in `x-client-request-id`. Neither observation
creates the proposed transport-attempt/account contract. This refresh does not
re-certify provider billing policies or inspect any user's credentials.
[Console metadata][console-account] · [ChatGPT request header][chatgpt-request]

Similarly, the `AttemptID` used by `Integration.oauth` and
`Integration.command` identifies **authentication flows**, not model sends.
An assistant-message ID, a retry ordinal, a Session affinity value or an
internally generated WebSocket token is not a substitute for the required
public, account-bound attempt identity. [Integration attempts][integration-attempts] · [Retry payload][runner-retry]

### Provider-owned auxiliary I/O needs explicit coverage

In the pinned GitHub Copilot plugin, the title hook can call its own
`utilityTitle()` HTTP helper when Copilot discovery has a base URL, token and
models, no explicit title-agent model is configured, and the utility model is
available. The hook runs during request shaping, before the shared
`model.request` hook. Its helper uses a direct fetch path outside Session
`http.*` interception. [Conditional title hook][copilot-title] · [Helper][copilot-helper] · [Preparation order][request-shape] · [Title hook dispatch][request-kind]

Upstream describes that utility path as free. That source statement is **not**
provider-enforced no-paid or effective-account qualification. This investigation
did not run that path against Copilot and found no deployed billing violation.
It does establish a source-level reason why qualification must inventory
provider-owned auxiliary calls, rather than assume the common request pipeline
covers every call made for a managed Session.

Stateless `Generate.text` is also distinct from `Session.generate`: the pinned
implementation resolves a model and calls the LLM client directly. It is outside
the retained Session mechanics suite. Any future claim to guard that API must
qualify its own path. [Stateless Generate][stateless-generate]

### HTTP response, stream completion and Session completion differ

The HTTP response hook runs after response headers are available and receives a
body stream. HTTP 200 alone cannot establish successful stream completion.
Session step events identify an assistant message; execution settlement is one
terminal observation per busy period. Auxiliary `UsageRecorded` events are
internal and excluded from the public manifest. None of those payloads supplies
the effective billing account and unique send join required here.
[HTTP wrapper][request-transport] · [Event schema][events] · [Execution settlement][execution]

The WebSocket implementation already tracks internal delivery/terminal state,
closes incomplete channels and can fall back to HTTP. Its handshake interceptor
feeds socket affinity, so changed URL/headers can rotate the connection. Those
useful internal mechanisms do not publish a protected account-bound settlement
contract to Loom. This refresh performed no installed WebSocket qualification.
[WebSocket selection/send][ws-send] · [WebSocket terminal handling][ws-terminal]

## Source-modeled counterexample: delayed auxiliary B versus primary A

A compaction is associated with account B, followed by a primary request
associated with account A in the same Session/model. A later retry callback
exposes Session, agent, model and ordinal, but not kind or effective account.
Either request could explain that observation. Attributing it to the latest
primary can therefore exhaust A for B's error.

The [eight existing witnesses](../tests/test_native_request_identity.py) model
six such ambiguous pairs plus restart-pending-state and HTTP-200/stream-outcome
examples. They passed during this refresh. The additional
[2.3.0 witnesses](../tests/test_native_request_identity_230.py) exercise public-field
ambiguities for prepared retries, credentials, HTTP and WebSocket observations.
The historical file and five cases in the additional file are **source-modeled**,
not native captures with accounts A/B. The two other checks replay and hash-check
the retained PR #243 generate trace, and compare the modeled hook fields against
the exact installed 2.3.0 SDK declarations. Neither starts a new native host or
establishes real billing identity. Synthetic private account/attempt annotations
never become observed native fields. In the pinned host, detached compaction
precomputation is off by default; an installed overlapping-background test must
explicitly establish the required precomputation conditions.
[Retry interface][session-hooks] · [Compaction defaults][compaction-select]

## Smallest required host guarantees

These are the existing #205 requirements, with provider-owned auxiliary I/O made
explicit. They are **requirements for a supported equivalent**, not assertions
that OpenCode 2.3.0 implements them or a decision about its API design.

1. **Unique transport-attempt identity.** Each actual provider attempt within the
   managed scope gets a fresh opaque identity, including auxiliary calls,
   retries, continuations and HTTP/WS fallback or reuse. The supported contract
   must define the attempt boundary and include provider-owned auxiliary paths.
   Speculative model resolution must not consume an attempt or quota reservation.
2. **Verified effective billing account.** At a host/provider-owned final
   pre-send boundary, establish the provider-scoped billing principal, exact
   authentication method and credential generation. Unknown identity denies
   managed dispatch. A credential record, environment name, token hash, catalog
   price or independent `active()` lookup cannot supply this guarantee.
3. **Binding preserved through send.** Admission and actual provider I/O use that
   same principal, credential generation, route and policy. Credential refresh,
   activation, auth/header transformation, reused sockets and fallback must
   preserve the binding, obtain a new binding or deny before sending. A
   plugin-side check followed by unrestricted transport is insufficient.
4. **Final per-attempt outcome.** Completed stream, normalized failure,
   cancellation and unknown/lost outcome retain the attempt identity, actual
   account, kind and model. Duplicate, delayed and reordered events, including
   after restart, cannot settle another attempt or override newer quota recovery.
   Missing evidence stays unknown.
5. **Privacy and independent no-paid enforcement.** Correlation never exposes
   secrets, raw authorization headers or prompt bodies. Unknown capabilities
   fail closed for managed routing while ordinary disabled-routing behavior is
   preserved. The provider's enforceable included-only guarantee is a separate
   [#204 billing obligation](subscription-billing-qualification.md), bound to
   the same send before any production route is qualified. Protection must also
   hold when Loom never loads or its hook is removed.

**Ownership:** OpenCode owns the send boundary, native identity and outcome;
the provider establishes the actual billing principal and no-paid enforcement;
Loom owns route policy and guarded quota state. An optional logical
`requestID` can group attempts, but is not required for the minimum contract.
Its semantics must be defined by the host if added.

### Existing illustrative API — not implemented or accepted

Names and structure below remain illustrative; a smaller supported equivalent
can satisfy the required behavior.

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
    authenticationMethodID: string
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

This preserves the existing report's illustrative `QualifiedNativeSend` sketch;
`authenticationMethodID` makes its already-required authentication binding
explicit. These labels are not evidence that the declared guarantees exist.
This example covers Session requests only. It does not silently extend Session
identity to stateless APIs or define provider billing policy. A real contract
must declare its supported call families and return unavailable for any managed
path whose required guarantee it cannot provide.

## I-01–I-12 qualification map

**No complete account-bound acceptance case below is qualified.** PARTIAL
records useful existing mechanics only; it is not permission to enable routing.
The manifest records the same dispositions with source and prior-case references.

| Case | Progress | Evidence now available | Required positive/counterexample evidence still missing |
| --- | --- | --- | --- |
| **I-01 Primary send** | PARTIAL | S: request kind/model; N: selected route reaches local provider | Fresh native attempt + verified billing principal on admission and completed stream |
| **I-02 429 retry** | PARTIAL | S + N: primary and prepared-generate **503** retry counts | 429 case; fresh ID/account per send; bound failure/outcome; policy or account change before resend |
| **I-03 Delayed compaction B after primary A** | BLOCKED | M: ambiguous callback pair; S: retry lacks kind/account | Installed overlap with independently observed send owners; B must never exhaust A |
| **I-04 Concurrent auxiliary/primary** | PARTIAL | N: all four request kinds and concurrent separate workloads | Same-Session interleaving, auxiliary terminal owner and nonretryable failure; provider-owned title calls |
| **I-05 Tool continuation** | PARTIAL | N: one native tool and two provider invocations | Distinct attempt/account binding; old terminal cannot settle continuation |
| **I-06 Credential switch before send** | BLOCKED | S: native active/resolve path and mutable transport hooks | Actual binding revalidated or rejected before send after credential activation |
| **I-07 OAuth refresh/method migration** | BLOCKED | S: refresh may update value under same credential ID | Reverified billing principal/generation; missing proof denied before send |
| **I-08 HTTP 200 then stream error** | BLOCKED | S: response headers precede body completion; M: divergent outcomes | Installed streamed failure with exact attempt/account and no false success |
| **I-09 WebSocket reuse/fallback** | PARTIAL | S: per-exchange interception, socket rotation and internal delivery state | Installed reuse/fallback and final outcome joined to native attempt/account |
| **I-10 Cancellation/restart** | PARTIAL | N: restarted model selection; M: lost pending state | Installed cancellation and interrupted-send recovery with durable unique ownership; no invented success |
| **I-11 Duplicate/out-of-order outcomes** | BLOCKED | M: delayed-owner ambiguity; existing quota state is conservative | Native duplicate/reordered settlement with idempotence and recovery fences |
| **I-12 Existing plugins/unknown capability** | PARTIAL | N: loaded production guard denies enabled routing with zero sends; disabled control succeeds | Provider/host no-paid enforcement during plugin absence/unload and unknown/transformed account identity |

The remaining #206 title dual-candidate, automatic compaction reuse, prepared
compaction retry and installed cancellation tests are a separate mechanics
increment. Their future results must be recorded at their own tested head.
Fresh-child model authorization is separately gated.
[#239](https://github.com/bateau84/loom/issues/239) remains open for the complete
workload-routing capability; #242 applies only to
assignment-wide/in-place transition guarantees. Neither replaces #205/#206.

## Upstream coordination and next decision

Read-only issue/PR checks on 2026-11-19 found related work:

| Upstream item | Observed state | Relevance and remaining gap |
| --- | --- | --- |
| [#60468](https://github.com/anomalyco/opencode/issues/60468) | Open issue | Proposes debug transport timing and local request/attempt correlation across HTTP/WS fallback; does not establish effective-account admission or provider-enforced no-paid sending |
| [#55985](https://github.com/anomalyco/opencode/issues/55985) | Open issue | Proposes per-call auxiliary completion; no accepted effective-account admission contract |
| [#62820](https://github.com/anomalyco/opencode/pull/62820), related [#62096](https://github.com/anomalyco/opencode/issues/62096) | Open PR / issue | Proposes broader model HTTP hooks; its stated scope excludes model-level WS hooks and does not supply the complete account/attempt/settlement join |
| [#64438](https://github.com/anomalyco/opencode/pull/64438) | Open PR | Proposes primary assistant-message ID at preparation; not a fresh transport-attempt identity or account binding |
| [#47846](https://github.com/anomalyco/opencode/pull/47846), [#20105](https://github.com/anomalyco/opencode/pull/20105) | Closed, **unmerged** PRs | Historical account-switch/fallback proposals; not operational prerequisites or proof |
| [#60018](https://github.com/anomalyco/opencode/issues/60018), [#61645](https://github.com/anomalyco/opencode/issues/61645), [#62712](https://github.com/anomalyco/opencode/issues/62712) | Open issues | Session admission, permission consumption and job termination; related lifecycle concerns, not the required transport/account contract |

These are related proposals, not substitutes for source and installed
qualification. The scoped search is not proof that no other proposal exists.
No upstream comment, issue or patch was submitted by this investigation.

**Next owner decision:** align the existing #205 requirements with the
host/provider maintainers, particularly the per-send and auxiliary-completion
work, and obtain a supported contract or an explicit upstream blocker.
Loom can then qualify that contract with the cases above and separately verify
one authorized disposable included-only route. Until both are proven, preserve
unknown quota outcomes, keep #205/#206 open and leave production routing inactive.
Any external upstream submission requires its own authorization; this
investigation only prepared reviewable evidence. No new credential resolver,
in-flight model switch, tool replay or automatic account fallback is introduced.

## Verification of this refresh

Dated change note, 2026-11-19: reconciled the existing #205 draft with the exact
source pin and retained corrected-head PR #243 artifact. The historical report,
document index and prior log remain separate; this is the canonical 2.3.0 report.

- Verified exact SDK/CLI package versions, the upstream tag/commit and fetched
  source fingerprints.
- Verified the retained PR #243 report/trace hashes and recomputed the primary
  and generate retry counts from the sanitized native trace.
- Reran the eight existing source-modeled identity witnesses: **8 PASS**.
- Ran the seven additional identity checks: **7 PASS** (five source-modeled
  witnesses, retained native trace replay, and installed SDK field comparison).
- New live account, WebSocket, credential rotation and installed cancellation
  tests: **not run**. This document does not claim their acceptance.

[upstream]: https://github.com/anomalyco/opencode/tree/a6b15d33daf6ab7d35569f6d711fdb630b9f04e7
[prior-ci]: https://github.com/bateau84/loom/actions/runs/44569443361/job/135720158088
[session-hooks]: https://github.com/anomalyco/opencode/blob/a6b15d33daf6ab7d35569f6d711fdb630b9f04e7/packages/plugin/src/promise/session.ts#L67-L168
[effect-hooks]: https://github.com/anomalyco/opencode/blob/a6b15d33daf6ab7d35569f6d711fdb630b9f04e7/packages/plugin/src/effect/session.ts#L67-L168
[aisdk-hooks]: https://github.com/anomalyco/opencode/blob/a6b15d33daf6ab7d35569f6d711fdb630b9f04e7/packages/plugin/src/promise/aisdk.ts
[resolve]: https://github.com/anomalyco/opencode/blob/a6b15d33daf6ab7d35569f6d711fdb630b9f04e7/packages/core/src/session/runner/model.ts#L81-L120
[context-title]: https://github.com/anomalyco/opencode/blob/a6b15d33daf6ab7d35569f6d711fdb630b9f04e7/packages/core/src/session/context.ts#L99-L133
[compaction-select]: https://github.com/anomalyco/opencode/blob/a6b15d33daf6ab7d35569f6d711fdb630b9f04e7/packages/core/src/session/compaction.ts#L267-L345
[request]: https://github.com/anomalyco/opencode/blob/a6b15d33daf6ab7d35569f6d711fdb630b9f04e7/packages/core/src/session/model-request.ts#L273-L374
[request-transport]: https://github.com/anomalyco/opencode/blob/a6b15d33daf6ab7d35569f6d711fdb630b9f04e7/packages/core/src/session/model-request.ts#L375-L440
[request-shape]: https://github.com/anomalyco/opencode/blob/a6b15d33daf6ab7d35569f6d711fdb630b9f04e7/packages/core/src/session/model-request.ts#L294-L307
[request-kind]: https://github.com/anomalyco/opencode/blob/a6b15d33daf6ab7d35569f6d711fdb630b9f04e7/packages/core/src/session/model-request.ts#L467-L471
[primary]: https://github.com/anomalyco/opencode/blob/a6b15d33daf6ab7d35569f6d711fdb630b9f04e7/packages/core/src/session/runner/llm.ts#L227-L344
[generate]: https://github.com/anomalyco/opencode/blob/a6b15d33daf6ab7d35569f6d711fdb630b9f04e7/packages/core/src/session/generate.ts#L43-L76
[model-retry]: https://github.com/anomalyco/opencode/blob/a6b15d33daf6ab7d35569f6d711fdb630b9f04e7/packages/core/src/model-retry.ts#L67-L102
[compaction-retry]: https://github.com/anomalyco/opencode/blob/a6b15d33daf6ab7d35569f6d711fdb630b9f04e7/packages/core/src/session/compaction.ts#L618-L705
[model-load]: https://github.com/anomalyco/opencode/blob/a6b15d33daf6ab7d35569f6d711fdb630b9f04e7/packages/core/src/model-resolver.ts#L478-L516
[connection]: https://github.com/anomalyco/opencode/blob/a6b15d33daf6ab7d35569f6d711fdb630b9f04e7/packages/core/src/integration.ts#L694-L714
[credential-refresh]: https://github.com/anomalyco/opencode/blob/a6b15d33daf6ab7d35569f6d711fdb630b9f04e7/packages/core/src/credential.ts#L160-L183
[connection-schema]: https://github.com/anomalyco/opencode/blob/a6b15d33daf6ab7d35569f6d711fdb630b9f04e7/packages/schema/src/connection.ts#L18-L38
[console-account]: https://github.com/anomalyco/opencode/blob/a6b15d33daf6ab7d35569f6d711fdb630b9f04e7/packages/core/src/plugin/provider/opencode.ts#L821-L850
[chatgpt-request]: https://github.com/anomalyco/opencode/blob/a6b15d33daf6ab7d35569f6d711fdb630b9f04e7/packages/core/src/plugin/provider/chatgpt.ts#L277-L290
[integration-attempts]: https://github.com/anomalyco/opencode/blob/a6b15d33daf6ab7d35569f6d711fdb630b9f04e7/packages/core/src/integration.ts#L225-L257
[runner-retry]: https://github.com/anomalyco/opencode/blob/a6b15d33daf6ab7d35569f6d711fdb630b9f04e7/packages/core/src/session/runner/retry.ts#L32-L75
[copilot-title]: https://github.com/anomalyco/opencode/blob/a6b15d33daf6ab7d35569f6d711fdb630b9f04e7/packages/core/src/plugin/provider/github-copilot.ts#L393-L417
[copilot-helper]: https://github.com/anomalyco/opencode/blob/a6b15d33daf6ab7d35569f6d711fdb630b9f04e7/packages/core/src/plugin/provider/github-copilot.ts#L509-L555
[stateless-generate]: https://github.com/anomalyco/opencode/blob/a6b15d33daf6ab7d35569f6d711fdb630b9f04e7/packages/core/src/generate.ts#L92-L127
[events]: https://github.com/anomalyco/opencode/blob/a6b15d33daf6ab7d35569f6d711fdb630b9f04e7/packages/schema/src/session-event.ts
[execution]: https://github.com/anomalyco/opencode/blob/a6b15d33daf6ab7d35569f6d711fdb630b9f04e7/packages/core/src/session/execution.ts#L132-L170
[ws-send]: https://github.com/anomalyco/opencode/blob/a6b15d33daf6ab7d35569f6d711fdb630b9f04e7/packages/core/src/session/model-transport.ts#L300-L405
[ws-terminal]: https://github.com/anomalyco/opencode/blob/a6b15d33daf6ab7d35569f6d711fdb630b9f04e7/packages/core/src/session/model-transport.ts#L425-L506
