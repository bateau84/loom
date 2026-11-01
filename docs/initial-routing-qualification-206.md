---
type: Architecture
title: "Initial native model-routing qualification — issue 206"
description: "Exact SDK/host evidence, startup safety boundary, unresolved upstream guarantees and acceptance to enable included-only initial selection."
tags: [loom, opencode, model-routing, qualification, billing, safety]
timestamp: 2026-11-01T00:00:00Z
---

# Initial native model-routing qualification — #206

**Decision: BLOCKED; zero qualified managed provider/account/model routes.**
Do not add an active version allowlist or call
`registerModelRoutingCandidate()` in the production plugin. Passing local
provider denial tests cannot qualify a paid or included subscription request.
Issue [#206](https://github.com/bateau84/loom/issues/206) remains **open**.

## Tested and source-inspected host versions

| Pair | Evidence | Managed included-only initial routing |
| --- | --- | --- |
| `@opencode/plugin@2.2.0` and installed `@opencode/cli@2.2.0` | Locked Loom package and installed-host workflows; PR #190's packed-host **negative** guards, disabled/native tool continuation and fixture checks | **BLOCKED / positive UNPROVEN** |
| SDK/CLI `2.2.5` | Upstream tagged **source inspection only** (tag `9bbb8ce18c80f099e0e448775f59d965ead40a21`). No Loom SDK upgrade, host installation or positive subscription test | **UNQUALIFIED; not installed-tested** |
| 2.1.4 historical candidate, SDK 2.2.0 mixed pair or other host/SDK combinations | Historical mocked adapter or unknown/mismatched API | **BLOCKED** |

The `2.2.5` [session hooks](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/plugin/src/promise/session.ts#L62-L140)
still expose `sessionID`, request `kind`, model, and a retry **ordinal**,
not a transport-attempt ID, effective billing account, or a settled-attempt
join. [Native request construction](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/session/model-request.ts#L318-L399)
prepares model-request and HTTP/WS hooks separately, while
[model resolution](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/model-resolver.ts#L453-L480)
still calls `connection.active()` and `connection.resolve()` without
publishing an effective-account lease to the plugin. The newer release
therefore **does not change** #204/#205's safety verdict. This is *not* an
exhaustive audit of every private provider implementation, nor installed
acceptance for 2.2.5.

OpenCode's native `model.request` hook can deny a model request **after that
hook has registered**. That is not a substitute for a provider-side zero-paid
restriction when a plugin never loads, its hook cannot register or a different
transport bypasses it. The public Loom [server entrypoint](../server.ts)
now initializes core before optional skill/review registration and retains the
core guard if those optional registrations fail. This narrows one startup
window; it does **not** solve plugin absence, a failing core guard registration,
nor account-bound billing.

## Ownership and current implementation

| Capability | Location / owner | State |
| --- | --- | --- |
| Ordered model classes, model aliases, per-agent reasoning and paid-fallback default | Loom `src/model-routing.ts`, `src/model-routing-runtime.ts`, configuration | **Implemented (pure policy)** |
| Shared cross-process quota, conservative reservations and failure fencing | Loom `src/quota-state.ts`, `src/model-routing-shared-quota.ts` | **Implemented (state only)**; no certified live account outcomes |
| Exact agent native model/variant transform, initial-route mismatch guard | Loom historical `registerModelRoutingCandidate()` | **Internal test candidate, inactive** |
| Host-unqualified native pre-transport denial and disabled routing compatibility | Loom `src/plugin.ts` / `registerModelRouting()`, exact installed 2.2.0 checks | **Implemented for a loaded, versioned host** |
| Server entrypoint guard before optional skill/review transforms | Loom `server.ts`, `tests/server-startup-native.test.ts` | **Changed in #206 draft**; validate in CI/installed host |
| Exact effective **provider billing principal** bound to native credential generation and send attempt | OpenCode + native provider integration | **Missing supported API** |
| Provider-enforced **included-only/no-paid** dispatch guarantee and current model entitlement, bound to that same native attempt | Billing provider + OpenCode | **Missing supported guarantee for all candidate routes** |
| Unique native attempt identity and final stream/failure/cancel outcome joined to request kind and effective account | OpenCode | **Missing supported API** |
| An approved exact version + provider/account route that passes installed **positive** native dispatch/variant/identity/billing acceptance | Joint qualification | **None** |

Review [#204's provider-specific billing matrix](subscription-billing-qualification.md)
and [#205's identity counterexamples and smallest proposed interfaces](native-request-identity.md).
This report does not relabel an OAuth claim, native connection record ID,
catalog cost, manually read $0 budget, or post-request billing summary as
dispatch authorization.

## Minimal upstream work to unblock initial routing

1. **Host-bound pre-send admission:** expose the exact native
   `providerID/modelID/variant/kind/attemptID`, *verified effective provider
   billing principal*, auth method/revision and an enforceable included-only
   decision for the **same** send. A changed credential, principal, policy,
   variant or WS connection must cause a fresh binding or denial *before
   provider I/O*. No new transport or credential resolver is implemented by Loom.
2. **Provider-enforced no-paid contract:** offer a request-level included-only
   mode or an equally strong immutable, host-verifiable policy lock on the
   effective billing account. For Go, prove Go usage cannot fall through to
   paid Extra Usage (including Teams/member scope); for ChatGPT, prove the
   actual OAuth backend cannot spend credits; for Copilot, prove the effective
   billing entity and paid-AI-credit policy. A mutable UI switch/read does
   not qualify; if enforcement is unknown, the host must reject the send.
3. **Per-attempt final evidence:** associate completed streams, quota failures,
   retries, cancellation and lost/unknown outcomes with the exact
   `attemptID` and effective billing principal; expose duplicate/reordering
   rules. HTTP 200 or a Session completion alone is not settlement. This
   supports safe failure attribution without permitting in-flight switching.

Names above are **interface requirements**, not existing plugin SDK types.
Initial selection does not need a `nextModel` or tool replay API. Once a
provider and exact host jointly implement these guarantees, Loom can add a
strict host/provider allowlist and consume the native contract. The provider
and host, not a plugin-side credential lookup, must enforce the billable identity.

## Qualification tests: mandatory, separate evidence levels

**Deterministic boundary tests (can be built in Loom):**
- Wrong native model, unsupported or downgraded variant, wrong provider,
  mismatched/rotated effective account or credential revision, stale/expired
  eligibility, unknown/paid billing, missing attempt ID or untrusted proof:
  **zero transport** and no tool effect.
- Quota exhaustion after planning but before send and any competing
  reservation: deny. Auxiliary title/compaction/generate calls must use
  the same verified per-send safety rule.
- Primary continuation, retries, cancellation, HTTP-200-then-stream-error,
  delayed compaction B versus primary A, WebSocket reuse and restart:
  never attribute the wrong account or replay native tools.
- Explicitly disabled routing: preserve native model/variant selection,
  primary and auxiliary requests, tools, failures and continuations.
- Missing plugin or failed native hook registration: **no claim of plugin
  protection**. Qualifying a real route additionally requires provider/host
  enforcement that independently prevents paid use.

**Installed-host acceptance (not yet achieved):**
- Pin and record **exactly matching** CLI and SDK versions, packed Loom
  artifact/hash and provider interface revision. Record a plugin-loaded
  receipt and native hooks, but do not equate them with billing proof.
- Use an **authorized disposable** native provider/account with guaranteed
  non-paid enforcement, not personal credentials or an invented test
  attestation. Confirm the real native request used the exact
  `provider/model/variant` and effective account, and completed with
  included-only billing. Independently verify the provider policy and that
  a disabled/unloaded guard cannot cause paid overage.
- Exercise wrong-model, account switch, exhausted-quota, malformed config,
  auxiliary flow and cancellation negative paths; prove **zero provider
  requests and tool effects** at their unsafe boundaries. Keep local
  scripted-provider behavior and real-account receipts in separate reports.
- Do not automatically consume a real subscription to exhaustion or incur
  charges to manufacture this evidence. If an authorized no-charge
  scenario cannot be tested, mark positive routing **UNPROVEN**, not PASS.
- Require an independent cold review of the implementation and recorded
  host/provider evidence before promoting a version/provider allowlist.

The existing 2.2.0 installed negative acceptance (`tests/routing-host/ACCEPTANCE.md`)
is still the guard regression suite. The new server-startup test is a native
registration **mock** and must be labeled separately from installed-host
proof. No personal OpenCode configuration should be read or modified.

## Decision and next actionable change

**No routing activation in this PR.** First file/agree the minimal OpenCode
host/provider contract above (or demonstrate an existing equivalent on an
**exact** tagged host). Deliver an upstream implementation with native fake
provider/account acceptance, then validate its provider-enforced non-paid
path using an authorized disposable account. Only after both are accepted
should Loom implement the smallest native transform + dispatch gate on
that exact SDK/CLI pair. Do not close #206 for documentation or negative
guard tests.

## Depends on

- [Billing proof / provider matrix](subscription-billing-qualification.md)
- [Native identity / per-attempt requirements](native-request-identity.md)
- [Initial route implementation and guard](model-routing.md)
- Installed host acceptance contract: `tests/routing-host/ACCEPTANCE.md`
