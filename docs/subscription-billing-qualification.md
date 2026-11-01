---
type: Architecture
title: "Investigation: account-bound included-billing qualification for model routing"
description: "Evidence and proposed fail-closed contract for Loom issue #204, without enabling subscription routing."
tags: [loom, model-routing, subscriptions, billing, investigation]
timestamp: 2026-11-01T00:00:00Z
---

# Account-bound included billing — qualification investigation

**Verdict (2026-11-01): no provider route is qualified for managed included-only dispatch.** OpenCode Go, both native OpenAI/ChatGPT OAuth paths, and GitHub Copilot all remain blocked pending supported account-bound, pre-request proof. This is a source audit, **not** an installed-host or live-account acceptance result. No credentials were read, provider inference requests sent, or paid usage incurred.

The safety question is not merely "does the account have a subscription?" It is: **can this exact native request on this exact active account be guaranteed not to use paid balance or credits if included allowance is exhausted?** A successful login, model catalog, zero advertised cost, budget screenshot, or post-request usage report cannot establish that guarantee.

## Source scope and qualification rule

- **Loom baseline:** repository main pins OpenCode SDK **2.2.0**; production managed routing is host-unqualified and disabled. The historical 2.1.4 candidate is not authorization to dispatch. See [routing](model-routing.md), [shared quota state](shared-subscription-quota.md), and [2.2.0 host audit](opencode-2.2.0.md).
- **Native source inspected:** upstream OpenCode [v2.2.0](https://github.com/anomalyco/opencode/tree/v2.2.0) (tag commit `1097e2668b1e08ad63bdf0b1c4860b9bc01e420c`) and newer [v2.2.4](https://github.com/anomalyco/opencode/tree/v2.2.4) (tag commit `45898d0f8569225eb1ddb4ee13f8581b34dff311`). v2.2.4 source is a comparison, **not** Loom's installed/pinned runtime.
- **Provider terms/docs:** public OpenCode Console, OpenAI, and GitHub documentation inspected on **2026-11-01**. Public promises and model catalogs can change. No private entitlement or account configuration was inspected.
- **Qualification requires all three:** (1) native active-account identity and entitled exact model; (2) independently validated included-vs-metered classification; (3) **provider-enforced no-paid fallback covering the actual dispatched request**, with no account-switch race. If any is unknown, expired, conflicting, or unverifiable, keep `billing: unknown` and deny managed routing. Separately, [issue #205](https://github.com/bateau84/loom/issues/205) must prove host request/account affinity.

## Candidate matrix

Here **connection ID** means the native opaque credential record, **not** a proven billing account or workspace. Model examples are catalog candidates, not a promise that a particular account is entitled.

| Candidate / native IDs | Native connection and model evidence | Included / paid behavior; no-paid control | Verdict and next action |
| --- | --- | --- | --- |
| **OpenCode Go**: model provider commonly `opencode-go`; underlying Console integration `opencode` | `ctx.integration.connection.active("opencode")` exposes an opaque credential ID/method/status; Console remote config supplies provider/model entries. Native identity does not establish the Go subscription workspace/plan. Published Go catalog includes examples `opencode-go/gpt-6-luna` and `opencode-go/kimi-k3`; use only exact runtime-discovered IDs and capabilities. | Go/Go Plus allowance is included; **Extra Usage can debit paid Console credits** after limits. Console's enforced **all-spend $0 budget** counts paid Go Extra Usage but *not* included Go. A public member-budget read can report a member limit, but not an immutable, active-credential-bound no-paid guarantee across every applicable policy. | **Needs upstream support / blocked.** Expose current workspace entitlement, applicable no-paid policy or atomic included-only request mode, and host-bound identity. No Go route is approved. |
| **ChatGPT OAuth, token sharing**: provider/integration `openai`, native OAuth method `chatgpt-token-sharing` | OpenCode v2.2.0 and v2.2.4 token-sharing plugin selects the active `openai` OAuth connection, exposes models through native catalog, and targets `https://api.openai.com/v1`. It sets model cost `[]` as a catalog adjustment, not a billing receipt. | ChatGPT Go/Plus/Pro plan sharing may use included Work/Codex allowance. Once exhausted, **credits can be used when the account holder opted in**. Credit use is off by default; an app weekly cap below 100% prevents credit use **while that control applies**, but the plugin does not expose a documented, fresh account-bound setting or request-level no-credits enforcement. | **Needs upstream support / blocked.** Expose provider-confirmed no-credit enforcement tied to the actual token-sharing request and account, including revocation. |
| **ChatGPT OAuth, legacy Codex backend**: provider/integration `openai`, OAuth method `chatgpt-browser` or `chatgpt-headless` | OpenCode's other native `openai` OAuth plugin uses `https://chatgpt.com/backend-api/codex`, native originator/Codex headers and filtered zero-cost model catalog. The methods differ from token sharing **despite the same provider ID**. | Historically identified as a subscription transport, but the current source does not expose a specific-account pre-dispatch no-paid/credit guarantee or a lease across credential refresh. OAuth+headers+`cost: []` is **transport inference**, not a provider-issued commitment. | **Needs upstream support / blocked.** Audit billing semantics separately for this exact OAuth method, with authoritative no-paid evidence; never generalize from the other `openai` method. |
| **GitHub Copilot**: provider/integration `github-copilot`, native OAuth method `device` | Native Copilot plugin gets `ctx.integration.connection.active("github-copilot")`, retrieves a remote model list and derives exact catalog model IDs/capabilities. Only the connected account's actual list is authoritative. | Current individual plans include **monthly GitHub AI Credits**; additional paid usage is possible through an additional-usage budget after the included allocation. Native OAuth, `chat_enabled`, available models, and any reported allowance do not attest that the correct billing account has paid usage forbidden at request time. | **Needs upstream support / blocked.** Expose current user/seat + relevant org/individual budget, a provider-enforced included-only dispatch mode or equivalent immutable cap, and host-bound request identity. |

**None is qualified** by the inspected public SDK and provider contracts. A provider can be *commercially included* but still be *technically unqualified* for Loom's no-paid requirement.

## Evidence behind the judgments

### OpenCode Go: genuine spend guard, but no safe Loom assertion

OpenCode [Go terms and model list](https://dev.opencode.ai/v2/docs/console/go) document time-window/monthly allowances and paid **Extra Usage** fallback. [Console budgets](https://dev.opencode.ai/v2/docs/console/budgets) document a real server-side rule: an **all-spend $0 budget** stops counted spending on new requests (HTTP 429), and **Go within plan does not count; paid Go Extra Usage does**. This is **provider enforcement**, not just a UI estimate. However, rules may be changed by authorized owners/admins and are evaluated when requests start; a preflight observation can become stale. This investigation found **no public native host method** that atomically binds the active connection, exact Go entitlement, full effective policy, and actual request to a guaranteed included-only execution.

The [member Budgets API](https://dev.opencode.ai/v2/docs/console/api/budgets) returns data such as `limit_micro_cents`, `exceeded`, and `resets_at` through separately authorized service-account credentials. It is **not** a native Go subscription/Extra Usage attestation. A member override alone is not a proof of all workspace/service-account/model policies. Calling a foreign API with a second key would also need an independently proven connection/workspace mapping, not a guessed match. The [Inference API](https://dev.opencode.ai/v2/docs/console/api/inference) may return `usage.opencode.billing_source` (`go`, `go-plus`, `balance`, `free`, `byok`) and `usage.opencode.allowance`; these are **post-request** observations, not permission to send the next request. The prior [2.1.4 Go study](opencode-go-eligibility.md) remains a historical finding, not proof for a new SDK.

Native audit: [Console provider](https://github.com/anomalyco/opencode/blob/v2.2.0/packages/core/src/plugin/provider/opencode.ts), [connection schema](https://github.com/anomalyco/opencode/blob/v2.2.0/packages/schema/src/connection.ts), [plugin host connection methods](https://github.com/anomalyco/opencode/blob/v2.2.0/packages/core/src/plugin/host.ts), and equivalent [v2.2.4 Console provider](https://github.com/anomalyco/opencode/blob/v2.2.4/packages/core/src/plugin/provider/opencode.ts). The connection exposes record identity and `needs_auth`, but **not** plan, paid-overage policy, current allowance, or a provider-enforced per-request included-only option. Native `opencode-go` may be a remote provider while the credential belongs to the `opencode` integration: matching one string to the other does not prove the billing account.

### OpenAI: two paths share a provider ID

The OpenCode [token-sharing plugin at 2.2.0](https://github.com/anomalyco/opencode/blob/v2.2.0/packages/core/src/plugin/provider/chatgpt.ts) and [2.2.4](https://github.com/anomalyco/opencode/blob/v2.2.4/packages/core/src/plugin/provider/chatgpt.ts) use OAuth method `chatgpt-token-sharing` under `openai` and explicitly treat a `subscription_sharing_usage_limit_exceeded` response as a reason not to retry. A **failed request** does not prove that the prior or next attempt could not spend credits. [OpenAI's current plan-sharing terms](https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites) describe optional credit use after included allowance and the UI-based controls. They do **not** document a plugin-facing, request-bound guarantee for Loom.

The separate [legacy OpenAI provider plugin at 2.2.0](https://github.com/anomalyco/opencode/blob/v2.2.0/packages/core/src/plugin/provider/openai.ts) uses a Codex backend and the other OAuth methods. [Loom's historical native proof](../src/model-routing-runtime.ts) matches this legacy shape using OAuth, endpoint, headers and empty cost. It cannot distinguish all policy details of the actual account, cannot authorize token-sharing semantics and is **not active in production**. Neither plugin's empty `cost` array is a provider-issued billing verdict.

### GitHub Copilot: model discovery is not included-credit enforcement

The [v2.2.0 native Copilot plugin](https://github.com/anomalyco/opencode/blob/v2.2.0/packages/core/src/plugin/provider/github-copilot.ts) (also [v2.2.4](https://github.com/anomalyco/opencode/blob/v2.2.4/packages/core/src/plugin/provider/github-copilot.ts)) binds a current native connection for model discovery and request setup, but publishes no subscription/seat, included-credit and no-paid policy as a pre-request attestation. [GitHub's current individual billing](https://docs.github.com/en/copilot/concepts/billing-and-usage/individuals/billing) and [usage limits](https://docs.github.com/en/copilot/concepts/billing-and-usage/individuals/usage-limits) explicitly distinguish included monthly AI Credits from additional paid usage controlled by budgets. Do not infer a non-metered route from OAuth connectivity, model visibility, or historically documented premium-request accounting.

## Required Loom attestation contract (proposal; not implemented)

The existing [runtime interface](../src/model-routing-runtime.ts) accepts `RouteEligibilitySource.inspect({providerID, modelID, connectionID})` and returns `RouteAttestation` with `verified`, `billing`, `quota`, optional `cooldownUntil`. This is an appropriate seam for discovery, but a boolean `verified` and a connection-record ID are **not sufficient evidence of no paid fallback**, and there is no expiry, authoritative billing account, proof kind, or request lease.

Before any positive included routing qualification, a **trusted native provider/host adapter**, not config or an untrusted arbitrary plugin, must produce the following minimum semantics:

~~~ts
type IncludedBillingProof = {
  providerID: string               // exact native provider
  modelID: string                  // exact native model, plus variant if billing differs
  nativeConnectionID: string       // active native credential record, non-secret
  billingAccountID: string         // opaque provider-attested workspace/user/seat
  classification: "included-only"
  authority: "provider-enforced"  // not catalog, UI, quota cache, or operator assertion
  enforcement: "request-bound" | "host-locked-policy"
  policyVersion?: string           // required when enforceable policy can change
  issuedAtMs: number
  expiresAtMs: number              // finite, must be valid at actual dispatch
  noPaidFallback: true
}
type BillingDecision = { status: "included"; proof: IncludedBillingProof }
  | { status: "metered" | "unknown" | "denied" }
~~~

**Normative behavior to implement only after provider support is proven:**

1. A trusted adapter must validate account entitlement, exact provider/model/variant, proof issuer and relevant billing restrictions **against the active native transport account**. A native credential record ID is a comparison key, not itself a billing-account ID. A provider/model catalog and a stored balance never upgrade an unknown decision.
2. The host must **enforce** included-only use for the actual request, either through a provider-accepted atomic **request-bound no-paid option**, or through a provider-host-guaranteed policy lock that cannot be weakened between inspection and request admission. A policy read followed by an ordinary unrestricted request does **not** qualify. This may require an upstream API and native connection lease; no current path supplies one.
3. Every managed **primary and auxiliary** model request independently checks proof just before transport, then the shared quota `reserve()` narrows eligibility. `expiresAtMs > now` is necessary but does not repair a mutable-policy race. Freshness and the upstream revocation/policy version must be validated at dispatch. No arbitrary cached TTL may turn a UI observation into authority.
4. Unknown/missing/malformed/expired/contradictory proof; missing billing account; disconnected, refreshed or switched native credential; unsupported model/variant; revoked entitlement; changed effective billing policy; lost proof channel; or native host lacking an enforceable preflight path -> **deny** before transport. Failure or retry must **not** switch credentials or replay work.
5. Only a separate explicit `paid-fallback: true` policy may ever consider a **verified metered** route; that is not an included-only proof and remains governed by other routing prerequisites. `paid-fallback: false` is the default. Unknown is never metered permission.
6. Store only opaque account references, validity/revocation metadata and normalized quota outcomes; no access/refresh tokens, private identities, full inference bodies or raw billing details. Never expose account IDs in user-facing previews. Account revocation invalidates all its model proofs; quota exhaustion can only **narrow** a verified route.

**Contract ownership:** provider owns billable classification and guaranteed spend enforcement; OpenCode owns active credential, account binding and request execution; Loom owns conservative selection, local shared quota and denial. Issue [#205](https://github.com/bateau84/loom/issues/205) establishes the separate native request/account identity requirements. This is **a future contract**, not an assertion that the proposed fields are already exposed by the SDK or providers.

## Verification plan

### Deterministic, credential-free tests (future implementation)

Use a stub native host with scripted clock, provider policy generation, accounts and request executor. Capture whether transport is invoked; never call real endpoints.

| Case | Required result |
| --- | --- |
| Matching account, exact model/variant, unexpired **provider-enforced request-only** proof, successful host-bound request identity | One permitted reservation and one dispatch (positive *simulation*, not real provider qualification) |
| Absent proof; `verified` without enforceable proof; token-sharing `cost: []`; valid Go key; Copilot model list; UI/budget screenshot; previous `billing_source=go` | `billing: unknown`, zero transport |
| Proof for account A but native credential B; different workspace behind two keys; lost native binding; changed auth method or source account during selection | Zero transport; never pool two credentials as independent included quotas without proved billing-account mapping |
| Expired/NaN timestamps; untrusted issuer; missing no-paid restriction; wrong provider/model/variant; revoked plan; changed policyVersion; stale cached result | Zero transport |
| UI shows $0 all-spend cap but policy may change after read; member budget exists but workspace default cannot be verified | Zero transport |
| Quota exhausted/revoked after inventory planning, before request; another process reserves final slot; managed auxiliary title/compaction request | Deny before transport (for each managed request); no paid/global default fallback |
| Source outage or malformed response; unknown model; subscription expires; provider responds 401/403/429 or ambiguous retry | Fail closed; no speculative success accounting, re-routing or request replay |
| Routing explicitly disabled | Native OpenCode behavior unchanged (negative control) |

These tests demonstrate Loom's **refusal**, not a positive real provider entitlement. Positive installed-host approval also requires an exact SDK/CLI version-matched native account/dispatch test under issue #206 after this issue and #205's upstream blockers are resolved.

### Separate disposable-account live verification (not authorized here)

Only after **explicit authorization**, with a purpose-created disposable account/workspace and a provider-supported zero-charge guard, run tightly bounded first-party provider/host checks. Verify the precise native connection, model/variant, pre-dispatch no-paid proof, provider refusal at exhausted allowance, post-request billing classification and any invoice/credit delta. Prove credential/policy switching and refresh are detected, and that no title/compaction call escapes. Stop immediately if the guard or trustworthy evidence is unavailable. Never collect or echo personal credentials. **Do not consume paid credits or intentionally drain a real subscription** merely to force exhaustion; if safe exhausted-state testing is impossible, leave the route blocked.

## Decision and upstream requests

| Integration | As-of-2026-11-01 status | Needed to graduate |
| --- | --- | --- |
| OpenCode Go | **NEEDS UPSTREAM SUPPORT — BLOCKED** | Account/workspace + exact model entitlement + provider-enforced Go-only request mode (or race-free locked all-spend $0 policy) available to native host |
| ChatGPT token sharing | **NEEDS UPSTREAM SUPPORT — BLOCKED** | Current account's allowed plan/credit mode with no-credit request enforcement and revocation/policy change signaling |
| ChatGPT legacy Codex | **NEEDS UPSTREAM SUPPORT — BLOCKED** | Authoritative documented billing behavior for the active legacy OAuth account plus request-bound enforcement and native binding |
| GitHub Copilot | **NEEDS UPSTREAM SUPPORT — BLOCKED** | Exact Copilot billing user/seat + included credits + enforced no-additional-spend request guarantee and native binding |

**No activation change is recommended.** Keep `registerModelRouting()` host-unqualified, all managed routes denied, and the existing pure planner / quota manager available for tests. Pursue upstream provider/SDK attestations and [#205](https://github.com/bateau84/loom/issues/205); implement and verify an initial live route only through [#206](https://github.com/bateau84/loom/issues/206) after a *positive* provider-specific, version-matched proof exists. A documentation claim or deterministic mock test must not be counted as that proof.

## Depends on

- [Loom model routing and guard](model-routing.md)
- [Shared subscription quota state](shared-subscription-quota.md)
- [Historical OpenCode Go eligibility](opencode-go-eligibility.md)
- [Native safe fallback constraints](opencode-v2-safe-live-fallback.md)
