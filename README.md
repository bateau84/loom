# Loom — Action-based OpenCode plugin

**Breaking redesign draft. Not a drop-in replacement for the old Loom bundle.**

Loom helps agents organize work and recover its context later. It does not own
agent definitions, skills, models, permissions, Git commands or a mandatory
workflow state machine. This repository contains the plugin and its own tests,
configuration example, documentation and migration helper.

## What is implemented

- `.loom.yaml`: layered settings, external-agent role mapping and live reads.
- Automatic, bounded role instructions in the current agent's model context.
  Native agent definitions, permissions, tools and model settings are untouched.
- Actions shared across sessions in the same project, with optional plans.
- Optional Phase → Wave → Task → Subtask levels and dependency validation.
- Task context with goals, parent/dependency context and recent ledger entries.
- Persistent observations, claims, results, Assessment and QA records.
- Five tools: `loom_agents`, `loom_action`, `loom_plan`, `loom_context`, `loom_record`.

A conversation needs no Action. An Action needs no plan. A task does not need to
pass through fixed review stages. Revision checks prevent lost edits; they are
not execution grants. Replanning does not erase earlier evidence or results.

## Before using this branch

**Do not replace or pull this branch into your active OpenCode config root.**
The original skills are now preserved separately at
[github.com/bateau84/skills](https://github.com/bateau84/skills) (its `skills/`
Git tree matches the former Loom `skills/` tree). Native OpenCode still owns
skill installation and discovery; Loom does not load skills from GitHub.
Export agent definitions, launchers, themes, profiles and any private settings
separately before replacing a config-root checkout. The migration is deliberately
not automatic: existing agent prompts still reference removed Loom tools.
See [Migration](docs/migration.md), including the separate agent/skill cleanup.

This first implementation is not the whole redesign. Native automatic delegation
handoffs, execution cancellation, dashboard, legacy ledger import, independent
review orchestration and real model-driven acceptance tests are still outstanding.
The Action `paused`, `cancelled` and `completed` labels record intent/progress;
they do not interrupt a running OpenCode session or certify successful delivery.

## Loading the plugin

Target: OpenCode V2. The SDK dependency remains pinned to `@opencode/plugin`
`2.0.18`, as on the original `main`; this PR does not upgrade your CLI or model.
**Bun support: `>=1.4.2 <2.0.0`. Use Bun 1.4.2 to reproduce validation.**
The exact tested baseline is recorded in `.bun-version` and used by both CI jobs.
This is a supported minimum based on that tested baseline, not a claim that
1.4.2 was the first release to fix the issue or that every newer release was tested.

**Bun 1.3.14 is not supported with the pinned SDK.** The local review found that
its missing-module value is not an `Error` instance. OpenCode's resolver then
fails while probing absent optional `tui`/`rpc` entrypoints even though `server.ts`
resolves. The correction is to stop advertising that runtime, not add dummy TUI
or RPC files, patch the SDK, or ignore resolver failures.

Before testing, check `bun --version` and `bun --revision`, select the baseline
with your normal Bun installation method, and run `bun run test:native` in the
separate plugin checkout. The resolver test checks real server loading and absent
optional entrypoints; an unsupported test runtime fails with a version message.
`.bun-version` and `engines.bun` declare the boundary; they do not install or
upgrade Bun, replace OpenCode's embedded runtime, or enforce plugin loading.
Changing the Bun executable on PATH does not establish the runtime used inside a
packaged OpenCode executable. Test that installed host separately using
[the boot probe](docs/installed-host-validation.md) before switching normal work.
The boot probe still proves only loading and equivalent intact empty-ledger checks,
not two-agent behavior, meaningful-record persistence, or graceful teardown.

The capture-gap repair also requires a **full OpenCode host restart on first
installation**; hot-upgrading cannot recover uncertainty discarded by the old
implementation. See [Evidence pairing](docs/evidence-reliability.md).
This compatibility correction leaves dependency versions and installation behavior
unchanged. A frozen dependency graph and backup/restore remain separate work.

