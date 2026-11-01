---
type: Playbook
title: Tests, scripts and CI
description: Maintained inventory of test profiles, supporting files, commands, side effects, and CI membership.
tags: [testing, ci, test-inventory]
timestamp: 2026-10-19T00:00:00Z
---

# Tests, scripts and CI

Run commands from the repository root. This is the maintained inventory of every
tracked path under `tests/`, `tools/` and `.github/workflows/`, plus the seven
runner/example supports below: **75 + 7 = 82 paths**. There are 43 test entry files
(18 Node, 22 Bun, 3 Python); file counts are not case counts. Update this guide
when adding, removing or renaming an entrypoint or support input.

## Environment and commands

Install with `bun install --frozen-lockfile`. `.bun-version` pins **Bun 1.4.2**;
the supported package range is `>=1.4.2 <2.0.0`. CI uses **Node 22**; Node
**22.16+** is required for core SQLite tests. Python 3 and Git are also needed as
noted below. The upgrade-candidate source SDK is `@opencode/plugin@2.1.1`, YAML dependency
`js-yaml@4.3.2`, compiler `typescript@7.0.2`. Search uses separately provisioned
Code Mode **2.0.29**; it does not establish host compatibility. The candidate
installed-host boot uses SDK/CLI **2.1.1/2.1.1**; earlier 2.0.32 qualification
is historical evidence, not approval for the new target.
A historical 2.0.29 compatibility boot is not maintained or supported. Do not
install host test tools into the plugin dependency tree or modify its lockfile.
Boot evidence does not establish model-driven acceptance.

Each per-file row inherits its profile's **exact invocation template, prerequisites,
outputs, side effects and CI membership**. Substitute the row's full path for
`PATH`, or its basename for `BASENAME`. No test is run by ordinary Loom startup.
Component doubles are not installed-host evidence; no suite requires paid inference.

| Profile | Direct command and prerequisites | Outputs / side effects / membership |
|---|---|---|
| C | `./node_modules/.bin/tsc -p tsconfig.core.json`, then `node --test PATH`; locked dependencies, Node SQLite | Compiler writes ignored `.test-build/`; Node report/status. Synthetic memory/temp SQLite/config/files, subprocesses/workers where noted. All root `tests/*.test.mjs` in `bun run test:core`, main CI. No host/model. |
| N | `bun test PATH`; locked dependencies and Bun | Bun report/status; real Bun/SQLite/plugin registration with simulated host. Disposable state/config; fixtures restore environment. Startup cases also write disposable `.test-build/startup-*`. `bun run test:native` discovers root `*native.test.ts` plus explicit package-entry, backup, baseline, question-host and retrospective-source globs; main CI. No installed host/model. |
| P | `python3 -m unittest discover -s tests -p 'BASENAME'`; stdlib Python, Git for export | unittest report/status; temp files/SQLite, mocks/failure subprocesses, ignored bytecode caches. `bun run test:python` discovers `test_*.py`; main CI. No installed qualification. |
| S | `LOOM_CODEMODE_ROOT=/ABS/PREFIX bun test tests/tool-search-codemode.test.ts`; first `npm install --prefix /ABS/PREFIX --ignore-scripts --no-audit --no-fund @opencode/codemode@2.0.29` | Verifies exact package and imports real search/effect. Registration/temp state and report/status, no model/CLI. npm writes only external prefix. Separate main CI step, excluded from native aggregate. |
| H | `python3 tests/installed_host_smoke.py --opencode /ABS/CLI --expect-version 2.1.1 --plugin /ABS/PLUGIN_PREFIX/node_modules/loom-plugin --artifact /ABS/loom-plugin.tgz --expect-plugin-version 2.0.0-alpha.1 --expect-sdk-version 2.1.1 --report-directory /ABS/OUTPUT`; Python, Bun/Node, candidate npm artifact, canonical SDK 2.1.1 and separate CLI 2.1.1 | Starts owned loopback/stdio hosts in private temp config/state, loading the installed artifact rather than checkout. Verifies artifact metadata/hash and SDK pin/version. Boot/restart/removal/roster/empty-ledger checks, no model. Retains version stdout, HTTP JSON, artifact identity and `report.json`; removes temp host state. Installed-host workflow only, or explicit manual invocation. |
| Q | `python3 tests/installed_questions.py --opencode /ABS/CLI --plugin /ABS/PLUGIN_PREFIX/node_modules/loom-plugin --artifact /ABS/loom-plugin-candidate.tgz --expect-plugin-version 2.0.0-alpha.1 --expect-sdk-version 2.1.1 --repository /ABS/REPO --report-directory /ABS/NEW_OUTPUT --duplicate-input-control`; Python, Bun/Node, packed candidate, isolated SDK/CLI 2.1.1 | Private-host question-path qualification with scripted local-model traffic, not paid/live-provider or external-MCP evidence. Exact candidate SHA-256 `ef7dad9a30ade952cd055fe5c637ff19d1b7b75ef8da590cde07fad58e7efd15`, SDK/CLI 2.0.32/2.0.32: T2 and independent reviewer rerun passed E1-E3, restart, and duplicate-input control. T2 report: `/tmp/opencode/t2-installed-questions-e3c6d3e/rerun-report/report.json` (audit alongside); reviewer report: `/tmp/opencode/reviewer-182-rerun/report.json`. These report paths are temporary and not committed. The historical 2.0.32 evidence is not a 2.1.1 pass; the new harness includes E4 native session/archive, E5 compaction/evidence and E6 trace/native-child export and text-redaction-sentinel checks. E6 runs real plugin/host operations with a scripted local model; successful registration alone is not trace proof. The selective session-read case is N/A (`executed:false`), not a pass; see [installed-host validation](installed-host-validation.md) for its source-qualified rationale and limits. |

