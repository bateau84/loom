# Installed model-routing acceptance: OpenCode V2.2.0

This is an **installed-host test**, not a replacement router. The harness packs
the exact Loom plugin candidate, installs it in an isolated directory, runs an
**unmodified** OpenCode 2.2.0 host in an isolated HOME/XDG environment, and
loads only in-memory scripted model providers. It never connects to live AI
providers, reads a user's OpenCode credentials or uses their global config.

The complete initial-routing, shared-quota and acceptance implementation is
now consolidated in [draft PR #190](https://github.com/bateau84/loom/pull/190).
This test packs that assembled candidate; the previous stacked drafts are
historical context, not separate test targets. OpenCode 2.2.0 managed routing
has **not** yet been qualified: enabled routing must fail at the early
`LOOM_MODEL_ROUTING_HOST_UNQUALIFIED` guard; the disabled/native path is
still exercised. The previous 2.1.4 routing acceptance is historical
evidence, not proof of positive 2.2.0 model selection or live fallback.

## Reproduce on Linux or a GitHub Actions runner

Requirements: Node.js 22, Bun matching `.bun-version`, Python 3.11+,
Git and npm. Start from a disposable checkout of this PR branch:

```bash
set -euo pipefail
git checkout feat/provider-first-model-routing
bun install --frozen-lockfile
bun run typecheck
bun run test:core
bun run test:native
bun run test:python
python3 tests/routing_acceptance_oracle.py

REPO="$(pwd -P)"
RUN="$(mktemp -d)"
trap 'rm -rf "$RUN"' EXIT
mkdir -p "$RUN/pack"
npm pack --json --pack-destination "$RUN/pack" > "$RUN/pack/pack.json"
ARCHIVE="$(find "$RUN/pack" -maxdepth 1 -name 'loom-plugin-*.tgz' -print -quit)"
test -n "$ARCHIVE"
npm install --prefix "$RUN/plugin" --no-audit --no-fund "$ARCHIVE"
npm install --prefix "$RUN/host" --no-audit --no-fund @opencode/cli@2.2.0

python3 tests/installed_routing_acceptance.py \
  --opencode "$RUN/host/node_modules/.bin/opencode" \
  --plugin "$RUN/plugin/node_modules/loom-plugin" \
  --artifact "$ARCHIVE" \
  --expect-plugin-version "$(node -p 'require("./package.json").version')" \
  --report-directory "$RUN/report" \
  --repository "$REPO"
cat "$RUN/report/report.json"
```

Use `.github/workflows/installed-model-routing-acceptance-v214.yml` for
automated runs. The workflow uploads `report.json` and private-host process
logs **and separate per-case sanitized event traces** as CI artifacts.
The original fixture's `routing-events.ndjson` is temporary; reported traces
include allowlisted request route/model IDs, test mode, native tool names and
a pseudonymous local Session label. Neither stores raw prompts, headers,
account credentials, tokens or tool inputs. Guarded failures must match
their expected `LOOM_MODEL_ROUTING_HOST_UNQUALIFIED` (or
`LOOM_MODEL_ROUTING_STARTUP_FAILED` for a broken Action ledger)
category, not merely zero transport.

## What the installed-host gate verifies

| Control | Observed evidence | Expected result |
| --- | --- | --- |
| Native Architect, Coder and Reviewer (routing disabled) | V2 provider `doStream` calls | One request to the exact selected provider and model |
| Native metered transport (routing disabled) | Paid-labelled local provider request | The scripted provider is genuinely callable without the guard |
| Injected provider faults (routing disabled) | Native transport traces before-output, after-text, and after-tool | No unexpected second provider or repeated native tool (not a live-fallback test) |
| Real tool continuation (routing disabled) | Native `execute.before/after` and two provider requests | Exactly one successful tool execution; native continuation stays on the exact provider/model |
| Unknown billing (routing enabled) | No local provider `doStream` invocation | Session fails before transport or tools |
| Metered route (paid fallback disabled) | No local paid-labelled provider `doStream` invocation | Session fails; the previously proven local route is never reached |
| Unsupported requested `high` | Only `medium` advertised in fixture | No transport; does not alone prove the reason for denial |
| Native compaction after a completed tool | Compaction model request, native tool hook counts and selected provider | One native tool; compaction completes on same model/provider |\n| Restart and disabled compatibility | Fresh real OpenCode processes | Guard continues to deny, disabled mode continues to run |
| Unqualified 2.2.0 host routing | Real isolated host, enabled Loom policy | No native provider transport or new quota database; native routing-disabled requests still run |
| Independent quota processes | Separate Bun child processes using PR #194 SQLite manager | Cross-process block, account/provider isolation, single recovery probe and observable recovery |
| Unexpected native global default | Host configured with a paid-labelled default in a managed Session | No transport; without an eligible primary route the exact mismatch reason remains UNPROVEN |
| Invalid routing configuration | Host startup with malformed `.loom.yaml` | Native request rejected with `LOOM_MODEL_ROUTING_CONFIG_UNREADABLE` before any provider transport |
| Corrupt quota DB and broken Action-ledger startup | Separate fresh installed 2.1.4 hosts, routing enabled and a callable metered global default | Native request rejected by retained early `LOOM_MODEL_ROUTING_STARTUP_FAILED` guard, zero provider transport |
| Trace oracle mutations | Synthetic corrupted trace inputs | Leak, duplicate tool calls, provider changes and model-only changes are rejected by the oracle |

The negative controls are deliberately independent of the production
`planModelRoutes` implementation. The **synthetic mutations prove only that
the oracle detects those counterexamples**, not that OpenCode executed them.

The full suite's `protection_controls` may report `PASS`, while the
**overall `status` must remain `UNPROVEN`** until all requirements have
genuine installed evidence.

## Acceptance matrix for the integrated candidate

The JSON report records **PASS**, **FAIL** or **UNPROVEN** for each of
the 12 acceptance requirements. The suite fails immediately on a broken
protection control. Passing a mocked or synthetic test does not promote
an installed-host requirement to PASS.

| # | Requirement | Installed-host verdict |
| --- | --- | --- |
| 1 | Role-based chosen model | UNPROVEN: no trusted local included billing |
| 2 | Native requested reasoning | UNPROVEN positive; unsupported high is safely denied |
| 3 | Same model then next provider | UNPROVEN native; mocked runtime checks it |
| 4 | Exclude exhausted at fresh selection | UNPROVEN native; mocked + shared state checks |
| 5 | Reject newly exhausted committed route | UNPROVEN native; mocked pre-dispatch check |
| 6 | Cross-process block and recovery | PASS separate SQLite child-process test; UNPROVEN native request integration |
| 7 | Separate provider accounts | PASS separate SQLite child-process test; UNPROVEN native account switch |
| 8 | Unknown and metered protection | UNPROVEN policy-specific on 2.2.0; host-unqualified guard blocks all managed requests |
| 9 | Unexpected global default rejected | UNPROVEN mismatch-specific guard; 2.2.0 host-unqualified blocking prevents transport |
| 10 | No silent active account/model change | UNPROVEN native stream lease; mocked guard checks |
| 11 | No tool replay on error/interrupt | PASS local disabled-native negative; UNPROVEN managed interruption |
| 12 | Routing disabled retains native behavior | PASS installed native host |

Quota checks use separate actual Bun OS processes and one real shared SQLite WAL
database. They are **state-level tests**, not proof that a native OpenCode
stream switched accounts or routed to an included subscription.
The reported `UNPROVEN` items are blockers to complete acceptance.

## Opt-in real-provider acceptance (not run)

Once a future OpenCode host exposes safe model replacement and a native route
lease, verify the following *only with explicit user consent* and two permitted,
genuinely working connections:

1. Verify both connections' terms of use and native eligibility. Do not assume
   an OpenAI consumer subscription or an OpenCode Go entitlement authorizes
   third-party account reuse.
2. Create **disposable** native host data/config under a new temporary HOME.
   Connect accounts through native OpenCode-supported login, not test-owned
   copies of credentials or private file scraping.
3. With known verified included billing, observe preferred route, then
   genuine quota exhaustion and the **same-model next-provider request**.
   Capture a second run that excludes every included provider for that model
   before advancing to another model.
4. Inject pre-output and post-tool failures at the host-supported boundary.
   Count transport attempts and actual tool side effects. Abort immediately
   on an unexpected metered route; never use paid requests for a negative
   control without explicit authorization.
5. Restart and run separate processes under the same isolated user-state
   directory to prove quota block/recovery. Exercise streaming, account lease,
   cancellation, compaction and native provider errors.
6. Report exact CLI/SDK/plugin/source versions, sanitized route identities,
   quota evidence, tool execution counts and separate **local vs real**
   outcomes. Do not publish credentials, login secrets or raw request bodies.

**Current real-provider verdict: UNPROVEN.** No live account connections
were supplied or used, no API spending was authorized, and OpenCode 2.2.0
does not currently provide a proven safe automatic live-fallback seam.
