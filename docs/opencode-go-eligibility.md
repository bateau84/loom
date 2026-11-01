---
type: Architecture
title: "OpenCode 2.1.4 Go subscription eligibility: blocked on supported billing proof"
description: "Version-pinned native API and Console evidence for Go subscription eligibility, quota signals, model identity and missing pre-request billing controls."
tags: [loom, model-routing, opencode-go, subscriptions, investigation]
timestamp: 2026-10-25T00:00:00Z
---

# OpenCode Go subscription eligibility — 2.1.4 feasibility finding

**Verdict: BLOCKED for automatic `billing: included` attestation. No Go
adapter or authentication workaround is justified.** The native host can
identify an active *connection* and available *models*, but cannot certify that
a Go request on that connection will use included allowance rather than paid
balance. Keep it `billing: unknown` without an independently verified,
account-bound, pre-request billing guarantee. This document is an investigation,
not live verification against the user's OpenCode Go subscription.

Source baseline: upstream OpenCode
[`v2.1.4`](https://github.com/anomalyco/opencode/tree/68bc26b7da1990ce10ffecfbc1e09eb13aa5d824),
commit `68bc26b7da1990ce10ffecfbc1e09eb13aa5d824`. Public Console
documentation was checked on 2026-10-25; hosted docs and live models can change.

## Confirmed from the pinned native source

1. `ctx.integration.connection.active(integrationID)` returns a credential
   connection ID, type, method (`key`, `oauth`, `external`), or environment
   variable name and an optional `needs_auth` status. It has **no plan,
   entitlement, paid-overage, balance, remaining quota or reset field**.
   [Connection schema](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/schema/src/connection.ts)
   and [integration implementation](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/integration.ts).
2. `ctx.model.list()` and `ctx.provider.list()` identify enabled models,
   provider IDs, variants, capabilities and catalog pricing. That describes a
   possible transport, not the active account's Go entitlement.
   [Plugin host](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/plugin/host.ts)
   and [model/provider schemas](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/schema/src/model.ts).
3. The native OpenCode Console integration retrieves
   `/api/v2/config` using OpenCode's own credential. The parsed response has
   provider, model, MCP, voice and policy configuration — **not an authenticated
   Go plan or billing/overage statement**. Providers from this response are
   assigned integration ID `opencode` and the active Console connection; a
   provider called `opencode-go` is not a separate, verified subscription
   identity. Catalog `cost` is token pricing, not proof of paid or included
   billing. [Console plugin](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/plugin/provider/opencode.ts)
   and [remote provider config schema](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/schema/src/config/provider.ts).
4. Native `needs_auth` distinguishes an account that requires a new sign-in,
   but a connection without that status is **not** proof that a Go subscription
   exists, is still active, or has available usage.
5. The opaque native *connection ID* is useful to reject a changed active
   credential. It is not proven to be a stable workspace/subscription ID:
   different keys to the same Go workspace could share one allowance.
   The shared quota database must not equate separate connection IDs with
   independent quotas without verified account mapping.

## Confirmed from public OpenCode Console documentation

- [Go usage and exact model IDs](https://dev.opencode.ai/v2/docs/console/go):
  a Go or Go Plus subscription can serve models with 5-hour, weekly and
  monthly allowances. The published table says 20%, 50% and 100% of each
  model's published monthly allowance. **Do not infer independent quota
  counters across models** from this table; the authoritative enforcement scope
  and normalized spend across models have not been verified through native
  metadata. The published amounts may change.
- The documented model-list endpoint is
  `GET https://opencode.ai/inference/go/v1/models`. It supplies model
  metadata, **not** verified subscription billing for the current connection.
  Native discovery remains the runtime authority for available IDs.
- Examples of currently documented full native routes:
  `opencode-go/kimi-k3`, `opencode-go/gpt-6-luna`,
  `opencode-go/glm-5.3`. By contrast, `gpt-6.1-sol` appears in the
  [pay-as-you-go Console catalog](https://dev.opencode.ai/v2/docs/console/models),
  not the checked Go catalog. Never create a Go route from a logical model
  name without an exact host catalog match or an explicit, correct alias.
- **Critical:** [Extra Usage](https://dev.opencode.ai/v2/docs/console/go)
  can charge the workspace's pay-as-you-go balance once Go allowance is
  exhausted. A previously successful Go request, Go provider name, valid
  API key, or a manually reported subscription does not guarantee the next
  request cannot spend money.
- [Inference API billing fields](https://dev.opencode.ai/v2/docs/console/api/inference):
  completed responses can report `usage.opencode.billing_source`
  (`go`, `go-plus`, `balance`, `free`, `byok`) and
  `usage.opencode.allowance`. Those are **post-request evidence**,
  not a pre-request entitlement, remaining balance or atomic no-paid guard.
  This investigation did not establish that 2.1.4's plugin surface preserves
  these fields in a documented, validated hook.
- [Console API overview](https://dev.opencode.ai/v2/docs/console/api/)
  documents inference and provider API endpoints and key permissions, but
  no supported query returning Go entitlement + Extra Usage state + per-window
  remaining quota/reset tied to the active native connection.
  `401` may mean an expired/revoked key; `403` may mean missing permissions
  or unavailable entitlement, so neither alone proves quota exhaustion.

## Error signals and quota-manager interface

- Host-normalized `RateLimit` failures can carry `retryAfterMs`.
  OpenCode 2.1.4's
  [model retry policy](https://github.com/anomalyco/opencode/blob/v2.1.4/packages/core/src/model-retry.ts)
  caps retry-after waits at 15 minutes. A retry delay must **not** be relabeled
  as the subscription's 5-hour/weekly/monthly reset timestamp.
- A Go quota error type such as `GoUsageLimitError` has been
  [observed publicly](https://github.com/anomalyco/opencode/issues/49014),
  including cross-model behavior. User reports are *not* a stable native API,
  cannot establish general quota scope, and cannot authorize an account.
- If a supported host adapter eventually supplies trusted request outcomes,
  PR #192's `recordFailure`, `recordProviderQuota` and
  `recordSuccess` can preserve observed cooldowns/remaining usage without
  storing credentials. This is **only state tracking**. It does not make an
  unverified route included, or prevent Console from billing Extra Usage.
- Use `account-model` when scope is unknown; a broader account scope requires
  provider-backed evidence. Do not hardcode shared/independent scopes or weekly
  reset moments from reports. Never store raw token, response body or
  personal account identifiers in Loom quota state.

## Safe behavior on existing PRs

- PR #191's `RouteEligibilitySource.inspect({providerID, modelID,
  connectionID})` must return no positive Go attestation until an authoritative
  source exists. In the resulting inventory `billing: unknown`; with or
  without `paid-fallback`, the planned Go route is unavailable.
- Unknown subscription state, invalid/expired account, unrecognized exact
  model ID or changed native connection stays unavailable. Explicit `paid-
  fallback: true` is not authorization to guess that an unknown route is
  metered.
- PR #192's shared store holds only verified route identities and observed
  cooldown/quota signals; it must not promote `billing` based on a successful
  request or a matching provider name.
- When Loom routing is disabled, let native OpenCode run unmodified.

## Minimum supported upstream change for implementation

Provide a **documented, native, account-bound Go eligibility interface**,
preferably as an OpenCode plugin/SDK method or first-party attestation:

1. Stable opaque workspace/subscription identity bound to the *current active
   native connection*, not a credential string or a copied display label.
2. Verified plan and model eligibility, current auth status and entitlement
   expiry/revocation signals; an affirmative billing classification must be
   fresh at dispatch.
3. **An atomic provider-enforced subscription-only request option** (or an
   equally strong guarantee that a request can never draw from the paid
   balance). Merely reading `Extra Usage: off` is subject to an account-setting
   race; checking prior response `billing_source=go` is too late.
4. Structured remaining usage, quota scope, 5-hour/weekly/monthly reset or
   trusted `Retry-After` values when available, with clear separation of
   exhaustion, temporary throttle, overload and authentication errors.
5. Native model IDs and explicit capability/variant support, with a
   deterministic invalid-account/changed-connection path.

Until this exists: **do not implement a Go included-use adapter**.
The deterministic negative-control tests in
[`tests/model-routing-runtime.test.mjs`](../tests/model-routing-runtime.test.mjs)
exercise the current fail-closed rules without fabricating Go entitlement.

## Depends on

- [Routing initial-selection contract](model-routing.md) — current
  account-bound billing attestation and pre-transport eligibility guard.
- [OpenCode 2.1.4 native dispatch audit](model-routing-v2-dispatch.md) —
  host request/retry seam and its limitations.