| QB | `python3 tests/retrospective_qab.py --opencode /ABS/CLI --plugin /ABS/PLUGIN --artifact /ABS/CANDIDATE.tgz --skills-repo /ABS/SKILLS --model PROVIDER/MODEL_ID --auth /ABS/PRIVATE/auth.json --report-directory /ABS/NEW_OUTPUT`; exact OpenCode 2.2.0, explicit real model, merged skill commit | **Opt-in real-model deep retrospective acceptance.** Disposable parent/worker/reviewer native Sessions, registered Loom trace evidence, target agent's independent source retrieval, five adversarial controls and private evidence bundle. No question-fixture, automatic provider fallback, ordinary PR CI or implied PASS. See [QA-B runbook](retrospective-qa-b.md); provider-free oracle tests and passive-audit typecheck run in main CI. |

`bun run test` runs **C then N only**, not P/S/H/Q or utilities. `bun run typecheck`
runs `tsc --noEmit`. For H, optional `--repository /ABS/REPO` chooses the source;
H/Q `--disable-filewatcher` affects owned hosts only and disclaims watcher proof.
Neither harness installs its CLI. Provision externally, for example
`npm install --prefix /ABS/HOST --no-audit --no-fund @opencode/cli@2.0.32`, then use
`/ABS/HOST/node_modules/.bin/opencode`. The package's `test:installed-questions`
alias invokes Python; the direct Q command above is authoritative (check local
runner argument forwarding before using the alias).

Use private `TMPDIR` and disposable output locations. Never point harnesses,
generators or measurement experiments at live/original/sealed databases or normal
host configuration. Backup tests exercise the [stopped-writer manual procedure](manual-backup-restore.md),
not permission to experiment against production state. Ignored `node_modules/`,
`.test-build/`, `__pycache__/`, private logs/reports and backups are outputs, not
additional maintained tests. Do not publish private host reports without inspection.

## Node tests (C)

