---
type: Architecture
title: "Shared subscription quota state and adapter contract"
description: "Local SQLite quota state, account isolation, evidence, recovery and integration requirements."
tags: [loom, model-routing, quota, concurrency]
timestamp: 2026-10-24T00:00:00Z
---

# Shared subscription quota state

**Status:** Implemented in `src/quota-state.ts` and connected to the guarded OpenCode 2.1.4 **initial** model-selection path through `src/model-routing-adapter.ts` and `src/model-routing-shared-quota.ts`. This does **not** provide seamless live provider fallback or authenticated stream/account affinity.

## Integrated initial routing and outcome evidence

A valid opt-in routing configuration opens the same shared SQLite state under
the user's state home in every process. Missing, corrupt, inaccessible or unsafe
quota storage prevents guarded routing startup; disabling routing does not open
this store. Quota data and verified subscription billing are **separate**:
eligibility can only reduce a verified provider/model/account candidate; even
a provider report of remaining units cannot authorize unknown-billing usage.

**Initial selection:** the adapter reads each account's shared `eligibility()`
when constructing the native agent model plan. Model-first/provider-second
ordering is preserved. OpenCode currently exposes only **one active native
connection per provider**, so Loom cannot dispatch through arbitrary inactive
accounts. An already-running process does not mutate its agent model during
an active Session when another process exhausts the selected route. Its next
pre-dispatch check fails closed; a fresh plugin activation can select an eligible
provider. This is not live failover or automatic per-account switching.

**Dispatch:** every managed native primary request must obtain a successful,
atomic `reserve()` in `session.hook("model.request")`, after verifying exact
model, reasoning, billing and observed active connection. Managed auxiliary
requests are also reserved. If another process wrote an exhaustion/cooldown
between initial planning and dispatch, the atomic reservation rejects the
request. No alternate model is sent, and no tool call is replayed. The adapter
retains only a process-local comparison of Session/model/account; it cannot
create an authoritative native connection lease after OpenCode has already
resolved its transport credentials.

**Observed failures:** when OpenCode's `session.retry` hook reports a
**typed** `provider.quota` / `provider.free-limit`, `provider.rate-limit`
or `provider.auth` error for a matching reserved primary request, the adapter
calls `recordFailure()` for that exact account/model. Those tags correspond
to exhausted, throttled and authentication states respectively. They do not
prove a provider-wide limit, numeric remaining quota, or reset timestamp;
those values are never invented. A classified failure suppresses another
native retry on the blocked route. Unknown errors do not update quota.

**No invented success:** OpenCode 2.1.4's plugin request/retry hooks do not
provide a stable, attempt-identified successful stream completion tied to the
*actual active native account*. An HTTP 200, request-hook completion, or a
Session event without a provable attempt/account correlation is insufficient.
The adapter therefore does **not** call `recordSuccess()` automatically.
Likewise, it does not populate `recordProviderQuota()` or
`recordAuthenticationRecovered()` from unverified headers or guesses.
These are valid library operations for a future provider-specific adapter
with trustworthy results, observation revisions and authenticated identity.
Until that exists, a successful recovery probe may remain in the local
probe-due state and require another single-process probe after its lease.
The store's explicit success/recovery methods and races have independent
library tests; they are not claimed as live-provider accounting.

**Limits:** Shared quota applies to OpenCode processes of the same OS user
on one machine (not several machines). It does not grant credentials, prove
subscription coverage, safely rotate a running stream, or override native
permissions. Existing installed-host acceptance proves only the 2.1.4
unknown-billing negative control and normal routing-disabled path. Cross-
process provider/account exhaustion and safe rejection are exercised with
isolated SQLite/Bun-process and mocked native-host tests, not real paid traffic.

## Persistence and safety

openSharedQuotaState() opens an independent SQLite WAL database in the user state directory, under loom/quota-v1/subscriptions.sqlite. XDG_STATE_HOME is respected when absolute; otherwise use ~/.local/state. This is machine-local to a single OS user, shared by OpenCode instances and projects, **not** Loom's project Action ledger and not a cross-host coordination service. Network filesystems are not supported. BEGIN IMMEDIATE serializes mutations, with a bounded 5-second busy timeout.

The store requires a user-owned mode-0700 directory and a user-owned regular mode-0600 database. Corrupt, inaccessible, unsafe-permission, symlink or unsupported-version data produces an error; the adapter must fail closed instead of inventing available quota. There is no silent reset or migration. WAL sidecar files are protected by the private directory.

The store persists only SHA-256 route/scope identity hashes, bounded numeric timestamps, counters, state enums and random recovery-lease IDs. It does not persist API keys, bearer/refresh tokens, raw account IDs, emails, prompts, request bodies or response bodies. An accountID **must** be a stable, opaque, non-secret identifier obtained from supported OpenCode authentication metadata. The integration uses the native credential *record ID* (a public metadata reference), never its secret content or a hash of the credential. If this identifier changes on reconnection, the account obtains a fresh conservative quota scope. OpenCode's environment-backed connections expose only an environment variable name, which cannot identify the actual account; they are **not** eligible for managed quota routing until a stable native account identity is available. Hashes are not protection against a process already compromised under the same OS user.

## Account and quota scopes

Available scopes are account-model (the default for unknown 429/exhaustion), account (all models on one login), provider-model (a model across logins), and provider (all models/logins). A wider scope requires reliable provider evidence, represented by scopeVerified:true. An authentication error defaults to account scope. Multiple subscriptions at the same provider are distinct, unless trusted provider policy proves a wider shared limit.

