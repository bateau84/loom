---
type: Architecture
title: "Shared subscription quota state and adapter contract"
description: "Local SQLite quota state, account isolation, evidence, recovery and integration requirements."
tags: [loom, model-routing, quota, concurrency]
timestamp: 2026-10-24T00:00:00Z
---

# Shared subscription quota state

**Status:** Implemented as a separate library in src/quota-state.ts. Not yet wired to real OpenCode requests; this PR does not deliver live failover.

## Persistence and safety

openSharedQuotaState() opens an independent SQLite WAL database in the user state directory, under loom/quota-v1/subscriptions.sqlite. XDG_STATE_HOME is respected when absolute; otherwise use ~/.local/state. This is machine-local to a single OS user, shared by OpenCode instances and projects, **not** Loom's project Action ledger and not a cross-host coordination service. Network filesystems are not supported. BEGIN IMMEDIATE serializes mutations, with a bounded 5-second busy timeout.

The store requires a user-owned mode-0700 directory and a user-owned regular mode-0600 database. Corrupt, inaccessible, unsafe-permission, symlink or unsupported-version data produces an error; the adapter must fail closed instead of inventing available quota. There is no silent reset or migration. WAL sidecar files are protected by the private directory.

The store persists only SHA-256 route/scope identity hashes, bounded numeric timestamps, counters, state enums and random recovery-lease IDs. It does not persist API keys, bearer/refresh tokens, raw account IDs, emails, prompts, request bodies or response bodies. An accountID **must** be a stable, opaque, non-secret identifier obtained from supported OpenCode authentication metadata; never use a credential or a credential hash as an account ID. Hashes are not protection against a process already compromised under the same OS user.

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
  // If reservation is denied, replan without that blocked route.
  // If permitted, pin provider/model/account through dispatch and tools:
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

All upstream classification, authentication, retries, live dispatch, stream/tool-continuation affinity and accounting are the runtime adapter's responsibility. Retry and reset timestamps are accepted only when reported or normalized reliably; this module cannot fetch them. Do not replay tool side effects. Never treat provider name or a configured model alias as proof that billing is included. paid-fallback remains off by default; unknown billing is never eligible. When model routing is disabled, do not open the quota store or change native OpenCode behavior.

## Verification and current limitations

The tests in tests/quota-state-native.test.ts and tests/fixtures/quota-worker.ts exercise separate Bun processes, independent concurrent writers, a single winner for an expired recovery probe, account/provider isolation, wider-scope evidence, states and cooldown recovery, auth refresh, revision guards against stale results, restart, corruption and private file access. Tests model normalized provider evidence; **real OpenCode V2 request dispatch, actual subscription billing classification, provider-specific remaining/reset discovery and multi-provider failover still require installed-host acceptance**.

If a provider supplies no quota endpoint or trustworthy scope, use observed errors and account-model cooldown. This can permit limited attempts while unknown, and can delay newly recovered use; the code does not pretend to know precise remaining units or reset dates. This storage is local per machine/user, not shared across machines.

## Depends on

- [Model class routing contract](model-routing.md) defines the planner and verified billing requirements.
- [OpenCode 2.1.1 compatibility](opencode-2.1.1.md) defines the installed host integration constraints.
