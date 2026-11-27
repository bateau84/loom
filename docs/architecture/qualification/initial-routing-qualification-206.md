---
type: Qualification Report
title: "Initial native model-routing qualification — issue 206"
description: "Exact SDK/host evidence, startup safety boundary, unresolved upstream guarantees and acceptance to enable included-only initial selection."
tags: [loom, opencode, model-routing, qualification, billing, safety]
timestamp: 2026-11-27T00:00:00Z
---

# Initial native model-routing qualification — #206

**Decision: BLOCKED; zero qualified managed provider/account/model routes.**
Do not add an active version allowlist or call
`registerModelRoutingCandidate()` or the new request-local candidate in the
production plugin. Passing local provider mechanics or denial tests cannot
qualify a paid or included subscription request.
Issue [#206](https://github.com/bateau84/loom/issues/206) remains **open**.

## Tested and source-inspected host versions

| Pair | Evidence | Managed included-only initial routing |
| --- | --- | --- |
| `@opencode/plugin@2.3.0` and installed `@opencode/cli@2.3.0` | Current locked SDK/CLI from merged #238; compatibility, negative routing guard and disabled-native controls. The separate request-local mechanics suite passes 27 local-provider cases below | **BLOCKED / zero qualified positive accounts** |
| `@opencode/plugin@2.2.6` and installed `@opencode/cli@2.2.6` | Historical #226 packed installed host optional-replay failure discriminator, negative guard and disabled-native fallback | **Historical only; positive UNPROVEN** |
| `@opencode/plugin@2.2.0` and installed `@opencode/cli@2.2.0` | Historical PR #190 installed negative controls; superseded by current paired host | **Historical only; positive UNPROVEN** |
| SDK/CLI `2.2.5` | Upstream tagged **source inspection only** (tag `9bbb8ce18c80f099e0e448775f59d965ead40a21`). No Loom SDK upgrade, host installation or positive subscription test | **UNQUALIFIED; not installed-tested** |
| 2.1.4 historical candidate, SDK 2.2.0 mixed pair or other host/SDK combinations | Historical mocked adapter or unknown/mismatched API | **BLOCKED** |

The historical `2.2.5` [session hooks](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/plugin/src/promise/session.ts#L62-L140)
still expose `sessionID`, request `kind`, model, and a retry **ordinal**,
not a transport-attempt ID, effective billing account, or a settled-attempt
join. [Native request construction](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/session/model-request.ts#L318-L399)
prepares model-request and HTTP/WS hooks separately, while
[model resolution](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/model-resolver.ts#L453-L480)
still calls `connection.active()` and `connection.resolve()` without
publishing an effective-account lease to the plugin. No equivalent supported attempt/account binding was qualified on the installed 2.2.6 pairing, and the current 2.3.0 [session hooks](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/plugin/src/promise/session.ts) do not supply that binding;
passing its negative guard controls does **not** change #204/#205's safety verdict. This is *not* an
exhaustive audit of every private provider implementation, nor installed
acceptance for 2.2.5.

OpenCode's native `model.request` hook can deny a model request **after that
hook has registered**. That is not a substitute for a provider-side zero-paid
restriction when a plugin never loads, its hook cannot register or a different
transport bypasses it. The public Loom [server entrypoint](../../../server.ts)
now initializes core before optional skill/review registration and retains the
core guard if those optional registrations fail.

**Deferred transform replay matters as much as initial setup.** In exact
OpenCode 2.2.0 [State.group / State.create](https://github.com/anomalyco/opencode/blob/v2.2.0/packages/core/src/state.ts),
a registered transform is replayed during registry rebuilds. If an optional
callback throws later, the host disables the entire plugin group and
[closes its scope](https://github.com/anomalyco/opencode/blob/v2.2.0/packages/core/src/plugin.ts),
which also [disposes its model.request hook](https://github.com/anomalyco/opencode/blob/v2.2.0/packages/core/src/plugin/hooks.ts).
The merged implementation therefore contains editor failures **inside** the optional
skill/review transform callbacks, not only in the initial registration awaits.
It keeps core cleanup first, attempts every optional cleanup, and preserves
the earliest failure when multiple disposals fail.

The [native unit regression](../../../tests/server-startup-native.test.ts) and
`tests/installed_optional_replay.py` check healthy core startup, deferred
callback replay, retained pre-transport denial and disabled-native behavior.
The historical #226 port used a fault wrapper around the exact npm-packed Loom server in an
**unmodified 2.2.6 host**, plus a deliberately uncontained native group-failure
control. The earlier 2.2.0 run is retained only as historical evidence. Its local metered-*labelled* model has no real billing ability.
These tests do not qualify routing on a real account. This still does **not**
solve plugin absence, a failing core guard registration, another host-owned
unload or account-bound billing; provider-enforced no-paid protection is
required independently of plugin lifetime.

## Request-local candidate on OpenCode 2.3.0

`src/request-local-model-routing.ts` is an **internal mechanics candidate**,
called only by the isolated qualification fixture. It reuses
`planWorkloadRoutes()` with fixture-supplied configuration, inventory and
assignment inputs. It is not called by `registerModelRouting()`, does not
consume candidate-journal records, and supplies no live billing approval.

The [native resolver](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/core/src/session/runner/model.ts#L81-L120)
selects the stored Session model, then agent/global defaults, before
`experimental.model.resolve`. The hook permits a same-provider model/variant
replacement without changing the stored Session model. The candidate reads
the native Session owner and stored selection at resolution and guard time,
preserves an explicit choice that exactly matches the plan, and denies a
conflicting explicit choice. It replaces the whole hook `model` reference,
not fields of the host's original reference. Different-provider plans and
missing exact reasoning support are unavailable.

The `model.request` callback independently re-evaluates the current supplied
policy and validates the actual provider/model/variant. There is no consumable
Session/kind receipt or persistent route lease: [title selection](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/core/src/session/context.ts#L99-L133)
can resolve both preferred and fallback models speculatively, and
[compaction](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/core/src/session/compaction.ts#L285-L292)
can reuse the primary context without a fresh resolver call.

**This is not a guard for every physical transport attempt.** Native
[generate retries](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/core/src/session/generate.ts#L56-L73)
reuse a prepared request, and the [compaction retry loop](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/core/src/session/compaction.ts#L618-L705)
can resend after the earlier `model.request` invocation. Fresh account,
eligibility and policy enforcement at those sends remains part of #205/#206.
The candidate neither attributes retries to billing accounts nor reserves
quota during speculative resolution.

`tests/installed_request_local_routing.py` passed **27 installed mechanics
cases** on 2026-11-19 with exact CLI/SDK 2.3.0, a packed candidate and an
in-memory native provider. The actual model ID and native variant header reach
the provider, while stored Session choices and agent defaults remain unchanged.
The suite covers explicit-choice precedence, wrong-provider/model/variant
refusal, uncertain assessment, unknown billing labels, stale eligibility,
late resolver mutation, concurrent workloads of one agent, a single native
tool with continuation, all four request kinds, and process restart.

| Installed retry discriminator | Resolver calls | `model.request` validations | Provider attempts |
| --- | ---: | ---: | ---: |
| Primary retry | 2 | 2 | 2 |
| Generate retry of a prepared request | 1 | 1 | 2 |
| Manual compaction prepared retry after fixture eligibility revocation | 1 | 1 | 2 |

The harness compares all 42 runtime files across archive, installed package
and source; requires the specific denial and native Session identity; rejects
five corrupt selection-oracle inputs and nine lifecycle-oracle mutations; and revalidates every case against the complete
trace after both host processes stop. The local run identifies working-tree
bytes by hashes and records `source_dirty: true`; its base `source_head` is
not a claim of final-commit qualification. The existing installed routing
control separately passes enabled-denied (zero sends) and disabled-native
(one successful send). CI reruns both controls and the new mechanics suite
on each PR in the existing installed-routing workflow.

### Additional native lifecycle evidence

Eight scenarios extend the original 19-case suite. Their final validators require
the native branch-specific observations below, rather than inferring coverage
from the presence of a request hook.

| Scenario | Installed observation and precise scope |
| --- | --- |
| Preferred title selection | Native `selectTitle()` resolves the primary and configured preferred candidates; one preferred title request is validated and sent |
| Title fallback after preferred provider failure | Both candidates are resolved, the actual preferred provider call fails, and native title generation separately prepares, validates and sends the fallback |
| Title fallback after preferred resolution rejection | The second speculative resolution is rejected before transport; native title selection sends the first resolved choice through one validation |
| Automatic compaction reuse | A scripted provider reports 180,000 input tokens against the 200,000-token fixture window; the next ordinary prompt causes native `reason: auto` compaction, with zero compaction resolver callbacks and one validation/send |
| Prepared compaction retry after transport-side revocation | The advanced `sol/high` request is sent twice after one validation; the fixture revokes eligibility while reporting the first provider failure |
| Prepared compaction retry after retry-hook revocation | The native retry hook revokes fixture eligibility between attempts. The already prepared request is still sent a second time without another resolution or validation. A subsequent fresh generate request is denied by the same revoked source |
| Pre-dispatch cancellation | The fixture holds the candidate's awaited policy source, the harness calls the real Session interrupt API and observes the native interruption, then releases the source. The complete stopped-host trace contains zero request approvals, provider sends or tool effects |
| Cancellation release control | Releasing the same held source without native interruption produces one validated provider request, establishing that the interrupted case reached executable work |

The title tests use **explicitly staged fixture policies**: the first speculative
resolution selects `fast/medium`, the native configured preferred input is `limited/medium`, which the preferred fixture policy maps to `sol/high`,
and a preferred provider failure moves the fixture policy back to the fallback.
The stages use the named scenario and resolution count, never the mutable model
reference. This keeps the native candidates distinguishable; it does not prove
authenticated policy revisions, quota reservation or production authorization.
Native Session selection remains unchanged throughout.

The compaction retry result is an **observed host enforcement gap**, not a
successful per-send guard. The fresh denial is checked against the actual
native error and Session URL, as well as zero fresh provider sends. This
extends the prepared-generate counterexample and keeps #205/#206 blocked.

Cancellation coverage is limited to the controlled **pre-dispatch policy-read
boundary**. In-flight stream cancellation, billing settlement, installed plugin
disposal and fresh-child dispatch remain unqualified. Callback disposal and
failed hook registration retain their separate mocked tests. Native Session
reads do not authenticate fixture workload assessments or turn synthetic
inventory into billing proof. Production activation and all real-provider
acceptance remain blocked.

Run the qualification against a separately packed and installed candidate:

```sh
python3 tests/installed_request_local_routing.py \
  --opencode /path/to/host/node_modules/.bin/opencode \
  --repository "$PWD" --plugin /path/to/install/node_modules/loom-plugin \
  --artifact /path/to/loom-plugin-2.0.0-alpha.1.tgz \
  --expect-plugin-version 2.0.0-alpha.1 \
  --report-directory /path/to/qualification-report
```

The workflow artifact retains `request-local-report.json` and the sanitized
`request-local-events.ndjson` trace, alongside the existing routing controls.

## Ownership and current implementation

| Capability | Location / owner | State |
| --- | --- | --- |
| Ordered model classes, model aliases, per-agent reasoning and paid-fallback default | Loom `src/model-routing.ts`, `src/model-routing-runtime.ts`, configuration | **Implemented (pure policy)** |
| Shared cross-process quota, conservative reservations and failure fencing | Loom `src/quota-state.ts`, `src/model-routing-shared-quota.ts` | **Implemented (state only)**; no certified live account outcomes |
| Exact agent native model/variant transform, initial-route mismatch guard | Loom historical `registerModelRoutingCandidate()` | **Internal test candidate, inactive** |
| Same-provider request-local model/variant replacement and exact request guard | Loom `src/request-local-model-routing.ts`, isolated fixture only | **27 installed mechanics cases PASS**, including an observed prepared-retry enforcement gap; no production caller |
| Host-unqualified native pre-transport denial and disabled routing compatibility | Loom `src/plugin.ts` / `registerModelRouting()`, current installed 2.3.0 checks | **Implemented for a loaded, versioned host** |
| Server entrypoint guard before optional skill/review transforms | Loom `server.ts`, `tests/server-startup-native.test.ts` | **Merged**; historical 2.2.6 guard/replay evidence retained, suite carried forward to 2.3.0 |
| Exact effective **provider billing principal** bound to native credential generation and send attempt | OpenCode + native provider integration | **Missing supported API** |
| Provider-enforced **included-only/no-paid** dispatch guarantee and current model entitlement, bound to that same native attempt | Billing provider + OpenCode | **Missing supported guarantee for all candidate routes** |
| Unique native attempt identity and final stream/failure/cancel outcome joined to request kind and effective account | OpenCode | **Missing supported API** |
| An approved exact version + provider/account route that passes installed **positive** native dispatch/variant/identity/billing acceptance | Joint qualification | **None** |

Review [#204's provider-specific billing matrix](subscription-billing-qualification.md)
and [#205's identity counterexamples and smallest proposed interfaces](../history/native-request-identity.md).
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

The current 2.3.0 installed unqualified-routing guard and
`tests/installed_optional_replay.py` are the current negative acceptance.
The 2.2.0 results (`tests/routing-host/ACCEPTANCE.md`) are historical. The server-startup unit test is a native
registration **mock** and must be labeled separately from installed-host
proof. No personal OpenCode configuration should be read or modified.

## Decision and next actionable change

**No production routing activation.** The internal request-local candidate has
bounded selection/lifecycle mechanics evidence on the exact 2.3.0 host.
It does not require #242's assignment-wide work-epoch receipt, because it
does not switch a persisted Session or assert a new protected work epoch.
For live activation, separately agree and demonstrate the host/provider
contract above (or a supported equivalent), then validate its provider-enforced
non-paid path with an authorized disposable account. Only accepted native
identity, authorization and billing evidence can justify a production
allowlist. Do not close #206 for mechanics, documentation or negative guards.

## Depends on

- [Billing proof / provider matrix](subscription-billing-qualification.md)
- [Native identity / per-attempt requirements](../history/native-request-identity.md)
- [Initial route implementation and guard](../design/ard-013-model-routing.md)
- Installed host acceptance contract: `tests/routing-host/ACCEPTANCE.md`

## Historical 2.2.6 remediation evidence (2026-11-11)

Focused #226 retains the pre-transport deny guard across optional learning-init
warning failures and core-startup error-sink failures. Both fault-injection
scenarios have registered-host regressions; the packed installed-host replay
suite continues to check guard retention and disabled-native behavior.
The exact revised #226 SHA and CI results are maintained in PR #226 and
[the authoritative integration issue #227](https://github.com/bateau84/loom/issues/227).
No provider-side no-paid guarantee, real model send or effective billing
principal/attempt attestation was acquired by this work.