A model-specific quota observation is never silently promoted to an entire account or provider. Unsupported provider quotas remain unknown. The adapter, not this library, must understand provider headers and actual limit scope.

## Normalized signals

| Adapter evidence | State | Release |
| --- | --- | --- |
| Provider subscription remaining greater than zero | available (provider confidence) | Clears the matching current block |
| Provider subscription remaining zero | exhausted (provider confidence) | Provider reset or a local probe cooldown |
| Confirmed subscription quota exhaustion | exhausted | Provider reset / Retry-After, or local probe cooldown |
| Temporary 429/throttling | throttled | Trusted Retry-After or local cooldown |
| Overloaded/capacity error | overloaded | Trusted retry signal or local cooldown |
| Expired/rejected authentication | authentication | Explicit confirmed auth refresh, never a timer |
| Other request failures | no quota write | Native adapter decides how to surface failure |
| Ordinary successful request | remains unknown without quota headers | Only an owned probe may clear an expired block |

When no reliable reset information exists, the library uses bounded **local probe cooldowns**, initially 15 minutes for quota exhaustion, 30 seconds for throttling, and 15 seconds for overload, with bounded backoff. These are **not** claims about provider reset dates. After expiry, eligibility is probe-due, and one OpenCode process may atomically claim a 60-second probe lease. Other processes see a blocked route during that lease. A successful owned probe clears the block; a new failure restarts cooldown. An abandoned lease expires automatically. A request that runs longer than the probe lease might not clear the block; this favors safety over immediate recovery.

QuotaEligibility distinguishes eligible, quota (available/unknown/exhausted), reason (exhausted/throttled/overloaded/authentication/probe-due), retryAt if known, and confidence (provider/observed/unknown). Throttled and auth-blocked routes map to planner quota=exhausted only because the pure planner has three quota values; the underlying reason is not lost.

## Runtime adapter API

~~~ts
import { openSharedQuotaState } from "./quota-state.js"
import { planModelRoutes } from "./model-routing.js"

const quota = await openSharedQuotaState()
const inventory = quota.inventory(verifiedOpenCodeRoutes)
// Each route: providerID, modelID, accountID, enabled, tools,
// optional reasoning, and independently VERIFIED billing.
// Unknown billing stays unknown; this call never changes billing.
const plan = planModelRoutes(config, agentID, inventory)
if (plan.status === "ready") {
  // Every selected managed route has a stable non-secret accountID.
  const selected = plan.selected
  const reservation = quota.reserve({
    providerID: selected.providerID,
    accountID: selected.accountID!,
    modelID: selected.modelID,
  })
  // On denial, reject the committed native request before transport.
  // Replan at the next safe *initial* model-selection boundary, never by
  // switching a running stream or replaying tool calls.
  // This permit is not an authoritative native account lease:
  if (reservation.eligible && reservation.permit) {
    // On success, call quota.recordSuccess(route, reservation.permit, optionalReport)
    // On a classified failure, call quota.recordFailure(route, reservation.permit, failure)
  }
}
// Independent quota polling: capture an observation BEFORE the provider call,
// then quota.recordProviderQuota(route, observation, providerReport).
// After verified auth refresh: quota.recordAuthenticationRecovered(route, quota.observe(route)).
quota.close()
~~~

**Interface:** eligibility(route) is a read-only hint. reserve(route) is a mandatory atomic dispatch-time check and returns a QuotaPermit revision snapshot. recordSuccess(route,permit,optionalReport), recordFailure(route,permit,failure), recordProviderQuota(route,observation,report) and recordAuthenticationRecovered(route,observation) update shared state. observe(route) captures revisions before an external quota check or auth refresh. inventory(verifiedRoutes) produces pure planner inventory; it never promotes billing to included. An old success/header/failure cannot overwrite a newer exhaustion or recovery revision.

The model planner now preserves optional accountID and deduplicates by provider/model/account, rather than accidentally discarding a second subscription under the same provider. Old pure planner callers can omit accountID; **managed** route inventory must include it. Do not construct permits manually.

The adapter classifies only the trusted native error tags described above. Authentication, unobserved successful outcomes, live provider switching and native stream/account affinity remain outside its proven capability. Retry and reset timestamps are accepted only when reported or normalized reliably; the library does not fetch them. Do not replay tool side effects. Never treat provider name or a configured model alias as proof that billing is included. paid-fallback remains off by default; unknown billing is never eligible. When model routing is disabled, do not open the quota store or change native OpenCode behavior.

## Verification and current limitations

The tests in tests/quota-state-native.test.ts and tests/fixtures/quota-worker.ts exercise separate Bun processes, independent concurrent writers, a single winner for an expired recovery probe, account/provider isolation, wider-scope evidence, states and cooldown recovery, auth refresh, revision guards against stale results, restart, corruption and private file access. Tests model normalized provider evidence; **real OpenCode V2 request dispatch, actual subscription billing classification, provider-specific remaining/reset discovery and multi-provider failover still require installed-host acceptance**.

If a provider supplies no quota endpoint or trustworthy scope, use observed errors and account-model cooldown. This can permit limited attempts while unknown, and can delay newly recovered use; the code does not pretend to know precise remaining units or reset dates. This storage is local per machine/user, not shared across machines.

## Depends on

- [Model class routing contract](model-routing.md) defines the planner and verified billing requirements.
- [OpenCode 2.1.1 compatibility](opencode-2.1.1.md) defines the installed host integration constraints.
