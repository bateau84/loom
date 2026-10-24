---
type: Architecture
title: "Draft: role model classes and provider-first subscription routing"
description: "Draft model-class and provider-first route selection contract; live failover is not implemented."
tags: [loom, routing, draft]
timestamp: 2026-10-24T00:00:00Z
---

# Draft: role model classes and provider-first subscription routing

> **Not live failover yet.** This draft implements a bounded, opt-in
> configuration contract and a pure, tested route planner. It does not yet
> intercept or reroute OpenCode requests, inspect actual subscriptions, or
> enforce billing. Do not turn it on expecting uninterrupted service.
>
> OpenCode's V2 session retry hook retries the *already selected* model; it
> does not accept a different model/provider. Real seamless failover needs
> a validated V2 virtual provider/SDK adapter or equivalent upstream support.

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

## Runtime adapter: outstanding work before enabling in production

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
