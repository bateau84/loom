# Redesign direction and first implementation

## Product boundary

A Session hosts conversation and execution. An Action represents something to
accomplish. An Action may have a Plan. A Plan may include Phases, Waves, Tasks and
Subtasks, skipping levels that are not useful. An Action can span Sessions, and a
Session can contribute to different Actions. Ordinary conversation creates no
Action automatically.

Agents and skills are external. `.loom.yaml` maps native agent IDs to roles and
optional coordination descriptions. Role guidance is injected into transient
model context, not written into agent files. Roles guide selection and tool use;
they are not authority classes or permission grants. The plugin has no fixed
General/Planner/Worker/Reviewer/Critic roster.

The plugin supports work; it must not make agents maintain internal lifecycle
machinery. There are five task-oriented tools, no workflow admission/attachment,
no recompilation gate, no custom shell permission parser and no mandatory review
pipeline. Native OpenCode tools and permissions remain unchanged.

## Ownership

| Owner | Responsibility |
| --- | --- |
| User / external config | Agent prompts, skills, models, native permissions |
| Agent | Professional judgment, decomposition, delegation, useful results |
| Loom | Action/Plan data, current task context, captured observations and records |
| OpenCode | Sessions, tool execution, permissions and native delegation |

Assessment and QA are separate record kinds. The plugin does not manufacture an
independent reviewer, a test run, a satisfied requirement, or a final PASS from an
agent's claim. No orchestrator-driven review loops are implemented in this slice.

## Data and concurrency

The Action database is distinct from the old workflow database. Plan revisions
are retained. SQLite transactions and optimistic revision checks prevent stale
writers from silently replacing another agent's plan. Ledger entries are added,
not rewritten by plan changes. Node identity is retained when the planner keeps
the same ID. Deleted/changed tasks keep their history.

Task contract fingerprints include the Action goal and the selected Task's
parent/dependency contracts. An unrelated Task edit does not mark the selected
Task's contract as changed. This is deliberately **not** a code freshness proof.
The runtime never turns `contract_match` into permission to claim success.

Session work selection is attribution, not execution authority. It happens as
part of a useful context read. A native tool's association is captured before
execution and preserved when its result arrives. A result without its recorded
start cannot borrow the Session's new selection. Started-but-unfinished calls
remain visible. Failed capture does not get relabelled as successful evidence.

Capture errors are warnings rather than native execution blockers. Explicit
Loom reads/writes can still fail clearly if storage is unavailable. The database
is not tamper-proof against evaluated code with the same operating-system rights;
strong adversarial evidence collection is outside this plugin's current scope.

## Acceptance tests added

The tests exercise arbitrary agent names; many-to-many role mappings; unchanged
native prompts and permissions; reload and opt-out; config-layer precedence;
invalid/oversized configs; hierarchy and dependency validation; preserved history;
changed/unchanged task fingerprints; optimistic write conflicts; multi-instance
storage; correct observation association after work switches; missing capture;
claims referencing unknown/cross-Action observations; separate Assessment and QA;
paged retrieval; recent relevant context; and explicit context truncation.

Local verification and CI results must be reported separately from live-host
verification. No test here claims to measure actual model quality or task success.

## Remaining redesign work — not implemented

- Finish external config migration: choose the external repository, port agent
  prompts away from removed Loom procedures, and retain skill content independently.
- Native delegation integration that selects and injects the exact assigned Task
  without a child context-selection call, including concurrent and resumed agents.
- Scheduling/parallel coordination and real pause/cancel/resume, not just state
  labels. No automatic dispatch exists in this first implementation.
- Task execution/progress views, read-only cross-session dashboard, compact UI.
- Legacy ledger import with provenance retained and no invented observation links.
- Artifact content/revision tracking, claim revalidation and review independence
  checks appropriate to the real risk rather than a new all-encompassing gate engine.
- Installed-plugin OpenCode smoke tests and realistic model-driven tasks comparing
  task quality, elapsed time, tokens and user intervention against plain OpenCode.
- Retention/export and operating limits for long-running ledger use.

The PR stays a draft until the chosen usable release scope and migration are
verified. Removed old tests are not evidence that the old functionality works;
this is a new implementation, not a compatibility refactor.

## API references used

- OpenCode V2 plugin documentation: https://opencode.ai/v2/docs/build/plugins/
- Pinned session-hook types: https://github.com/anomalyco/opencode/blob/v2.0.18/packages/plugin/src/promise/session.ts
- Pinned tool-hook types: https://github.com/anomalyco/opencode/blob/v2.0.18/packages/plugin/src/promise/tool.ts
- Pinned Session identity: https://github.com/anomalyco/opencode/blob/v2.0.18/packages/schema/src/session.ts
- Bun YAML API: https://bun.sh/docs/runtime/yaml
