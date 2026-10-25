---
type: Architecture
title: "Draft: role model classes and provider-first subscription routing"
description: "Draft model-class and provider-first route selection contract; live failover is not implemented."
tags: [loom, routing, draft]
timestamp: 2026-10-24T00:00:00Z
---

# Draft: role model classes and provider-first subscription routing

> **Initial routing only on OpenCode 2.1.4.** Loom can now assign a
> verified eligible model and exact reasoning variant to a native agent using
> `ctx.agent.transform`. A `model.request` guard stops unverified and
> unexpected requests before provider transport. It does **not** rotate
> providers after a quota failure or resume/replay a running stream.
>
> This plugin branch still pins the **2.1.1 SDK** for PR #190 compatibility.
> The isolated **2.1.4 CLI** negative-control workflow proves a rejected
> unverified request never reached the scripted provider and disabling routing
> leaves native execution available. Actual paid/subscription provider
> acceptance remains a separate unproven task.
>
> OpenCode's V2 retry hook still cannot safely change providers and does not
> expose the host's internal output/tool-effect boundary.

For pinned-host evidence, see the
[2.1.1/2.1.4 model-dispatch investigation](model-routing-v2-dispatch.md).

## Initial routing on OpenCode 2.1.4 (implemented, opt-in)

At plugin startup, Loom reads the effective `.loom.yaml`, discovers actual
models through the native `ctx.model.list()` and providers through
`ctx.provider.list()`, and resolves current **opaque native connection IDs**.
It asks the separate quota-attestation interface when available. The only
native built-in included-use proof currently recognized is OpenCode 2.1.4's
**ChatGPT OAuth integration**: an active native OAuth credential, the Codex
backend URL, its native subscription headers, an enabled model and the native
subscription-adjusted empty cost list must **all** agree. An OAuth provider
name by itself, empty model pricing by itself, or a provider advertising a
model does not authorize an included request.

For each configured agent/role, the pre-existing planner chooses a logical
model and provider in the configured order; Loom sets that existing native
agent's `Agent.Info.model` to the exact `providerID/id#variant`. OpenCode
2.1.4 consults this field when `Session.model` is unset. No `opencode.json`
per-agent model assignment or new agent definitions are needed. Explicitly
selected Session models still win inside OpenCode; for a **managed** agent,
a different model is rejected by Loom's pre-transport guard rather than
silently overriding or charging for that Session choice.

**Reasoning:** A candidate needs a native `low`, `medium` or `high`
variant with actual provider options. Missing, empty or incompatible
reasoning variants are **not** replaced with default/lesser reasoning.
Tool support and enabled status come from the native catalog. An exhausted
route, in-force cooldown, missing native connection, unknown or unverified
billing all make the route ineligible. `paid-fallback: true` can only enable
a **verified metered** attestation; unknown billing never becomes eligible.
The public native catalog alone is not a general subscription-billing
authority. The [shared quota manager](shared-subscription-quota.md) is now
connected to initial planning and dispatch. Its SQLite WAL state is
machine-wide across this user's OpenCode processes; it does **not**
attest billing or provide native credentials. The adapter does not inspect
secret material or create another quota database.

**Dispatch guard:** Every managed primary request is checked against
the planned model, current shared quota eligibility, the latest verified
native billing attestation, and an in-process provider/model/account
comparison across continuations. It **must** obtain an atomic shared
`reserve()` immediately before returning to native dispatch.
A new exhaustion, throttle, authentication block or competing probe lease
rejects the committed route without switching models or replaying tools.
If native OpenCode would fall through to its global default because an
agent route is unavailable, Loom rejects the request before provider
transport. With routing enabled, auxiliary model requests
for managed Sessions also require a verified eligible route, so title/
compaction cannot silently hit a paid global fallback. Explicitly
unmanaged Sessions retain native auxiliary behavior. For an intentionally
**disabled** policy the adapter registers no model or request hooks and
OpenCode behaves as before.

A changed routing policy requires a plugin restart; request-time checks
reject changes since activation. New plugin activations read quota blocks
written by other processes before choosing a model. Existing active
sessions keep their initial selected model and fail closed if a different
process exhausts that route; they do **not** silently switch to the next
provider or model. OpenCode currently supplies only the active native
connection for each provider, not a switchable pool of inactive accounts. The model policy reported by
`loom_agents` includes `model_routing_runtime: initial-only`,
`model_routing_selected` and `model_routing_unavailable_agents`
when the full native host is available. A partial/older host shows
`not-connected` and is not evidence of live routing.