In a separate plugin checkout, run `bun install`. Add that checkout to your
existing OpenCode configuration, without replacing your other entries:

```json
{
  "plugins": ["/absolute/path/to/loom"]
}
```

Configure external agent names in `.loom.yaml`; start from
[examples/loom.yaml](examples/loom.yaml). The file is read at the next relevant
hook or tool call. No background watcher or model request is used for reload.

## Configuration

Precedence, from low to high:

1. `$OPENCODE_CONFIG_DIR/.loom.yaml`, or
   `${XDG_CONFIG_HOME:-~/.config}/opencode/.loom.yaml`.
2. `<project-working-directory>/.loom.yaml`.
3. `<project-working-directory>/.loom.local.yaml`.

Mappings merge, lists replace. `agents.<name>: null` removes an inherited entry;
`enabled: false` disables Loom guidance for that agent. Native agent descriptions
are the default; the Loom description is a coordination-only override. A role can
belong to many agents and an agent can have many roles. Missing configured agents
are reported by `loom_agents`; no placeholder agents or permissions are created.

Supported sections are `version`, `agents`, `roles`, `instructions`, `context`,
and `ledger`. Unknown settings fail validation. Model/permission definitions
belong to OpenCode, not this file. Invalid configuration disables guidance and new
automatic capture instead of applying a partial or stale role mapping. Diagnostics
remain available through `loom_agents`; native tools remain usable.

Each file is limited to 64 KiB. Context budgets are **characters, not tokens**:
there is no fabricated tokenizer-independent `max_tokens` guarantee. The schema
is a first implementation, not an implementation of every earlier sketch.

## Agent experience

For concrete work, create an Action. For complex work, save an optional plan.
Pass the Action and Task IDs in the native delegation message. The receiving
agent calls `loom_context` once with those IDs to select work and get its context.
Future model turns receive that context automatically for configured agents.
Unconfigured agents get no Loom instructions or context injection.

This is an explicit task selection, not a permission/attachment gate. Native
execution is never gated by it. The current implementation intentionally does not
infer a child's task from its parent's *current* selection, which might have
changed after dispatch. Fully automatic native handoff remains future work.

Use `loom_record` to record useful results, claims, Assessment or QA findings.
Load external skills and their `ASSESSMENT.md`/`QA.md` companions with native tools.
Loom does not require a special companion-loader ceremony. These are stored
review results, not an automatic guarantee of reviewer independence.

## Evidence and privacy

The host observer records start and finish separately, with session/message/call
IDs and input/result digests. It never stores raw tool arguments or output. Use
the source session and call IDs to find the original result through OpenCode;
use explicit result/claim records and artifact references for useful summaries.
Missing starts stay unattributed; unfinished starts are not success. An in-flight
call retains its original work association when the Session changes tasks.

Claims can reference only existing observation IDs in the same Action. A link is
not proof that a statement is true. A stored review PASS is not an Action PASS.
`contract_match` means that the plan/goal fingerprint matches, **not** that code,
external facts or the evidence itself have been revalidated. Records remain
available when a task changes or disappears from a new plan revision.

Data is stored separately from old Loom state under
`${XDG_STATE_HOME:-~/.local/state}/loom/actions-v1/<project-key>/ledger.sqlite`.
Different projects use different databases; project worktrees can share Action
history. The plugin checks the actual Session location before handling its calls.
Do not sync this private database into source control. It is local history, not a
security boundary against other programs running as your user. Capture can be
disabled with `ledger.capture: off`. Explicitly recorded text is not redacted;
never put credentials or other secrets in a result, claim or artifact reference.

## Development

Use the Bun version in `.bun-version` (currently **1.4.2**).

```sh
bun --version
bun install
bun run typecheck
bun run test:core       # Node 22.16+; core tests use actual SQLite
bun run test:native     # Bun YAML/SQLite + registered plugin-hook contract tests
```

Tests isolate config and state in temporary directories. No paid inference is
required by CI. The native contract test uses a fake host API with real Bun
primitives; it does **not** replace a live OpenCode installation smoke test.

See [Design and remaining work](docs/design.md).
