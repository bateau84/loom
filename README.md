# Loom — Action-based OpenCode plugin

**Breaking redesign draft. Not a drop-in replacement for the old Loom bundle.**

Loom helps agents organize work and recover its context later. It does not own
agent definitions, general engineering skills, models, permissions, Git commands
or a mandatory workflow state machine. This repository contains the plugin and its own tests,
configuration example, documentation and migration helper.

## What is implemented

- `.loom.yaml`: layered settings, external-agent role mapping and live reads.
- Automatic, bounded role instructions in the current agent's model context.
  Native agent definitions, permissions, tools and model settings are untouched.
- Actions shared across sessions in the same project, with optional plans.
- Optional Phase → Wave → Task → Subtask levels and dependency validation.
- Task context with goals, parent/dependency context and recent ledger entries.
- Persistent observations, claims, results, Assessment and QA records.
- Reported completion/reopening and contextual question/answer threads.
- Usage documentation returned directly by tool search.
- A bundled native `loom` skill, discoverable and loaded on demand.
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
not automatic: legacy exported prompts may reference removed Loom tools.
Current native agent mappings use the migrated definitions; do not reinstall
removed external Loom skills. The bundled `loom` skill is the usage guide.
See [Migration](docs/migration.md) for other installations and legacy exports.

The alpha milestone is useful Research → Worker handoff and fresh-session
resumption with trustworthy history, clear tool guidance, and one tested manual
backup/restore procedure. The default-off sender is accepted within its bounded
scope, not as general production coordination readiness. A real native handoff,
completion/replan/removal and independently checked fresh-Session recovery trial
also passed its declared scope; it sent no automatic continuation. Successful
context reads now survive selection-save failures with a separate truthful outcome.
See the [alpha policy and evidence limits](docs/operating-policy.md),
[coordination direction](docs/coordination.md) and
[manual stopped-writers backup/restore](docs/manual-backup-restore.md).

Advanced storage recovery, maintenance/capacity modes, strict WAL-growth quotas,
scheduling, dashboards and legacy import are deferred, not alpha prerequisites.
No history-size or whole-process resource guarantee is advertised. The Action
`paused`, `cancelled` and `completed` labels record intent/progress; they do not
interrupt an OpenCode session or certify successful delivery.

## Loading the plugin

Target: **OpenCode 2.0.29**. The SDK, isolated Code Mode search fixture and installed
CLI boot test use that exact version. This checkout does not upgrade your local
OpenCode executable or change your model. See [the upgrade notes](docs/opencode-2.0.29.md).
**Bun support: `>=1.4.2 <2.0.0`. Use Bun 1.4.2 to reproduce validation.**
The exact tested baseline is recorded in `.bun-version` and used by the CI jobs.
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
The CI jobs install Loom dependencies from the committed lockfile with frozen
installation and a lock-stability check. The separately installed host's dependency
graph remains a separate concern. The manual state procedure has isolated
meaningful-record restore evidence, not native Session continuity proof.

In a separate plugin checkout, run `bun install --frozen-lockfile`. Add that checkout
to your existing OpenCode configuration, without replacing your other entries:

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

## Bundled Loom skill

Loading this plugin also registers the native skill **`loom`**. Agents can discover
its description and load the guide with OpenCode V2's regular tool:

```ts
skill({ id: "loom" })
```

The [guide](src/skills/loom/SKILL.md) ships inside the plugin and has a real package
path. No separate skill installation, global-directory copy or network fetch is
needed. The public `server.ts` entrypoint composes the existing core plugin with
this skill; `src/plugin.ts` remains the internal core implementation.

Only metadata is advertised until OpenCode loads the skill. The V2 `autoinvoke`
flag is enabled for discovery; it does **not** inject the full guide at startup.
Native skill permissions still apply, and Loom does not force loading, rewrite
agents, add a sixth tool or change role/context injection. The guide is available
without an Action or configured role, including when `instructions.enabled` is
false. General engineering and review skills remain external.

The skill transform preserves an existing skill with the same ID, including its
visibility settings. Rename or remove an old custom `loom` skill to use the
bundled one. Reload replays registration without duplicating the entry, and
unloading removes this plugin's contribution, not other skills. Update the guide
alongside changes to Loom's tools. The guide body is read during plugin setup;
an already loaded host needs plugin re-registration and a fresh native skill
load to use an updated body, not just a YAML reread. This documentation change
does not reload or restart the host. The guide explicitly describes the current
default stored-only behavior and explicitly opt-in answer-to-primary sender,
separate from the older test-only continuation path. See
[sender operations and uncertainty](docs/assignment-delivery.md) and
[isolated qualification](docs/sender-qualification.md). No upgrade, configuration
or guide loading authorizes historical intents or enables default coordination.

## Agent experience

Start with the [five-tool guide and Research → Worker example](docs/tools.md).
It covers operation inputs, side effects, exact dependency-record retrieval,
replanning, review records and fresh-session resumption. Usage is also registered
directly in tool descriptions and returned by tool search; agents do not need to
fetch this Markdown first. See [tool discovery](docs/tool-discovery.md). Live-model
usefulness of the guidance remains separate from scripted-host feasibility.

For work worth retaining, optionally create an Action and save a Plan if useful.
Pass the Action and Task IDs in the native delegation message. The receiving
agent calls `loom_context` once with those IDs to select work and get its context.
Future model turns receive that context automatically for configured agents.
Unconfigured agents get no automatic Loom instructions or context injection,
but can still load the bundled skill.

This is an explicit task selection, not a permission/attachment gate. Native
execution is never gated by it. The current implementation intentionally does not
infer a child's task from its parent's *current* selection, which might have
changed after dispatch. Fully automatic native handoff remains future work.

The implemented opt-in sender sends answer references to the exact primary,
which retrieves the thread and natively re-delegates to the same Worker Session.
Native delegation owns the completion return: no competing Loom completion nudge
or direct Worker synthetic resume is sent on that path. Assignment routing,
positive-only admission recovery and irreversible explicit withdrawal are
implemented. Default sends none: only future intents after exact-primary
authorization are eligible. Native Stop is not withdrawal; admission is not
processing or acceptance. Passive notices are not equivalent continuation.

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

Before an upgrade, preserve state using the [offline procedure](docs/manual-backup-restore.md).
Only the observed empty predecessor sender-table shape has a supported in-place
compatibility upgrade; unsupported/nonempty predecessor shapes fail explicitly,
without resetting history. This is not legacy workflow-ledger import. See
[state and rollback](docs/migration.md#state-and-rollback).

## Development

Use the Bun version in `.bun-version` (currently **1.4.2**).

```sh
bun --version
bun install --frozen-lockfile
bun run typecheck
bun run test:core       # Node 22.16+; core tests use actual SQLite
bun run test:native     # Bun/SQLite + registered plugin-hook and parser tests
```

Tests isolate config and state in temporary directories. No paid inference is
required by CI. The native contract test uses a fake host API with real Bun
primitives; it does **not** replace a live OpenCode installation smoke test.

See [Design and implementation boundaries](docs/design.md) and [Coordination](docs/coordination.md);
[the alpha operating policy](docs/operating-policy.md) defines the narrower release scope.