**Limits:** This is initial native agent selection, **not** per-request
replanning or safe live provider fallback. An existing explicitly selected
Session model is not overwritten. The pre-request connection check is
not an atomic native connection lease: OpenCode can still resolve a
different active account between model resolution and transport. Native
account affinity during a stream, tool execution and auxiliary calls remains
a host contract requirement. The adapter records only typed, normalized
native `provider.quota`, `provider.free-limit`, `provider.rate-limit` and
`provider.auth` failures (the latter only with HTTP 401/403) from
matching reserved primary requests. It
disables repeated retries on those blocked routes, but does not infer
a successful stream, a reset timestamp or remaining requests from HTTP 200.
Unobserved success/recovery accounting is deliberately not fabricated. Invalid/overloaded config loaded at startup
follows existing Loom fail-closed-guidance behavior and can leave routing
disabled; operators must verify the runtime status before treating paid
policy as enforced. The separate installed-host negative control establishes
only rejection under *unverified* billing and the disabled native path.
It does not prove actual ChatGPT billing, two-provider switching or live
tool-affinity acceptance.

### Example

```yaml
model-routing:
  enabled: true
  default-class: strong
  default-reasoning: medium
  provider-order: [openai, github-copilot]
  paid-fallback: false
model-classes:
  strong:
    # Replace these illustrative IDs with exact IDs from the native model list.
    models: [gpt-6.1-sol, gpt-6-astra]
agents:
  architect:
    roles: [architecture]
roles:
  architecture:
    model-class: strong
    reasoning: medium
```

No other provider is assumed included. The configured model must exist in
the native catalog, the requested reasoning variant must be supported,
and the current connection must have verified billing. If nothing
qualifies, the managed request is blocked rather than silently spending.

## Shared quota integration (implemented for initial selection)

The adapter reads the [machine-wide shared quota store](shared-subscription-quota.md)
before it selects a native agent model. Candidate order remains
**logical model first, provider second**. Each candidate carries an opaque
non-secret native account key and independently verified billing. An
environment-variable name is not a stable account ID and is not used to
authorize managed routing.

`eligibility()` is only a preview; every eligible managed native request
must also acquire an atomic `reserve()` immediately before native transport.
Quota writes from other processes are visible to the next planning read and
at the next guarded request boundary. A changed shared state blocks the
currently committed model; native V2 cannot safely switch that model
within an active turn. Fresh startup/reload planning can choose the next
verified route, without silently lowering reasoning or using an unknown
billing method.

The host's typed `session.retry` provider error is used only for conservative
negative accounting. Neither HTTP 200 nor a generic Session completion
proves a specific provider request succeeded with the reserved account.
Automatic `recordSuccess()`, `recordProviderQuota()`, login refresh
accounting, and true stream-bound native account leasing remain unproven.
The separately tested quota manager supports those state transitions once
reliable observed provider evidence exists. No extra quota store is created.

## Intended behavior

An agent chooses a **model class** and **reasoning level**, inherited from its
roles. A model class is an **ordered list of logical models**, not providers.

Within each logical model, Loom tries providers in configured preference order,
using only models the installed OpenCode host actually exposes. For example:

1. `gpt-6.1-sol` through OpenCode Go
2. `gpt-6.1-sol` through OpenAI
3. `gpt-6.1-sol` through GitHub Copilot (if offered)
4. `gpt-6-astra` through OpenCode Go
5. `gpt-6-astra` through OpenAI

If OpenCode Go exhausts its subscription quota for `gpt-6.1-sol`, its
availability entry is marked exhausted; the next route must still be
`gpt-6.1-sol` at another provider, **not** `gpt-6-astra`.

A logical-model identity is never inferred from a fuzzy or substring match.
By default, matching uses the exact OpenCode model ID. Use `model-aliases`
when the same model has different IDs at different providers. Unknown IDs,
unknown billing type, disabled models, unsupported tools, and known-exhausted
quota do not become fallback candidates by guesswork.

## Config contract (add to existing .loom.yaml)

This is an illustrative policy; model IDs and provider availability are
**not verified** here. Keep the existing professional role guidance and
instructions. Role names remain user-defined.

```yaml
model-routing:
  enabled: true
  default-class: balanced
  default-reasoning: medium
  provider-order: [opencode-go, openai, github-copilot]
  paid-fallback: false

agents:
  architect:
    roles: [architecture]
  coder:
    roles: [implementation, documentation]
  critic:
    roles: [qa, acceptance]
  debugger:
    roles: [exploration, research]
    model-class: coding
    reasoning: medium

roles:
  architecture:
    model-class: strong
    reasoning: medium
  implementation:
    model-class: coding
    reasoning: low
  acceptance:
    model-class: strong
    reasoning: high
  research:
    model-class: efficient
    reasoning: low

model-classes:
  strong:
    models: [gpt-6.1-sol, gpt-6-astra, fable-5, kimi-k3]
  coding:
    models: [gpt-6.1-luna, sonnet-5.5, haiku-5.5, deepseek-4.1-flash]
  balanced:
    models: [gpt-6.1-luna, kimi-k3, sonnet-5.5]
  efficient:
    models: [deepseek-4.1-flash, haiku-5.5, gpt-6.1-luna]

# Optional, only if native OpenCode provider IDs differ from logical names:
model-aliases:
  gpt-6.1-sol:
    opencode-go: gpt-6.1-sol
    openai: gpt-6.1-sol
```

