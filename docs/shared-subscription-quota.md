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

An OpenCode 2.1.4 plugin can encounter an unrelated Action-ledger failure
before the quota manager starts, or a damaged quota store can reject startup.
Loom now registers a separate, early native model-request **deny** hook
before either database is opened. For a valid enabled policy, a failure keeps
that hook active and reports `LOOM_MODEL_ROUTING_STARTUP_FAILED` instead of
allowing OpenCode's metered default. For an explicitly disabled policy,
ordinary native requests remain unchanged. A plugin that OpenCode never
activates, or whose first guard registration itself fails, cannot provide
this guarantee; that requires upstream host enforcement.



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
or `provider.auth` error **with provider HTTP 401 status** for a
matching reserved primary request, the adapter
calls `recordFailure()` for that exact account/model. Those tags correspond
to exhausted, throttled and account authentication states respectively.
HTTP 403 is ambiguous model-level authorization and does **not** justify an
indefinite account-wide block. Native normalized `retryAfterMs` delays are
preserved; when both a trusted retry delay and reset time exist, the later
deadline wins. These events do not prove a provider-wide limit, numeric
remaining quota or an unreported reset timestamp; those values are never invented. A classified failure suppresses another
native retry on the blocked route. Unknown errors and native authorization failures without a provider HTTP
status do not update quota. Do not treat pre-dispatch credential validation
as provider evidence.

**Delayed native terminal events:** `session.execution.succeeded`,
`session.execution.failed` and `session.execution.interrupted` carry only
the native Session ID, so they cannot identify which execution's reservation
may be removed. A delayed terminal event for execution A can arrive after B
has reserved in the same Session. Pending reservations and route affinity
are therefore kept across terminal events and released only on
`session.deleted` or plugin shutdown, with an explicit 512-Session
fail-closed memory bound. The newest native request replaces the matching
reservation, and its provider failure can still update shared state.
Native unique request/attempt correlation remains unproven.

**Authentication recovery and provider observations:** Provider-reported
positive remaining allowance cannot lift an account authentication block
caused by confirmed HTTP 401. This remains blocked across all quota scopes,
until a distinct verified credential refresh explicitly calls
`recordAuthenticationRecovered`. A contradictory stored
`available`+provider-evidence row with zero or missing remaining allowance
also fails closed even if SQLite's structural integrity check reports OK.

**Auxiliary request attribution:** Native retry events lack kind/attempt
identity. Managed auxiliary model requests must not change the active
account on the same provider as the pinned primary route. A successful
auxiliary dispatch invalidates the stale primary pending permit for that
Session, so a utility retry cannot poison its previous account's quota
state. A future primary request gets a new permit. The pending map stores
one latest primary record per Session (not per agent/model); 512 distinct
Sessions are supported, with Session deletion allowing readmission.
Full transport-level account pinning remains an upstream limitation.

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

The store requires a user-owned mode-0700 directory and a user-owned regular mode-0600 database. Corrupt, inaccessible, unsafe-permission, symlink or unsupported-version data produces an error; the adapter must fail closed instead of inventing available quota. Schema v2 extends the v1 quota table with a release-revision fence in a single startup transaction, preserving existing rows; it does not reset quota or waive corruption checks. Stored timestamps, counters and lease fields are validated before eligibility decisions; corrupt data is never treated as an expired cooldown. WAL sidecar files are protected by the private directory.

The store persists only SHA-256 route/scope identity hashes, bounded numeric timestamps, counters, state enums and random recovery-lease IDs. It does not persist API keys, bearer/refresh tokens, raw account IDs, emails, prompts, request bodies or response bodies. An accountID **must** be a stable, opaque, non-secret identifier obtained from supported OpenCode authentication metadata. The integration uses the native credential *record ID* (a public metadata reference), never its secret content or a hash of the credential. If this identifier changes on reconnection, the account obtains a fresh conservative quota scope. OpenCode's environment-backed connections expose only an environment variable name, which cannot identify the actual account; they are **not** eligible for managed quota routing until a stable native account identity is available. Hashes are not protection against a process already compromised under the same OS user.

## Account and quota scopes

Available scopes are account-model (the default for unknown 429/exhaustion), account (all models on one login), provider-model (a model across logins), and provider (all models/logins). A wider scope requires reliable provider evidence, represented by scopeVerified:true. An authentication error defaults to account scope. Multiple subscriptions at the same provider are distinct, unless trusted provider policy proves a wider shared limit.

A model-specific quota observation is never silently promoted to an entire account or provider. Unsupported provider quotas remain unknown. The adapter, not this library, must understand provider headers and actual limit scope.

## Normalized signals

| Adapter evidence | State | Release |
| --- | --- | --- |
| Provider subscription remaining greater than zero | available (provider confidence) | Clears the matching quota block only; never clears rejected authentication |
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

**Interface:** eligibility(route) is a read-only hint. reserve(route) is a mandatory atomic dispatch-time check and returns a QuotaPermit revision snapshot. recordSuccess(route,permit,optionalReport), recordFailure(route,permit,failure), recordProviderQuota(route,observation,report) and recordAuthenticationRecovered(route,observation) update shared state. observe(route) captures revisions before an external quota check or auth refresh. inventory(verifiedRoutes) produces pure planner inventory; it never promotes billing to included. An old success/header/failure cannot overwrite a newer exhaustion or recovery revision. Concurrent negative reports within the same recovery epoch are merged conservatively: a stronger exhaustion or longer trusted retry deadline cannot be erased by a weaker report. Explicit recovery advances the release-revision fence, so old reports cannot reblock a recovered route.

The model planner now preserves optional accountID and deduplicates by provider/model/account, rather than accidentally discarding a second subscription under the same provider. Old pure planner callers can omit accountID; **managed** route inventory must include it. Do not construct permits manually.

The adapter classifies only the trusted native error tags described above. Authentication, unobserved successful outcomes, live provider switching and native stream/account affinity remain outside its proven capability. Retry and reset timestamps are accepted only when reported or normalized reliably; the library does not fetch them. Do not replay tool side effects. Never treat provider name or a configured model alias as proof that billing is included. paid-fallback remains off by default; unknown billing is never eligible. When model routing is explicitly disabled in a valid configuration, do not open the quota store or change native OpenCode behavior. If configuration loading fails on a capable 2.1.4 host, the adapter blocks native model requests before transport rather than interpreting unreadable policy as intentionally disabled. A lost native terminal-event subscription also blocks subsequent managed requests until restart.

## Verification and current limitations

The tests in tests/quota-state-native.test.ts and tests/fixtures/quota-worker.ts exercise separate Bun processes, independent concurrent writers, a single winner for an expired recovery probe, account/provider isolation, wider-scope evidence, states and cooldown recovery, auth refresh, revision guards against stale results, restart, corruption and private file access. Tests model normalized provider evidence; **real OpenCode V2 request dispatch, actual subscription billing classification, provider-specific remaining/reset discovery and multi-provider failover still require installed-host acceptance**.

If a provider supplies no quota endpoint or trustworthy scope, use observed errors and account-model cooldown. This can permit limited attempts while unknown, and can delay newly recovered use; the code does not pretend to know precise remaining units or reset dates. This storage is local per machine/user, not shared across machines.

## Depends on

- [Model class routing contract](model-routing.md) defines the planner and verified billing requirements.
- [OpenCode 2.1.1 compatibility](opencode-2.1.1.md) defines the installed host integration constraints.
