# Installed model-routing acceptance: OpenCode V2.1.4

This is an **installed-host test**, not a replacement router. The harness packs
the exact Loom plugin candidate, installs it in an isolated directory, runs an
**unmodified** OpenCode 2.1.4 host in an isolated HOME/XDG environment, and
loads only in-memory scripted model providers. It never connects to live AI
providers, reads a user's OpenCode credentials or uses their global config.

This branch is stacked on PR #191 and indirectly on PR #190. The separate
machine-wide quota manager is PR #192, **not assembled into this branch**.

## Reproduce on Linux or a GitHub Actions runner

Requirements: Node.js 22, Bun matching `.bun-version`, Python 3.11+,
Git and npm. Start from a disposable checkout of this PR branch:

```bash
set -euo pipefail
git checkout test/model-routing-installed-acceptance-v214
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
npm install --prefix "$RUN/host" --no-audit --no-fund @opencode/cli@2.1.4

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
logs as CI artifacts. The fixture's `routing-events.ndjson` is temporary and
keeps **only request route IDs, test mode and native tool names**. It does not
record raw prompts, headers, account identities, tokens or tool inputs.

## What the installed-host gate verifies

| Control | Observed evidence | Expected result |
| --- | --- | --- |
| Native primary/secondary transport (routing disabled) | V2 provider `doStream` calls | One request to the exact selected provider and model |
| Native metered transport (routing disabled) | Paid-labelled local provider request | The scripted provider is genuinely callable without the guard |
| Real tool continuation (routing disabled) | Native `execute.before/after` and two provider requests | Exactly one successful tool execution; native continuation stays on the same provider |
| Unknown billing (routing enabled) | No local provider `doStream` invocation | Session fails before transport or tools |
| Metered route (paid fallback disabled) | No local paid-labelled provider `doStream` invocation | Session fails; the previously proven local route is never reached |
| Unsupported requested `high` | Only `medium` advertised in fixture | No transport; does not alone prove the reason for denial |
| Restart and disabled compatibility | Fresh real OpenCode processes | Guard continues to deny, disabled mode continues to run |
| Trace oracle mutations | Synthetic corrupted trace inputs | Leak, duplicate tool calls and provider changes are rejected by the oracle |

The negative controls are deliberately independent of the production
`planModelRoutes` implementation. The **synthetic mutations prove only that
the oracle detects those counterexamples**, not that OpenCode executed them.

The full suite's `protection_controls` may report `PASS`, while the
**overall `status` must remain `UNPROVEN`** until all requirements have
genuine installed evidence.

## Acceptance matrix

| Requirement | Current installed scope |
| --- | --- |
| 1. Preferred verified included route | UNPROVEN: local fixtures cannot supply native subscription billing attestation |
| 2. Same model, next provider | UNPROVEN: V2.1.4 has no safe live model replacement |
| 3. Next model when all providers exhausted | UNPROVEN: no live retry/replan |
| 4. No eligible route | Protected negative observed; error clarity beyond failed Session requires dedicated check |
| 5. Do not use metered/unknown billing | Installed-host fail-closed guard checked with a working disabled positive control |
| 6. Clean pre-output fallback | UNPROVEN: a scripted pre-output error alone is not fallback |
| 7. Tool side effects never replayed | Normal native continuation counted; **failover after tool** UNPROVEN |
| 8. Streaming and account affinity | Route preserved through local normal continuation; **native account lease** UNPROVEN |
| 9. Exact reasoning | Unsupported local `high` blocks; selection under verified included routes UNPROVEN |
| 10. Independent processes share quotas | PR #192 has separate tests; **assembled-host integration** UNPROVEN |
| 11. Routing disabled | Native real-host compatibility checked |
| 12. Restart, cancellation, compaction, provider errors | Restart checked; live failover state after other operations UNPROVEN |

A test cannot become PASS merely because a fixture skipped an unavailable
product interface. When the adapter and quota source are assembled, add
positive native attestations using their **existing product interface**; do
not put another router, fake credential adapter or quota cache in this fixture.

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
were supplied or used, no API spending was authorized, and OpenCode 2.1.4
does not currently provide a proven safe automatic live-fallback seam.