| Exact path | Purpose and coverage boundary |
|---|---|
| tests/collaboration.test.mjs | Work references, replan/reconfirmation, dependencies, questions/answers/reopen and database reopen. |
| tests/config-admission.test.mjs | Bounded config FIFO, cancellation, cleanup, overflow and reload identity/listeners. |
| tests/config-parser.test.mjs | Decoder construction budgets, exact depth/text/work boundaries, shared aliases/identity, syntax/schema diagnostics, ordinary capacity and fail-closed corrected reload. Includes all five former boundary-file cases. |
| tests/config-source.test.mjs | Byte limits, short/growing/truncated reads, timestamps, UTF-8, symlinks/nonregular files and cleanup; includes subprocesses. |
| tests/context-relevance.test.mjs | Qualified task/dependency/action conclusions and review disagreements under rendering budgets. |
| tests/core.test.mjs | Config/roles/instructions, validation, Store/ledger/scoping, context and observer contracts. |
| tests/full-history.test.mjs | History membership, Unicode, scoped/versioned cursors, partial continuation, hydration bounds/corruption. |
| tests/observer-capture-toggle.test.mjs | Capture-disabled start cannot borrow later identical captured start. |
| tests/observer-reliability.test.mjs | Conservative attribution under overlap/identical keys, capture/finish failures, restart and duplicates. |
| tests/processing-limits.test.mjs | Serialization/hash/plan/record budgets, complete evidence bytes, rollback and bounded rendering. |
| tests/questions.test.mjs | Blocking firstness, legacy/nonblocking answers, append/COMMIT rollback, associations and real concurrent SQLite workers. |
| tests/read-consistency.test.mjs | Selection/context snapshots with concurrent changes, failed writes/commits, capture pairing and paging. |
| tests/reload-capture-review.test.mjs | Reload/generation/symlink identity, capture-off pairing, failed replacement and escaped retrieval/recovery; subprocess/module boundary. |
| tests/retired-protocol.test.mjs | Frozen populated rows survive restart/read/rejection and qualified completion/reopen. Also retains two independent worker connections/startup, barrier-synchronized retired dispatch, empty ledger/absent delivery table assertions. Store initialization is BEFORE the barrier: not synchronized empty-schema initialization proof. |
| tests/retrieval-limits.test.mjs | Metadata-before-hydration limits, snapshots, lookahead/indexes, omitted/oversized bodies and unchanged old records. |
| tests/review-findings.test.mjs | Ancestor contract, failed observation and ctime regressions; filename/titles consumed by mutation utility. |
| tests/selection-recovery.test.mjs | Removed/unknown task notices, explicit recovery, budgets, nonmutation, snapshots/reopen. |
| tests/work-reference-limits.test.mjs | Bounded historical-plan hashing, canonical compatibility, forgery rejection and shared allowance. |

## Bun tests (N unless S)

| Exact path | Purpose and coverage boundary |
|---|---|
| tests/collaboration-native.test.ts | Registered collaboration, attribution/injection, selection bypass, full references and help. |
| tests/config-admission-native.test.ts | Overflow removes stale injection; cancelled/disposed queued calls cannot write. |
| tests/config-parser-native.test.ts | Published example/native YAML versus bounded decoder; no production native fallback. |
| tests/config-source-native.test.ts | Actual Bun file/YAML byte limits, growth, UTF-8 and deep/cyclic inputs; not allocation proof. |
| tests/full-history-native.test.ts | Frozen populated history restart plus independent old/new/unscoped membership oracle. |
| tests/full-thread-native.test.ts | Registered renderer, scopes, continuation/Unicode and independent mixed-history oracle; no native reads/target execution. |
| tests/historical-preservation-native.test.ts | Hash-checks/executes authentic historical writer, exact reopen without consent; populated current startup/reads/rejections/legacy answers contact no native delivery API. |
| tests/manual-backup-restore.test.ts | Published stopped-writer backup/restore, residual WAL, qualified bytes and overwrite/source guards; additionally requires python3 subprocesses and frozen Store. |
| tests/native.test.ts | SDK/plugin/YAML/SQLite, example, reload/capture/recovery, startup/migration; legacy helper and disposable startup directories. |
| tests/package-entry.test.ts | SDK public entry resolution/loading, absent optional TUI/RPC, runtime/SDK/search/boot pins; reads package, Bun pin, CI/boot workflows, search test and smoke script as data. |
| tests/questions-native.test.ts | Registered ask/answer/association/attribution, fail-closed precommit behavior and first blocking-answer eligibility. |
| tests/resume-native.test.ts | Exact-asker one-shot admission, interruption/deadline/uncertainty/malformed acknowledgements; no retry/transfer, simulated host with real persistence. |
| tests/retired-protocol-native.test.ts | Registered schema/tool rejects retired operations/views/fields/kinds without writes. |
| tests/review-findings-native.test.ts | SDK error projection, selection failure/navigation/recovery/context budget; mutation utility consumes filename/titles. |
| tests/session-trace-native.test.ts | Registered read-only source timeline, dispatch/skill projections, direct child paging, export scope/permission and privacy guards; simulated host, not a live installed export. |
| tests/skill-native.test.ts | Bundled guide metadata/registration/disposal, user skill preservation, callback examples and guidance; reads production guide/docs. |
| tests/tool-help-native.test.ts | Search-visible manuals/examples, plan fields/hierarchy/dependencies, recovery and async write guidance. |
| tests/tool-search-codemode.test.ts | **S**: actual external search over real registered help/signatures/examples and independent-call failure behavior. |
| tests/fixtures/baseline-c9ffcfa/candidate-preservation.test.ts | Current Store/context startup/read twice against exact old rows, not old-writer characterization. |
| tests/fixtures/baseline-c9ffcfa/preservation.test.ts | Frozen writer characterization, source/raw hashes, hydrate/copy/restore, corrupt qualification falsification and rollback. Immutable input. |
| tests/question-host/get-rejection.test.ts | Component SDK get rejection AFTER committed answer: independent durability, no admission/input/wake/transfer; also explicitly run by questions workflow. Not installed selective-ACL evidence. |
| tests/retrospective-source/source-model.test.ts | QA-B scripted-source continuation without a repeated phase marker, strict fresh-phase and phase-step bounds; provider-free component evidence, not a full retrospective. |

