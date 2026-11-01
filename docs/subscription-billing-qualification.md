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

| Candidate / native IDs | Native account/model evidence | Included and paid behavior; provider controls | Verdict and next action |
| --- | --- | --- | --- |
| **OpenCode Go / Go Plus**: model provider often `opencode-go`, Console integration `opencode` | `ctx.integration.connection.active("opencode")` provides a credential-record ID, not a certified workspace/plan or actual request account. Use discovered exact model IDs. | Included Go allowance may be exhausted; Extra Usage can then debit paid Console balance. The server-enforced all-spend **$0** budget counts paid Extra Usage but not included Go, yet no immutable, account/attempt-bound policy proof is exposed to Loom. | **BLOCKED.** Verify workspace/member policy and enforce its no-paid condition on the native request. |
| **OpenCode Go Teams**: members of a shared workspace | Each member gets their **own** Go allowance; a service account is **not covered** by Go Teams. A service-account API key is not member subscription proof. | Go Teams Extra Usage starts enabled according to the [Go plan documentation](https://opencode.ai/v2/docs/console/go/), and can consume paid balance. Budget policy must cover the actual member, workspace and request. | **BLOCKED.** Reject service-account claims to a member's included Go entitlement; prove current effective no-paid policy for the actual member. |
| **ChatGPT OAuth, token sharing**: `openai` / `chatgpt-token-sharing` | The native connection record can remain stable even if an OAuth method migrates; its ID alone does not prove a fixed billing principal/path. | Included Work/Codex usage is possible; credits may be used after limits if explicitly enabled. An app cap below 100% prevents such credits while the policy applies, but the SDK supplies no request-bound guarantee to Loom. | **BLOCKED.** Bind the exact auth method, account, revision and no-credit enforcement to the transport attempt. |
| **ChatGPT OAuth, legacy Codex backend**: `openai` / `chatgpt-browser` or `chatgpt-headless` | Native plugin targets the Codex backend and may derive an account hint from OAuth token claims; that hint is not provider-certified effective billing-account identity. | Current Codex/ChatGPT plan rules can include optional credits and different Enterprise USD or credit billing. No official mapping verifies that these terms apply unchanged to this OpenCode legacy integration. | **UNPROVEN; operationally BLOCKED.** Audit the exact legacy path and request-bound account/policy enforcement separately. |
| **GitHub Copilot Individual**: `github-copilot` | OAuth and model listing identify a connected integration, not the applicable individual billing account and paid usage policy. | Included monthly AI credits may be followed by paid additional usage depending on plan/budget. A visible balance or model catalog does not guarantee no extra charges. | **BLOCKED.** Require effective account/plan and enforced no-additional-usage proof at send time. |
| **GitHub Copilot Business / Enterprise**: `github-copilot` | Licensed members draw from a **billing-entity pooled** included credit allowance. Multiple org/enterprise seats or a changed active billing entity can change applicable billing controls. | Additional paid use is **enabled by default**; administrators can disable the **AI credits paid usage** policy so exhausted pools block requests. Org, cost-center and enterprise spending limits must be enforced stops, not alert-only budgets. A **user-level $0 budget blocks included use too**, unlike a paid-overage-only guard. | **BLOCKED.** Document the effective billing org/enterprise, applicable pooled allowance, admin paid-use setting and host-binding before declaring included-only. |
| **GitHub Copilot access** (Enterprise Cloud/Standalone) | A seat enables metered features, but there is **no included credit allowance** to qualify. | AI-credit features are metered from the first request. Turning off paid AI-credit usage stops those features rather than unlocking included traffic. | **NOT AN INCLUDED ROUTE; BLOCKED.** Never treat seat assignment as an included quota. |

**None is qualified** by the inspected public SDK and provider contracts. A provider can be *commercially included* but still be *technically unqualified* for Loom's no-paid requirement.

## Evidence behind the judgments

### OpenCode Go: genuine spend guard, but no safe Loom assertion

OpenCode [Go terms and model list](https://dev.opencode.ai/v2/docs/console/go) document time-window/monthly allowances and paid **Extra Usage** fallback. [Console budgets](https://dev.opencode.ai/v2/docs/console/budgets) document a real server-side rule: an **all-spend $0 budget** stops counted spending on new requests (HTTP 429), and **Go within plan does not count; paid Go Extra Usage does**. This is **provider enforcement**, not just a UI estimate. However, rules may be changed by authorized owners/admins and are evaluated when requests start; a preflight observation can become stale. This investigation found **no public native host method** that atomically binds the active connection, exact Go entitlement, full effective policy, and actual request to a guaranteed included-only execution.

The [member Budgets API](https://opencode.ai/v2/docs/console/api/budgets) (accessible when checked on 2026-11-01; availability can change) returns data such as `limit_micro_cents`, `exceeded`, and `resets_at` through separately authorized service-account credentials. It is **not** a native Go subscription/Extra Usage attestation. A member override alone is not a proof of all workspace/service-account/model policies. Calling a foreign API with a second key would also need an independently proven connection/workspace mapping, not a guessed match. The [Inference API](https://dev.opencode.ai/v2/docs/console/api/inference) may return `usage.opencode.billing_source` (`go`, `go-plus`, `balance`, `free`, `byok`) and `usage.opencode.allowance`; these are **post-request** observations, not permission to send the next request. The prior [2.1.4 Go study](opencode-go-eligibility.md) remains a historical finding, not proof for a new SDK.

Native audit: [Console provider](https://github.com/anomalyco/opencode/blob/v2.2.0/packages/core/src/plugin/provider/opencode.ts), [connection schema](https://github.com/anomalyco/opencode/blob/v2.2.0/packages/schema/src/connection.ts), [plugin host connection methods](https://github.com/anomalyco/opencode/blob/v2.2.0/packages/core/src/plugin/host.ts), and equivalent [v2.2.4 Console provider](https://github.com/anomalyco/opencode/blob/v2.2.4/packages/core/src/plugin/provider/opencode.ts). The connection exposes record identity and `needs_auth`, but **not** plan, paid-overage policy, current allowance, or a provider-enforced per-request included-only option. Native `opencode-go` may be a remote provider while the credential belongs to the `opencode` integration: matching one string to the other does not prove the billing account.

**Go Teams qualification:** [OpenCode's Go plan documentation](https://opencode.ai/v2/docs/console/go/) says Go Teams covers individual workspace members, not service accounts, and starts with Extra Usage enabled. A service-account token in a Go Teams workspace therefore cannot inherit a human member's included allowance. A $0 workspace budget may stop paid Extra Usage, but it still must be bound to the actual request and checked for applicable policy changes.

### OpenAI: two paths share a provider ID

The OpenCode [token-sharing plugin at 2.2.0](https://github.com/anomalyco/opencode/blob/v2.2.0/packages/core/src/plugin/provider/chatgpt.ts) and [2.2.4](https://github.com/anomalyco/opencode/blob/v2.2.4/packages/core/src/plugin/provider/chatgpt.ts) use OAuth method `chatgpt-token-sharing` under `openai` and explicitly treat a `subscription_sharing_usage_limit_exceeded` response as a reason not to retry. A **failed request** does not prove that the prior or next attempt could not spend credits. [OpenAI's current plan-sharing terms](https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites) describe optional credit use after included allowance and the UI-based controls. They do **not** document a plugin-facing, request-bound guarantee for Loom.

The separate [legacy OpenAI provider plugin at 2.2.0](https://github.com/anomalyco/opencode/blob/v2.2.0/packages/core/src/plugin/provider/openai.ts) uses a Codex backend and the other OAuth methods. [Loom's historical native proof](../src/model-routing-runtime.ts) matches this legacy shape using OAuth, endpoint, headers and empty cost. It cannot distinguish all policy details of the actual account, cannot authorize token-sharing semantics and is **not active in production**. Neither plugin's empty `cost` array is a provider-issued billing verdict.

**Related first-party Codex billing evidence:** [OpenAI's current ChatGPT/Codex terms](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan) describe included usage, optional credits and Enterprise arrangements, including credit-based versus USD/token-billed workspaces. The legacy [OpenCode OAuth plugin](https://github.com/anomalyco/opencode/blob/v2.2.0/packages/core/src/plugin/provider/openai.ts#L377-L429) can extract a possible account ID from token claims. Neither an OAuth claim nor these general first-party terms proves the exact legacy `chatgpt.com/backend-api/codex` request's billing account or a request-bound no-paid guard.

### GitHub Copilot: effective billing entity and policy matter

The [native Copilot provider at 2.2.0](https://github.com/anomalyco/opencode/blob/v2.2.0/packages/core/src/plugin/provider/github-copilot.ts) lists models and reads the active credential record; it exposes no request-bound entitlement or effective billing organization to Loom.

Under [GitHub's organizational billing rules](https://docs.github.com/en/copilot/concepts/billing-and-usage/organizations-and-enterprises/billing), Business and Enterprise licenses contribute included credits to a shared pool. **Additional paid credits are enabled by default.** Administrators can disable paid AI-credit usage, which then blocks AI-credit requests when the pool is exhausted. Under [budget controls](https://docs.github.com/en/copilot/concepts/billing-and-usage/organizations-and-enterprises/budgets), a **user-level $0 budget is not a free-use-only mode**: it also blocks included AI-credit requests. A budget for organization, cost center or enterprise has different scope and must be an enforced spending stop, not merely an alert. Cost-center included-usage caps differ again from paid-usage budgets. Copilot access has no included pool, so there is no eligible included-only route for credit-consuming features.

A member may hold licenses from several organizations; GitHub's [seat/billing documentation](https://docs.github.com/en/copilot/concepts/billing-and-usage/organizations-and-enterprises/seats-and-billing-cycles) records the charged organization, and membership or billed organization can change across cycles. Even a valid admin setting is insufficient unless the native request identifies the **actual billing entity**, effective policy, and its still-enforced no-paid outcome at send time. A plugin-side credential lookup, static user setting or report does not prove this binding.


## Required Loom attestation contract (proposal; not implemented)

The existing [runtime interface](../src/model-routing-runtime.ts) accepts `RouteEligibilitySource.inspect({providerID, modelID, connectionID})` and returns `RouteAttestation` with `verified`, `billing`, `quota`, optional `cooldownUntil`. This is an appropriate seam for discovery, but a boolean `verified` and a connection-record ID are **not sufficient evidence of no paid fallback**, and there is no expiry, authoritative billing account, proof kind, or request lease.

Before any positive included routing qualification, a **trusted native provider/host adapter**, not config or an untrusted arbitrary plugin, must produce the following minimum semantics:

~~~ts
// Proposed semantics, NOT a current OpenCode API or a Loom implementation.
// The host must issue and enforce this binding AT THE NATIVE SEND boundary.
type NativeDispatchBinding = {
  attemptID: string                  // unique for this provider transport send
  nativeConnectionID: string         // opaque credential record, never account proof
  authenticationMethodID: string     // exact native OAuth/provider method, not generic "oauth"
  credentialRevision: string         // changes on refresh/method/identity changes
  billingAccountID: string          // independently established provider principal
}
type IncludedBillingProof = {
  providerID: string
  modelID: string
  variant?: string
  dispatch: NativeDispatchBinding    // ties proof to THIS send, not a reusable session
  classification: "included-only"
  authority: "provider-enforced"
  enforcement: "request-bound" | "host-locked-policy"
  policyVersion?: string
  issuedAtMs: number
  expiresAtMs: number
  noPaidFallback: true
}
type IncludedOnlyDecision =
  | { status: "included"; proof: IncludedBillingProof }
  | { status: "unknown" | "denied" }

// A "metered" classification is informational here, NOT paid authorization.
// Verified metered routing needs a DIFFERENT explicit, account-bound paid
// consent/enforcement contract; this included-only proof cannot grant it.
type BillingClassification = "included" | "metered" | "unknown"
~~~

**Normative behavior to implement only after provider support is proven:**

1. A trusted host/provider adapter must validate entitlement, exact provider/model/variant, proof issuer and no-paid restriction against the **effective native transport billing account**. The binding must include the exact OAuth/auth method, a credential generation/revision that changes whenever method, principal or authorization changes, and the **host-owned attempt identity** (issue #205). A generic `method: "oauth"`, unchanged credential record ID, or account ID inferred from token claims does NOT establish this binding. The host must re-resolve/reject if authentication changes before the send. The proof object is only a description of host/provider enforcement; copying it into Loom does not authorize an unrestricted call.
2. The host must **enforce** included-only use for the actual request, either through a provider-accepted atomic **request-bound no-paid option**, or through a provider-host-guaranteed policy lock that cannot be weakened between inspection and request admission. A policy read followed by an ordinary unrestricted request does **not** qualify. This may require an upstream API and native connection lease; no current path supplies one.
3. Every managed **primary and auxiliary** model request independently checks proof just before transport, then the shared quota `reserve()` narrows eligibility. `expiresAtMs > now` is necessary but does not repair a mutable-policy race. Freshness and the upstream revocation/policy version must be validated at dispatch. No arbitrary cached TTL may turn a UI observation into authority.
4. Unknown/missing/malformed/expired/contradictory proof; missing billing account; disconnected, refreshed or switched native credential; unsupported model/variant; revoked entitlement; changed effective billing policy; lost proof channel; or native host lacking an enforceable preflight path -> **deny** before transport. Failure or retry must **not** switch credentials or replay work.
5. The included-only decision has **no `metered` allow branch**. A metered classification is not authorization. Only an **independent, account-bound verified metered contract plus explicit user authorization and `paid-fallback: true`** could permit paid routing in separately approved future work; neither exists in this proposal. `paid-fallback: false` remains the default, and unknown remains denied.
6. Store only opaque account references, validity/revocation metadata and normalized quota outcomes; no access/refresh tokens, private identities, full inference bodies or raw billing details. Never expose account IDs in user-facing previews. Account revocation invalidates all its model proofs; quota exhaustion can only **narrow** a verified route.

**Contract ownership:** provider owns billable classification and guaranteed spend enforcement; OpenCode owns active credential, account binding and request execution; Loom owns conservative selection, local shared quota and denial. Issue [#205](https://github.com/bateau84/loom/issues/205) establishes the separate native request/account identity requirements. This is **a future contract**, not an assertion that the proposed fields are already exposed by the SDK or providers.

## Verification plan

### Deterministic, credential-free tests (future implementation)

Use a stub native host with scripted clock, provider policy generation, accounts and request executor. Capture whether transport is invoked; never call real endpoints.

| Case | Required result |
| --- | --- |
| Matching account, exact model/variant, unexpired **provider-enforced request-only** proof, successful host-bound request identity | One permitted reservation and one dispatch (positive *simulation*, not real provider qualification) |
| Absent proof; `verified` without enforceable proof; token-sharing `cost: []`; valid Go key; Copilot model list; UI/budget screenshot; previous `billing_source=go` | `billing: unknown`, zero transport |
| Proof for account A but native credential B; different workspace behind two keys; changed exact OAuth method while retaining native connection ID; credential revision changed; dispatch attempt does not match proof; lost native binding | Zero transport; never reuse the proof or pool two connections as independent subscriptions without provider-confirmed billing-account mapping |
| Expired/NaN timestamps; untrusted issuer; missing no-paid restriction; wrong provider/model/variant; revoked plan; changed policyVersion; stale cached result | Zero transport |
| UI shows $0 all-spend cap but policy may change after read; member budget exists but workspace default cannot be verified; Copilot user-level $0 budget mistaken for free-use guard | Zero transport |
| Quota exhausted/revoked after inventory planning, before request; another process reserves final slot; managed auxiliary title/compaction request | Deny before transport (for each managed request); no paid/global default fallback |
| Service-account credential in Go Teams; Copilot access with no included pool; Copilot organization paid policy enabled or billing entity changed | No included-only transport, even if model list and credential lookup succeed |
| A route labeled `metered` without independent account-bound verified paid authorization (even when a caller opts into `paid-fallback`) | No transport under included-only decision; classification is not spending permission |
| Source outage or malformed response; unknown model; subscription expires; provider responds 401/403/429 or ambiguous retry | Fail closed; no speculative success accounting, re-routing or request replay |
| Routing explicitly disabled | Native OpenCode behavior unchanged (negative control) |

These tests demonstrate Loom's **refusal**, not a positive real provider entitlement. Positive installed-host approval also requires an exact SDK/CLI version-matched native account/dispatch test under issue #206 after this issue and #205's upstream blockers are resolved.

### Separate disposable-account live verification (not authorized here)

Only after **explicit authorization**, with a purpose-created disposable account/workspace and a provider-supported zero-charge guard, run tightly bounded first-party provider/host checks. Verify the precise native connection, model/variant, pre-dispatch no-paid proof, provider refusal at exhausted allowance, post-request billing classification and any invoice/credit delta. Prove credential/policy switching and refresh are detected, and that no title/compaction call escapes. Stop immediately if the guard or trustworthy evidence is unavailable. Never collect or echo personal credentials. **Do not consume paid credits or intentionally drain a real subscription** merely to force exhaustion; if safe exhausted-state testing is impossible, leave the route blocked.

## Decision and upstream requests

| Integration | As-of-2026-11-01 status | Needed to graduate |
| --- | --- | --- |
| OpenCode Go / Plus / Teams | **NEEDS UPSTREAM SUPPORT — BLOCKED** | Account/workspace **and member-vs-service-account identity**, exact model entitlement + provider-enforced Go-only request mode (or race-free locked all-spend $0 policy) available to native host |
| ChatGPT token sharing | **NEEDS UPSTREAM SUPPORT — BLOCKED** | Current account's allowed plan/credit mode with no-credit request enforcement and revocation/policy change signaling |
| ChatGPT legacy Codex | **NEEDS UPSTREAM SUPPORT — BLOCKED** | Authoritative documented billing behavior for the active legacy OAuth account plus request-bound enforcement and native binding |
| GitHub Copilot Individual / Business / Enterprise | **NEEDS UPSTREAM SUPPORT — BLOCKED** | Exact billing user/seat **and effective org/enterprise**, included credit pool, applicable admin paid-AI-credit policy and enforced request-bound no-additional-spend guarantee; a user-level $0 budget is not sufficient |
| GitHub Copilot access | **NO INCLUDED ALLOWANCE — BLOCKED** | Credit-consuming features are metered from the first use; no included-only claim is possible with this plan |

**No activation change is recommended.** Keep `registerModelRouting()` host-unqualified, all managed routes denied, and the existing pure planner / quota manager available for tests. Pursue upstream provider/SDK attestations and [#205](https://github.com/bateau84/loom/issues/205); implement and verify an initial live route only through [#206](https://github.com/bateau84/loom/issues/206) after a *positive* provider-specific, version-matched proof exists. A documentation claim or deterministic mock test must not be counted as that proof.

## Depends on

- [Loom model routing and guard](model-routing.md)
- [Shared subscription quota state](shared-subscription-quota.md)
- [Historical OpenCode Go eligibility](opencode-go-eligibility.md)
- [Native safe fallback constraints](opencode-v2-safe-live-fallback.md)