The `provider-order` list specifies preference **within a model**, not
authorization to spend money. Other explicitly eligible providers are sorted
by provider ID after preferred providers.

## Role inheritance

1. An explicit agent `model-class` or `reasoning` wins for that field.
2. Otherwise, a single inherited role value wins. Equal role values agree.
3. Conflicting role values produce an error unless overridden at agent level.
4. Otherwise, use the global defaults.
5. Disabled/unconfigured agents receive no policy.
6. A referenced model class must exist; no fallback outside that class.

A problem/architecture agent can share the same `strong` class as a critic
while requesting different reasoning levels. A debugging agent can explicitly
override the `research` role's `efficient` class.

Config remains version 1; new sections are optional and `enabled` defaults
to false. Existing configurations are unchanged. Model classes replace their
`models` list across layers; aliases merge by provider and accept null to
remove inherited aliases. Effective validation runs **after all layers** so
global classes can be referenced from project-local agent roles. Invalid final
config fails closed under the existing Loom configuration-read policy.

## Candidate selection rules (implemented)

- Model order is outermost, provider order is inside it.
- Skip known-exhausted routes; an *unknown quota* can be tried when the
  billing category is verified included.
- `paid-fallback: false` excludes metered and unknown-billing routes.
- `paid-fallback: true` puts **all included candidates ahead of all
  metered candidates**; unknown-billing routes remain excluded.
- Report unavailable when the configured class has no eligible candidate.
- Never use fuzzy model aliases, silently reduce reasoning, or repeat a route.
- The pure planner needs a runtime-supplied inventory with `billing`,
  `quota`, `tools`, `enabled`, and optional supported reasoning levels.

## Runtime adapter: remaining work for live fallback (initial routing is implemented)

This feature is not complete until the following are independently verified.

- [ ] Map current OpenCode V2 active provider/model catalog and connections
      onto route inventory; distinguish ChatGPT subscription from paid OpenAI
      API keys. A provider name alone proves neither free nor included use.
- [ ] Establish a provider adapter that can choose a model **before output**,
      including at retry boundaries. Do not abuse `session.hook("retry")`
      to retry the same exhausted route; it cannot mutate the model reference.
- [ ] Pin provider/model/account throughout streaming and tool continuations;
      never transparently replay already executed side effects.
- [ ] Store per-account quota/cooldown state machine-wide across OpenCode
      instances; choose appropriate cooldown scope (account/model/provider).
      Refresh on resets, preserve opaque account IDs, and never persist tokens.
- [ ] Use provider-reported limits where supported and distinguish confirmed
      quota exhaustion from throttling/overload; do not claim resets without
      direct evidence. Handle other 4xx/5xx errors without unsafe failover.
- [ ] Support low/medium/high translation only when the model/provider supports
      it, and preserve a stable agent context across a route change.
- [ ] Qualify installed OpenCode V2 host with real **two-provider** exhausted-
      primary, available-secondary requests and no-metered-fallback negative
      control, plus concurrency and interruption tests.
- [ ] Expose actual selected provider, model, quota confidence and fallback
      reason in a bounded status view, without token/credential leakage.

## Boundaries and security

This is a Loom plugin feature, not a new scheduler or agent tool family.
Native OpenCode remains the owner of credentials, models, agent files and
permissions. Provider adapters must use supported client protocols rather
than force credentials from unrelated services. In particular, a subscription
that allows its own coding CLI does not necessarily permit third-party
authentication; unsupported subscription reuse must not be implemented.

Do not enable paid routing based only on a string such as `openai`,
`github-copilot` or `opencode-go`. A runtime adapter must verify billing
mode independently of model discovery. Only verified included usage is
eligible by default.

## Depends on

- [Bounded configuration decoding](configuration-parser.md) is the existing
  parser for `.loom.yaml` layers, including the new routing policy fields.
  Extending the schema must preserve its input and error-handling limits.
- [OpenCode 2.1.1 compatibility](opencode-2.1.1.md) is the host contract that
  any future runtime routing adapter must respect. It does not establish that
  live model switching is supported today.

## Implementation references

- [OpenCode V2 plugin transforms and hooks](https://dev.opencode.ai/v2/docs/build/plugins/)
- [OpenCode V2 migration guide](https://dev.opencode.ai/v2/docs/build/plugins/migrate-v1)
- [Subrouter source](https://github.com/remorses/subrouter), a reference
  for account cooldown and stream affinity; its OpenCode adapter targets
  the V1 plugin API and cannot be imported as an unverified V2 dependency.