## Python tests (P)

| Exact path | Purpose and coverage boundary |
|---|---|
| tests/test_export.py | Export losslessness/destination/symlink guards using synthetic Git repositories/commits, not old project objects. |
| tests/test_installed_host_smoke.py | Harness noGit inventory/readiness/location/agent/env/redirect/read-only DB/failure report checks; not installed qualification. |
| tests/test_installed_questions.py | Harness applicability/request/admission/no-contact/running-session/frozen-corruption oracles; package native-glob completeness and retired-file absence, not live qualification. |

## Helpers and installed harness support

These rows are **support/fixture—not standalone** unless H/Q is specified.
They inherit consumer prerequisites/effects and execute transitively in those
consumers' CI profiles; they are not independent CI passes.

| Exact path | Consumer / purpose / effects |
|---|---|
| tests/helpers/legacy-delivery.ts | N native/historical-preservation consumers; synthetic old projection DDL/current-API history and raw snapshots, caller-owned disposable DB writes. Not an authentic old writer. |
| tests/helpers/registered-loom.ts | N retired-protocol/collaboration/questions/full-thread/review/skill/tool-help and S/get-rejection; real server registration with simulated host/temp config/state; restores environment/removes temp paths. |
| tests/installed_host_smoke.py | H entrypoint; PrivateHost/environment/require/inventory helpers imported by Q and both harness unit suites. |
| tests/installed_questions.py | Q entrypoint and oracle support imported by test_installed_questions.py; only external model substituted. |
| tests/question-host/coverage.json | Historical disposition/applicability observations read by test_installed_questions.py. Old observed counts/gaps are not current run results. |
| tests/question-host/server.ts | Q installs external plugin with exact SDK/private LOOM_QUESTION_FIXTURE; local scripted model/passive audit reads/writes private audit.ndjson/jobs.json. Owned-host disposal. Separately typechecked in main CI; N get-rejection does not start it. |
| tests/question-host/provider.mjs | Q server registers aisdk file URL; fails closed without native local provider hook, no network fallback; harness hashes source. |

## Historical inputs and generator

Preserve **every byte** in both frozen fixture directories, including README,
test, generator, config, producer and data/provenance files. These are synthetic
same-repository inputs, not captured user state. Tests execute authentic old
writers without Git-history dependencies; optional README Git provenance audits
are maintainer-only. Never regenerate expected old rows with current code.
All support rows below are **support/fixture—not standalone**, with disposable
consumer-owned DB mutations only, unless an explicit command is given.

