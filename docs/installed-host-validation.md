# Installed-host validation: separate boot from acceptance

## Replacement collaboration acceptance

The boot scope below and earlier sender/handback scenarios are historical or
narrow supporting evidence, not acceptance of the current replacement. Current
acceptance must identify the exact assembled artifact (including help and harness),
build/configuration, unmodified native 2.0.29 host and producing state/run. Do not
inherit old scenario counts or label a simulated ToolContext as installed proof.

- **E1 durable/manual question:** real discovered/registered tools and genuine
  caller attribution through SQLite and full_thread. Require canonical ask/answer
  `context_attachments`, rejection of `attachments` alone/alongside it, five tools,
  optional Plan, valid/invalid references and Session-only questions. Ask must
  save with `not-attempted / policy-capability-unavailable`, zero recipient contact,
  permission prompt, child, executor or probe. Blocking guidance is conditional
  on arranged manual handling, not a forced wait. Reads/restart must not dispatch.
- **E2 one-shot authority:** real first new-format blocking answer commit through
  production adapter/native synthetic to the exact stored asking Session. Preserve
  current target agent/model/permissions. Exercise publicly created idle/running/
  pre-yield, agent-switch and missing/moved/inaccessible targets where available.
  Later/nonblocking/legacy answers and failed/unknown first attempts followed by
  later answers never submit additional asker input. No retarget, retry or replay.
  Separate SYSTEM outcome/annotation failure must not erase the durable answer.
  Admission is not consumption/completion; timeout is not native cancellation;
  target validation is not a lease. Crash can permanently lose resume.
- **E3 preservation/history:** frozen portable synthetic populated old producer
  state, actual candidate startup and new API writes, unchanged raw IDs/bytes/
  attribution/links/completion qualifications. Explicit Action/node OR Session
  membership, direct later answers, deduplication/sequence order, escaped Unicode
  record parts and final-only advance, corruption/cursor failures and retired
  operations/views must be checked with an independent enumeration/content oracle.
  No invented receipt from notices/admission/assignments/same-agent names, no
  recursive evidence expansion or fabricated raw observation bodies. Verify
  clean-clone/no-old-Git portability and disposable separate-location rollback.

Only the genuinely external model dependency may be substituted by a deterministic
local provider preserving native tool/admission behavior; no paid inference is
implied. Product-owned registration, persistence, selection, rendering and resume
must remain real. Fault doubles are supporting narrower evidence, never a substitute
for those installed paths. Missing public target variants remain UNPROVEN and
must be escalated. Record PASS/FAIL/UNPROVEN, substitutions, logs and limitations;
repeat affected proof when content changes. No normal-host API, config, DB,
restart, active integration or activation is authorized by this document.

## Existing no-inference boot scope

The existing Bun native suite uses a simulated host API. It proves callback
behavior under that contract, not that the published OpenCode CLI can load Loom.
`tests/installed_host_smoke.py` is a separate, no-inference boot probe using an
already installed, exact OpenCode CLI version. CI installs
`@opencode/cli@2.0.29` outside the plugin dependency tree, matching the reviewed
SDK target. Loom dependencies use frozen installation in this job too. The external
CLI has an exact top-level version, not a fully locked dependency graph. It does not upgrade the user's CLI or patch upstream source.

## What this probe actually checks

The probe creates a temporary Git project and isolated HOME, configuration,
state, data, runtime and cache directories. Provider credentials, shared-server
addresses and user configuration are not inherited. Two native agent fixtures
are defined in the temporary OpenCode configuration, outside Loom. The same
config retains built-in plugin enablement before, during and after the trial.

Each stage starts an actual `opencode serve --stdio` process, retaining its stdin
ownership lease. The reported endpoint must be loopback HTTP; private credentials
are not sent through proxies or redirects. Requests are restricted to read-only
info/config/agent/plugin endpoints. No prompt or model request is sent.

A newly listening server may still have empty inventories while plugin activation
runs asynchronously. The probe keeps that same process alive and polls for the
actual fixture agents and active plugin status, with a bounded retry count. It
does not treat an HTTP 200, an empty list or a failed plugin record as readiness.
Starting and closing a new private server for every query cannot test this
startup boundary reliably.

