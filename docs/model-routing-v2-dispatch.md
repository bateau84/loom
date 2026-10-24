---
type: Architecture
title: "OpenCode 2.1.1 model-dispatch adapter investigation"
description: "Pinned-host source audit of supported model-selection and safe failover seams; records the compatibility blockers and minimal upstream contract."
tags: [loom, opencode, model-routing, compatibility]
timestamp: 2026-10-24T00:00:00Z
---

# OpenCode 2.1.1 model-dispatch adapter investigation

**Verdict: BLOCKED for safe automatic live fallback in the published V2 plugin contract.**
This section documents the **historical 2.1.1 source audit**, before the
2.1.4 initial-routing implementation. The audit alone is source-only, but
the same draft PR now also includes a native agent model transform and
a guarded dispatch path for **OpenCode 2.1.4**. Do not confuse initial model
selection with live provider fallback. The original investigation starts
from [PR #190](https://github.com/bateau84/loom/pull/190)
at its exact head
`1fc73f0091603b4e22777ab3385245257c586e1d` and the upstream
OpenCode `v2.1.1` tag (commit
`ba546ec1598a70db2570e9c6258028d955ba8f58`).

The constraint is not the route order. The existing pure planner already puts
the **same logical model through the next eligible provider** ahead of the
next logical model. The missing part is a host-owned, atomic model decision
at a boundary proven free of streamed output and tool side effects.

## OpenCode 2.1.4 update: initial selection now supported

The exact [2.1.4 SessionRunnerModel.resolve](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/session/runner/model.ts#L77-L98)
**does** read `Agent.Info.model` if `Session.model` is absent; the 2.1.1
host did not. Loom now supplies this model using the supported
`ctx.agent.transform` API with an exact native reasoning variant. A
`session.model.request`-stage guard (the public hook name is
`session.hook("model.request")`) checks the chosen model, current billing
attestation, cooldown, tools and reasoning before transport; it never
changes the native request or asks the host to replay effects.

The [2.1.4 Promise SessionRetry API](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/plugin/src/promise/session.ts)
and [host retry logic](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/session/runner/retry.ts)
remain unchanged: no `nextModel`, no `outputStarted`, no native account
lease. The **live fallback blocker still applies**. Selecting another
model after a failed attempt by writing `session.switchModel` is unsafe.

### Separate evidence in this PR

- Pure and mocked V2 adapter tests exercise same-logical-model provider order
  and native `Agent.Info.model` selection, exact low/medium/high overlays,
  included billing proofs, unknown-billing rejection and account mismatch.
- The isolated `installed-model-routing-v214` CI workflow packs the **2.1.1
  SDK** Loom candidate but launches the **unmodified 2.1.4 CLI**. A scripted
  external model supplies a native request negative control: an unverified
  route is rejected before provider execution; disabling routing permits
  the ordinary native request. This is **not** live subscription acceptance
  or a mixed-SDK general compatibility guarantee.
- No real OAuth profile, two-provider quota exhaustion, native connection
  lease, tool-continuation routing or provider-stream replay acceptance has
  been established by these tests.

See [initial-routing contract and limits](model-routing.md)
for current use and the external quota attestation boundary. In particular,
OpenCode resolves the currently active connection when constructing a
model, while the plugin checks the connection at the next request hook.
These are **not one atomic connection lease**. The in-process Session
comparison rejects observed changes between requests, but cannot promise
that credentials have not changed between host resolution and transport.

The source-only 2.1.1 findings below remain valid *for that version*.
They do not negate the new agent-model selection support in 2.1.4.

## Observed dispatch path (pinned upstream source)

1. [SessionRunnerModel.resolve](https://github.com/anomalyco/opencode/blob/v2.1.1/packages/core/src/session/runner/model.ts)
   resolves the persisted `session.model`, or the global model default when
   unset. It does **not** choose `Agent.Info.model` from Loom's agent role
   policy. [SessionContext.load](https://github.com/anomalyco/opencode/blob/v2.1.1/packages/core/src/session/context.ts)
   resolves this selection **before** preparing a provider request.
2. [SessionModelRequest.prepare](https://github.com/anomalyco/opencode/blob/v2.1.1/packages/core/src/session/model-request.ts#L220-L326)
   already has a resolved runtime model. The `context` hook may edit
   system/messages/options/tools, while `model.request` may edit base URL and
   headers. Neither has a mutable model reference.
3. [SessionStep.attempt](https://github.com/anomalyco/opencode/blob/v2.1.1/packages/core/src/session/runner/step.ts)
   keeps the authoritative `publisher.record().outputStarted`. Its
   [publisher](https://github.com/anomalyco/opencode/blob/v2.1.1/packages/core/src/session/runner/publish-llm-event.ts#L443-L515)
   sets this flag for **text, reasoning and tool input/calls**.
4. [The retry callback](https://github.com/anomalyco/opencode/blob/v2.1.1/packages/core/src/session/runner/step.ts#L190-L225)
   is invoked on provider failure in both pre-output and output-started
   situations. Only **after** this callback does the host choose a clean
   `Retry` versus a `Continue` with previously emitted content.
   [V2 SessionRetry](https://github.com/anomalyco/opencode/blob/v2.1.1/packages/plugin/src/promise/session.ts)
   exposes only a readonly model and `decision: {retry, delay?}`:
   **not** `outputStarted`, tool-effect state or an atomic `nextModel`.
5. [SessionRunner.runStep](https://github.com/anomalyco/opencode/blob/v2.1.1/packages/core/src/session/runner/llm.ts#L202-L283)
   reloads context/model for a subsequent attempt. A separate native
   [session.switchModel](https://github.com/anomalyco/opencode/blob/v2.1.1/packages/core/src/session/session.ts#L106-L118)
   updates persisted selection, but the retry callback cannot prove that
   mutating the selection at that moment is safe.
6. [ModelResolver.load](https://github.com/anomalyco/opencode/blob/v2.1.1/packages/core/src/model-resolver.ts)
   resolves the currently active integration connection again for a model.
   A `Model.Ref` contains provider ID, model ID and optional variant, **not
   a connection/account ID**. The public Session model-selection API does
   not promise that the same account stays active across tool continuations.

These are version-specific statements. A future V2 host could add a safe seam;
do not extrapolate the result from version 2.1.1.

## Alternatives evaluated

| Supported surface | What it can do | Why it does not establish the required behavior |
| --- | --- | --- |
| `ctx.agent.transform` | Configure an agent's model metadata | The primary Session resolver reads the persisted Session selection or global model default; it does not consume the agent model at each dispatch. |
| `ctx.model.transform` | Restrict models, change global default, inspect provider templates | The default is not per-session/per-agent and cannot atomically replace an in-flight request. |
| `ctx.session.hook("prompt")` + `ctx.session.switchModel` | Change a persisted selection before some admitted user prompts | The hook is not called on every tool continuation; prompts may be queued while an earlier turn is active. Changing the Session model there does not pin the running stream/account. |
| `ctx.session.hook("retry")` + `switchModel` | Potentially alter a later attempt's persisted selection | **Unsafe** without the host's pre-output/tool-side-effect flag. The same callback is used for an output-started `Continue` path. Do not rely on an SSE listener or inference from an HTTP status to prove the boundary. |
| `ctx.event.subscribe` | Observe streamed Session events asynchronously | It is not an atomic snapshot of the step's internal `outputStarted` state at retry-decision time; transport delay and subscriber restart can leave gaps. |
| `model.request` / `http.request` / `http.response` / experimental WS hooks | Adjust transport headers, base URL, response or frames | Not native cross-provider protocol selection. A 429 observed on HTTP excludes neither earlier model output nor provider-specific WS traffic. Rewriting protocols or credentials here changes semantics outside the supported model resolver. |
| `ctx.provider.transform` + `ctx.aisdk.hook("language")` | Add a virtual provider and supply a custom language model | No documented V2 delegation interface provides **other native providers' already-resolved model streams with credential/account affinity**. Implementing a standalone router/gateway would require separate provider protocol and authentication handling, which is outside Loom's authority. |
| [Subrouter](https://github.com/remorses/subrouter/blob/main/opencode/src/index.ts) | Demonstrates a virtual provider and stream affinity for another harness | Its OpenCode adapter imports `@opencode-ai/plugin` (V1), registers a provider through a V1 `config` hook, and manages its own accounts. Neither interface nor credential approach is a validated OpenCode 2.1.1 V2 seam. |

**Test status:** These alternatives were traced through the pinned interfaces and
host source, not dynamically executed against an installed OpenCode 2.1.1 host.
Do not describe this table as a passed integration test. The pure route-order
and billing tests in `tests/model-routing.test.mjs` are **planner** tests only.

## Smallest viable supported solution

Request a narrow V2 host addition rather than patching host internals:

1. A **model selection boundary** before the host resolves a primary Session
   model, with the selected agent, native catalog and original Session choice.
   The hook may request an exact `Model.Ref`; the host validates availability,
   tools, capabilities and variant before building the native request. Persist
   the selected route at the host's safe turn boundary. Do not silently override
   an explicit user model choice without a documented opt-in contract.
2. On retry, expose a **host-computed safe-to-switch decision** from the same
   `StepRecord.outputStarted` and tool-execution state used internally.
   Permit an exact `nextModel` **only** when no content/reasoning/tool input
   was emitted and no provider-hosted or local tool effects occurred. The host
   must reject a late replacement and must itself re-resolve the requested
   model, not trust a plugin to edit a Session while a stream is active.
3. Preserve a **native route lease** (provider/model/variant/opaque active
   connection ID) for the stream and its tool continuations. Native OpenCode
   stays responsible for credentials, tools, errors and permissions. Release
   the lease only at a proved turn boundary; no replay of executed tools.
4. Give the adapter native model discovery (`ctx.model.list`) and only
   verified capabilities and native variants. Translate low/medium/high to
   an exact supported variant/provider option; if unsupported, skip that route.
   Do not infer capabilities from illustrative GPT model IDs.

With these host changes, Loom supplies ordered candidate **references** from
`planModelRoutes()`; it never constructs native provider requests itself.
A host-supported virtual routed provider is an alternative only if it offers
the same native credential delegation, pre-output retry decision and account
lease contract.

## Quota-management boundary (separate handoff)

The future quota task should supply **attestations**, not credentials, via a
small interface conceptually equivalent to:

    inspect({
      providerID, modelID,
      connection: { kind: "credential", id: "<opaque-native-id>" }
    }) -> {
      billing: "included" | "metered" | "unknown",
      billingConfidence: "verified" | "unverified",
      quota: "available" | "unknown" | "exhausted",
      cooldownUntil?: number
    }

For environment-backed connections, the host may supply a nonsecret opaque
identity instead. Identity must match the actual native connection used by
the request, not merely a provider name. The data source owns its shared
cooldown/quota store, error classification and freshness rules; Loom must
not build another store or inspect tokens. A missing, stale, mismatched or
unverified **included** attestation is **unknown billing** and therefore
ineligible with `paid-fallback: false`. Unknown quota may be tried only
when included billing is independently verified. A cooldown in force makes
a route ineligible. Even with `paid-fallback: true`, unknown billing stays
ineligible. No implicit inference from an OAuth login or provider ID.

Reasoning capability mapping belongs to the host/catalog adapter, not to
quota accounting. It must verify that a model actually supports the variant
or provider option selected; absent evidence is not permission to downgrade.

## Acceptance when the host contract exists

Focused adapter tests must prove exact model-first/provider-second selection,
no unknown or metered route when paid fallback is disabled, unsupported
reasoning/tools rejection, native catalog discovery and unchanged behavior
when routing is disabled. Host qualification additionally needs two actually
connected providers; 429/quota exhaustion **before output**; negative cases
**after text/reasoning starts** and **after a tool call**; no tool replay;
account stability across multiple tool continuations; concurrent Sessions;
interrupt/restart; and paid-API negative controls. The installed-host suite
is a separate handoff and **has not been run for this investigation**.

## Depends on

- [Draft model-routing policy](model-routing.md) — Candidate order, billing
  constraints, aliases and role inheritance
- [OpenCode 2.1.1 compatibility](opencode-2.1.1.md) — Pinned host and existing
  installed-test boundaries