| Exact path | Purpose / consumer / command status |
|---|---|
| tests/fixtures/baseline-c9ffcfa/README.md | Immutable provenance/scenario/command documentation for baseline consumers; no execution/CI of its own. |
| tests/fixtures/baseline-c9ffcfa/generate.ts | `bun tests/fixtures/baseline-c9ffcfa/generate.ts /ABS/NEW_DIRECTORY`; locked Bun, no Git/host/network. New-only 0700 directory; snapshot/ids/manifest at 0600, variable IDs/times, JSON stdout. Main CI and manual; never overwrite accepted inputs. |
| tests/fixtures/baseline-c9ffcfa/oracle.ts | Frozen snapshot/hydrate/populate/SHA helper using old Store/workReference; generator, both baseline tests, historical-preservation/full-history/full-thread native consumers. Snapshot reads, hydrate/populate mutate disposable DB. |
| tests/fixtures/baseline-c9ffcfa/ids.json | Frozen outputs/associations; baseline tests, retired-protocol Node, historical-preservation native and Q. |
| tests/fixtures/baseline-c9ffcfa/manifest.json | Source/blob/SHA/schema/raw-row provenance; frozen preservation test and Q restore/verification. |
| tests/fixtures/baseline-c9ffcfa/snapshot.json | Exact schema/rows/text including retired projections; baseline tests, retired-protocol Node, full-history/historical-preservation native, Q and Python corruption oracle. |
| tests/fixtures/baseline-c9ffcfa/producer/collaboration.ts | Old contract/API writer imported by frozen Store/oracle. N/generator/backup closure, disposable DB only. |
| tests/fixtures/baseline-c9ffcfa/producer/context.ts | Old context qualification imported by preservation test; frozen model/Store closure. |
| tests/fixtures/baseline-c9ffcfa/producer/model.ts | Old types/canonical/work identity imported by frozen modules. |
| tests/fixtures/baseline-c9ffcfa/producer/primary-sender.ts | Old delivery-state persistence used by Store/populate; its native PrimarySender is not instantiated by generation. Not a current capability. |
| tests/fixtures/baseline-c9ffcfa/producer/store.ts | Old writer used by oracle, preservation and backup tests on disposable DBs. |
| tests/fixtures/baseline-c9ffcfa/tsconfig.json | `./node_modules/.bin/tsc -p tests/fixtures/baseline-c9ffcfa/tsconfig.json`; locked compiler, noEmit inherited root; manual/non-CI explicit command, separate from N execution. |
| tests/fixtures/historical-3f08da9/README.md | Frozen provenance documentation; historical consumer filename resolved by map below, not rewritten. No standalone/CI invocation. |
| tests/fixtures/historical-3f08da9/provenance.json | Exact source/blob/SHA list verified by historical-preservation-native before old imports. |
| tests/fixtures/historical-3f08da9/collaboration.ts | Older pre-delivery API imported by old Store and historical-preservation-native workReference. |
| tests/fixtures/historical-3f08da9/model.ts | Older model primitives imported by old writer closure. |
| tests/fixtures/historical-3f08da9/store.ts | Hash-checked authentic old writer dynamically imported by historical-preservation-native before current Store; N CI, disposable DB. |

## Utilities

All commands run at repository root with locked dependencies as applicable.
Measurements use synthetic **in-memory** databases, never user DB arguments.

| Exact path | Direct command / prerequisites | Output, side effects and membership |
|---|---|---|
| tools/check-review-regressions.py | `python3 tools/check-review-regressions.py --report-directory /ABS/OUTPUT`; Python, Node/Bun, locked tsc/deps | Copies source/tests/examples/tools/configs into temporary workspaces, symlinks existing node_modules. Baseline/three mutants/two reverse controls; per-case compile/test logs and report.json even on failure. Mutates copies only. Main CI; not exhaustive mutation score/independent review. |
| tools/export_legacy_config.py | `python3 tools/export_legacy_config.py /ABS/NEW_OUTSIDE_DIRECTORY [--ref REF] [--repository REPO]`; Python/Git and locally available old ref (default c16e2c793b8faa8d21cf2ca9833606676e461e79) | New outside-checkout directory; archived agents/skills/themes/profiles/ocw content/modes + LOOM-EXPORT.txt, guards unsafe/existing destinations. Never auto-installs prompts. Manual/non-CI entrypoint, synthetic function tests in P. Old scripts/ocw names are archive inputs, not current runnable paths. See [migration](migration.md). |
| tools/measure-processing.mjs | First core compile (C), then `node tools/measure-processing.mjs`; Node SQLite | Synthetic fixture, warm timing/runtime/serialization counters JSON stdout; restores process-local JSON.stringify instrumentation. Manual/non-CI, no timing gate/allocation proof. See [processing limits](processing-limits.md). |
| tools/measure-retrieval.mjs | First core compile, then `node tools/measure-retrieval.mjs [PATH_TO_COMPILED_STORE_JS]`; compatible Store API required for optional module | In-memory 1k/10k/50k noise, plans/body-transfer/warm timing JSON stdout. No baseline checkout/compile automation. Manual/non-CI, no timing gate. See [retrieval limits](retrieval-limits.md). |
| tools/probe-config-decoding.ts | `bun tools/probe-config-decoding.ts` or `bun tools/probe-config-decoding.ts --case NAME`; NAME: plain, role_alias, fan_out, cycle, depth_100; locked YAML/schema deps | Aggregate spawns five bounded children with timeout/maxBuffer. JSON graph/RSS/schema samples, no disk fixture generation. Main CI/manual; native decoder examples, not production bounded-decoder allocation guarantee. |

## Workflows: exact triggers and visible check identities