1. Verify both the CLI and server version; read the host's effective config.
2. Require the real host to discover both native fixture agents without Loom.
3. Add Loom's checkout to temporary config and map the Worker fixture to a role
   in `.loom.yaml`. Require active plugin ID `loom`, not merely a listed failure.
4. Compare complete native agent definitions against the pre-Loom baseline.
5. Read the host-created Loom SQLite database in read-only mode. Require its
   schema, integrity and empty Action/Plan/selection/ledger tables. The test does
   not create or repair the tables it expects to find.
6. Stop the host, start another, and verify plugin loading and an equivalent
   intact empty ledger at the expected path. Remove the plugin config entry,
   start again, and verify the native definitions and equivalent ledger checks
   while Loom is absent. These checks compare path, integrity, schema presence,
   version and empty table counts, not database identity or byte-for-byte contents.

Recreating an equivalent empty database could satisfy these assertions. The
probe does not prove persistence of meaningful records or database immutability.

The probe closes stdin to stop its private server, with bounded forced cleanup
when necessary, and removes temporary state. Forced termination is currently
allowed without a separate graceful-teardown verdict; successful checks do not
establish graceful shutdown. The report includes the checked
commit, runtime hashes, completed stages, attempt counts and elapsed times.
Server logs and latest API responses are retained as CI artifacts for seven days.
Failed assertions or unavailable installation are not PASS. Python harness tests
cover the test's isolation, response validation, readiness and error behavior;
they are not substitutes for the installed-host run.

```sh
python3 tests/installed_host_smoke.py \
  --opencode /absolute/path/to/opencode \
  --expect-version 2.0.29 \
  --report-directory /absolute/path/to/new-report-directory
```

## What a successful boot does not establish

This does not exercise model-context injection, tool execution, native delegation,
parallel Code Mode calls, capture toggles, interruption, task selection/recovery,
nonempty-ledger persistence or review recording. It does not measure model quality
or establish that the user's laptop behaves like CI. Creating fixture agents is
not executing a two-agent task. Config-entry removal is not backup/restore or a
full old/new-runtime migration test.

The next installed-host acceptance run must still cover Research recording a
conclusion, Worker consuming its dependency context, replanning/removal and an
explicit recovery choice, and a genuinely fresh Session recovering the same
Action. It must also exercise parallel same-tool calls, capture off/on,
interruption, restart and late completions, with honest attribution/ambiguity and
Assessment/QA records that remain opinions rather than automatic proof.

Use isolated state and record host version, real tool results, ledger snapshots
and limits. Do not replace host execution with manual hook calls and call it live
acceptance. Model-driven runs need their own explicit execution setup.

## Historical review independence and subsequent evidence

This authoring session does not supply an independent Reviewer gate by renaming
its own checks. That gate stays open. The supplied review of `6c8abb3` found no
tracked direct callers of the former broad recent-record reader and no package entrypoint
exposing it. The corrective patch removes that unused method; this bounded
cleanup is not completion of the combined independent review.

Subsequent operator startup and historical Action/Plan retrieval succeeded after
the narrowly supported empty predecessor sender-table upgrade. Separately, the
real native trial passed handoff/completion/replan/removal and independent fresh
recovery without authorizing/sending automatic continuation. See
[operating policy](operating-policy.md) and [migration](migration.md#state-and-rollback).
These later observations do not expand this older empty-ledger boot probe into
restart, sender transport or whole-alpha acceptance proof.

A/B/C/D remain implemented and regression-tested. E and broader F coverage remain
open. Excerpts can omit qualifications; consequential decisions require full-source
reads. Keep PR #180 draft until independent review and the remaining real-host
acceptance work are complete. The subsequent capture-gap/opt-out correction
requires its own verification; the passing boot run of `6c8abb3` does not certify
later source changes. Tools, gates, orchestration, dependency locks and backup
semantics are not expanded by the correction.
