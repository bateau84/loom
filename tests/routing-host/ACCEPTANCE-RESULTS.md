# Installed routing and shared quota — acceptance results

## Verdict

**Overall: UNPROVEN.** All automated protection and cross-process state checks
passed, but positive **installed-host** managed model selection with verified
included billing and native stream/account affinity cannot be established
using these local-only test providers. **Live provider switching was neither
implemented nor tested.** Do not merge this draft based on these results alone.

## Exact evidence

- Date: 2026-10-25.
- Test candidate PR: [#197](https://github.com/bateau84/loom/pull/197), head `bdce5ceef18a3f5a393747ec900fdfa5061417f4`.
- Stacked base: [#194](https://github.com/bateau84/loom/pull/194), integration baseline `875a79012bd4338d8ac1b746b5c9ffbb81db1f15`.
- GitHub Actions checked-out PR merge commit: `83864e9aa385e89cf9c23be81d20a23e2d5547a6` (recorded in the generated JSON report). This is distinct from the PR head.
- Packed plugin: `loom-plugin@2.0.0-alpha.1`, archive SHA-256 `201067766fdd1edc6ad367de954eeff01d4f7c8a9a7f2bf74aabb4e905a39f5c`.
- Native host: unmodified `@opencode/cli@2.1.4` (`opencode v2.1.4` observed).
- Plugin SDK: `@opencode/plugin@2.1.1`. **Matched SDK 2.1.4 qualification UNPROVEN.**
- [Installed acceptance CI — PASS](https://github.com/bateau84/loom/actions/runs/40185596323). [JSON report and isolated logs (CI artifact)](https://github.com/bateau84/loom/actions/runs/40185596323/artifacts/12596201995).
- [Loom plugin regression CI — PASS](https://github.com/bateau84/loom/actions/runs/40185596426).
- [Existing installed-host negative control — PASS](https://github.com/bateau84/loom/actions/runs/40185596391).

The new installed workflow exercised 199 Bun native tests (0 failed),
35 Python tests, typecheck and core tests. Its installed-host runner completed
**18/18 PASS** cases. The separate shared-quota process controls were **PASS**,
as were four synthetic oracle mutation controls. The acceptance script exits
nonzero on any failure; its successful execution is not a declaration that
all capabilities are proven.

## Observed local routes

| Observed native transport | Context | Result |
| --- | --- | --- |
| `route-primary/sol` | Routing disabled; Architect, Coder and Reviewer; normal tool continuation, compaction and scripted errors | PASS |
| `route-secondary/sol` | Routing disabled; explicitly selected secondary and restart | PASS |
| `route-metered/sol` | Routing disabled; establishes that the paid-labelled local fixture is callable | PASS |
| **No transport** | Routing enabled; unknown billing for three agents, paid-labelled explicit Session model, unsupported high reasoning and restart | PASS for fail-closed local controls |
| **No transport** | Routing enabled; unexpected native global default `route-metered/sol` | PASS for fail-closed local control |

Actual native `execute.before` and `execute.after` both counted **once**
during a normal tool continuation, compaction after a tool, and a post-tool
scripted provider error in **routing-disabled native execution**. The trace
oracle rejected intentional fake paid leakage, duplicate execution,
unexpected provider selection and cross-provider tool continuation.
These are not tests of a live provider switch.

## Independent-process shared quota

**PASS** for real SQLite WAL operations from different Bun OS processes
using the integrated quota manager. Verified test assertions:

- Process B observes process A's synthetic exhaustion.
- A second account on the same provider and a different provider remain available.
- Only one process wins an expired recovery probe.
- A completed *test-simulated* owned probe clears the block and another process sees recovery.
- State directory mode 0700 and SQLite database mode 0600.

The installed **routing-enabled** host also initialized its private shared
quota database. This does not prove that it selected or dispatched a native
model with an eligible subscription: the fixture has no independent native
billing attestation. The test worker's synthetic provider evidence is never
used as real subscription authorization.

## Twelve acceptance requirements

| # | Verdict | Boundary |
| --- | --- | --- |
| 1 — Role model selection | UNPROVEN | Positive native managed transport lacks verified included billing |
| 2 — Reasoning applied | UNPROVEN | High unsupported denies locally; positive native variant not observed |
| 3 — Model-first/provider-second | UNPROVEN | Mocked adapter tests pass; no installed positive alternate request |
| 4 — Exhausted routes excluded at startup | UNPROVEN | Shared state and mocked tests pass; native included dispatch absent |
| 5 — Newly exhausted committed route denied | UNPROVEN | Mocked pre-dispatch test pass; no real eligible committed route |
| 6 — Second process sees block/recovery | UNPROVEN end-to-end | Shared-store cross-process checks PASS; native use not proven |
| 7 — Provider account independence | UNPROVEN end-to-end | State-level isolation PASS; native account swapping not proven |
| 8 — Unknown/metered billing guard | PASS local control | No transport on unknown and paid-labelled routes; genuine verified-metered acceptance UNPROVEN |
| 9 — Unexpected global default | PASS local control | Paid-labelled global default blocked before fixture transport |
| 10 — Native active execution affinity | UNPROVEN | Mocked guard tests pass; upstream stream/account lease missing |
| 11 — No duplicate tool on interruption | UNPROVEN end-to-end | Native disabled-path one-tool control PASS; managed interruption unproven |
| 12 — Routing disabled unchanged | PASS | Observed native primary, secondary, tool, compaction, errors and restart |

## Remaining limitations

Real OpenCode Go quota and no-paid eligibility data are **UNPROVEN**.
No real provider connections, personal credentials or paid API requests
were used. The host's pre-request account comparison is **not** a native
atomic stream/credential lease. Provider failures may be recorded as shared
exhaustion but cannot trigger a supported safe in-flight replacement. A new
activation may replan based on verified data; this is not live retry.

This document describes the **exact successful 2026-10-25 CI run above**.
Later source commits require their own CI evidence. See
[README.md](README.md) for clean-room reproduction commands and the
generated `report.json` for per-case evidence, checksums and limitations.
