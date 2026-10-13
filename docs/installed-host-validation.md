# Installed-host validation: separate boot from acceptance

The existing Bun native suite uses a simulated host API. It proves callback
behavior under that contract, not that the published OpenCode CLI can load Loom.
`tests/installed_host_smoke.py` adds a separate, no-inference boot probe using an
already installed, exact OpenCode CLI version. The CI job installs
`@opencode/cli@2.0.18` outside the plugin's dependency tree, matching the reviewed
SDK target; it does not upgrade the user's CLI or patch upstream source.

## What this probe actually checks

The probe creates an empty temporary Git project and isolated HOME, configuration,
state, data, runtime and cache directories. Provider credentials, shared-server
addresses and user configuration are not inherited. Every host command uses a
private server (`--standalone`); the probe never sends a prompt or model request.
It stops its isolated process groups and removes temporary state on exit.

1. Verify the installed version and read a nonempty native agent roster without Loom.
2. Add Loom's checkout to the temporary OpenCode configuration, and map one actual
   native agent to a role in the temporary `.loom.yaml`.
3. Ask the real host to list loaded plugins; require plugin ID `loom`. Compare
   complete native agent definitions with the baseline.
4. Read the host-created Loom SQLite database in read-only mode, checking its
   schema, integrity and empty Action/Plan/selection/ledger tables. The test must
   not initialize the tables it expects to find.
5. Start another private host and verify the same database remains intact.
6. Remove the plugin configuration entry, verify it no longer loads, and verify
   native definitions and the existing empty Loom database are unchanged.

The report includes the checked Git commit, runtime source hashes, command output
and elapsed times. Failure or unavailable installation is not PASS. CI preserves
reports and command logs as a seven-day artifact. The local Python harness tests
check environment isolation, read-only inspection and failure reporting only.

Run after installing dependencies and the exact CLI separately:

```sh
python3 tests/installed_host_smoke.py \
  --opencode /absolute/path/to/opencode \
  --expect-version 2.0.18 \
  --report-directory /absolute/path/to/new-report-directory
```

## What a successful boot does not establish

This does not exercise model-context injection, tool execution, native delegation,
parallel Code Mode calls, capture toggles, interruption, task selection/recovery,
nonempty-ledger persistence or review recording. It does not measure model quality
or establish that the user's laptop behaves like the CI host. Fresh private-server
boots are not equivalent to the two-agent resumption scenario. A config-entry
removal is not a full backup/restore or old/new-runtime migration test.

The next installed-host acceptance run must still cover:

- Research records a conclusion; a Worker consumes its dependency context.
- Replanning removes the selected task; the agent sees the recovery notice and
  explicitly reselects work without altered historical records.
- A genuinely fresh Session recovers the same Action and useful conclusions.
- Parallel same-tool calls, capture off/on, interruption, restart and late
  completions retain the documented honest attribution/ambiguity behavior.
- Assessment/QA records remain opinions with evidence links, not automatic proof.

Use isolated state and record host version, actual tool results, ledger snapshots
and limitations. Do not replace the real host with manual hook calls and call it
live acceptance. Paid/model-driven runs need their own explicit execution setup.

## Review independence and the unused method

This same authoring session cannot supply an independent Reviewer gate merely by
renaming its own check. That gate remains open. The report includes a direct
source call-site scan for `Store.recent()`; this is useful review evidence, not
proof about intended or external consumers. The method is not removed by this
patch, preserving the requested independent consumer check.

A/B/C/D remain implemented and regression-tested. E and broader F coverage remain
open. Short excerpts can omit qualifications; consequential decisions still
require full-source reads. Keep PR #180 draft until independent review and the
remaining real-host acceptance work are complete. No runtime code, tool, gate,
orchestration behavior, dependency lock or backup semantics change here.