All use Ubuntu, `contents: read`, checkout without persisted credentials, pinned
Bun-file/Node22 and frozen install. None declares paths filters, draft exclusions,
explicit PR activity types or `workflow_dispatch`. PR branch filters below mean
**base** branch. Feature pushes alone do not run these push-main-only checks.
Artifacts upload `always()`, retained seven days; workflow source is authoritative.

| Exact path | Events / display name / job / work and outputs |
|---|---|
| .github/workflows/ci.yml | `pull_request` (unfiltered); `push` branches `[main]`. **Loom plugin CI**, job `test`, 15m. Root typecheck + external fixture typecheck; C/N/S/P; lock/package diff guards; production build; fresh frozen generation; probe; mutation controls. Uploads review-regression-counterchecks-SHA. |
| .github/workflows/installed-host.yml | `pull_request` branches `[main]` only. **Installed OpenCode boot-only regression**, job `installed-host`, 10m. npm-packed candidate artifact + exact SDK2.0.32 + separate CLI2.0.32 + H; uploads installed-host-boot-SHA report. CLI top-level version is exact; transitive graph is not locked. |
| .github/workflows/installed-questions.yml | `pull_request` branches `[main]` only. **Installed question production-path qualification**, job `questions`, 15m. Explicit get-rejection component test; then packs and installs the exact candidate artifact plus separate CLI/SDK2.0.32 and runs Q with `--duplicate-input-control`. Harness points at installed candidate. The exact artifact qualification passed E1-E3, restart and duplicate-input control; temporary report paths and scope limits are recorded in [installed-host validation](installed-host-validation.md). Not retired handback experiment. |

Main CI's external fixture typecheck command is:

```sh
./node_modules/.bin/tsc --noEmit --ignoreConfig --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck --types bun,node tests/question-host/server.ts tests/question-host/get-rejection.test.ts
```

The production build command is
`bun build server.ts --target=bun --external @opencode/plugin --outfile /ABS/OUTPUT/loom-server.js`.
This builds the real production graph, not fixture code. No fresh CI or installed
qualification is implied by this inventory or historical coverage manifest.

## Runner and example supports

These are support/fixture—not standalone tests; their commands/effects are above.

| Exact path | Consumer and purpose |
|---|---|
| package.json | Aggregate scripts/discovery, pins/engines/package files; CI and local runner. |
| bun.lock | Frozen dependency resolution; install and CI diff guards, no test invocation itself. |
| .bun-version | Bun1.4.2 setup-bun/local selection; package-entry and Q read as data. |
| tsconfig.core.json | C/measurement compilation to ignored .test-build; follows src imports. |
| tsconfig.json | Strict root noEmit (server/src/root tests), inherited fixture config. Inert historical sender-host glob is not test execution; nested question-host explicitly typechecked separately. |
| .gitignore | Generated/dependency/local-config/SQLite/Python-cache exclusions, no execution. |
| examples/loom.yaml | Published parser/config fixture consumed by native and config-parser-native, not executable or an install action. |

## Filename map and maintenance check

The cleanup preserves case coverage and workflow contents/visible identities.
The historical README's old consumer reference intentionally remains immutable.
External branch protection or filename-based integrations were not audited;
unchanged check names do not prove external filename consumers absent.

| Former path | Current path / disposition |
|---|---|
| tests/config-parser-boundaries.test.mjs | All five cases in tests/config-parser.test.mjs; redundant entry file removed. Shared error helper additionally checks error code. |
| tests/assignment-delivery.test.mjs | tests/retired-protocol.test.mjs |
| tests/primary-sender-concurrency.test.mjs | Complete worker case in tests/retired-protocol.test.mjs; redundant entry file removed. |
| tests/assignment-delivery-native.test.ts | tests/retired-protocol-native.test.ts |
| tests/primary-sender-native.test.ts | tests/historical-preservation-native.test.ts |
| .github/workflows/handback-experiment.yml | .github/workflows/installed-questions.yml; byte-identical workflow contents. |

For a lightweight documentation audit, compare the first-column path set in the
inventory tables (excluding this historical filename map) against **existing**
`git ls-files --cached --others --exclude-standard tests tools .github/workflows`
paths, plus the seven runner supports. Filter removed index paths with filesystem
existence checks and include untracked additions. Compare sorted sets, not just
test globs; no permanent counting framework is necessary. Existing Python native
discovery assertions separately protect execution membership, not documentation
or installed-host qualification.
