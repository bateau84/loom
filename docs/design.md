# Redesign direction and implementation boundaries

## Product boundary

A Session hosts conversation and execution. An Action represents something to
accomplish. An Action may have a Plan. A Plan may include Phases, Waves, Tasks and
Subtasks, skipping levels that are not useful. An Action can span Sessions, and a
Session can contribute to different Actions. Ordinary conversation creates no
Action automatically. A Plan describes intent and relationships, not a schedule.

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
| User / external config | Agent prompts, skills, models, native permissions and explicit choice of any future automatic continuation |
| Agent | Professional judgment, decomposition, native delegation, useful results and completion reports |
| Loom today | Action/Plan data, context, observations, records, reported progress and question threads |
| Loom coordination candidate | Durable assignment association and answer-to-primary delivery with honest status/recovery |
| OpenCode | Sessions, execution, permissions, native delegation and its return |

Native execution ownership is compatible with Loom requesting native continuation.
That is intentional automation, not passive presentation or another agent runner.
Normal production Loom does not implement the candidate delivery path yet.

Assessment and QA are separate record kinds. The plugin does not manufacture an
independent reviewer, a test run, a satisfied requirement, or a final PASS from an
agent's claim. Reported completion does not automatically complete parents or the
Action; an answer is a response, not resolution or permission to proceed.

## Coordination direction after the reviewed comparison

Use [primary-first native re-delegation](coordination.md) as the next bounded
implementation candidate: answer -> original primary -> native call to the same
Worker Session -> explicit completion -> native return -> primary coordination.
Retain the original worked-against reference. A native call returning after a
question does not end the durable assignment or certify that it is complete.

The `c2db6e7` comparison has independent feasibility acceptance as reported by the
user. Its installed-host scripted scenarios are not production transport, a
live-model usefulness result or overall alpha readiness. See the
[comparison and its evidence boundaries](handback-comparison.md).

Do not extend or transplant the test-only completion bridge. Primary-first
continuation uses no direct Worker synthetic resume and no Loom completion nudge
for that same continuation. Keep passive Session notices separate; they cannot
guarantee idle-primary continuation. Assignment routing, answer delivery,
uncertain admission recovery and cancellation remain future implementation work.

## Data and concurrency

The Action database is distinct from the old workflow database. Plan revisions
are retained. SQLite transactions and optimistic revision checks prevent stale
writers from silently replacing another agent's plan. Ledger entries are added,
not rewritten by plan changes. Node identity is retained when the planner keeps
the same ID. Deleted/changed tasks keep their history.

[Completion references](collaboration.md) identify the work performed using the
retained goal, node contracts, relevant ancestors/dependencies and group contents.
Plan revisions supply traceability, not blanket invalidation after unrelated
edits. Adding contained work reconfirms its group without invalidating unrelated
siblings. Historical completion can remain saved while needing reconfirmation.
This is not a code-freshness proof, execution authority or independent acceptance.

Session work selection is attribution, not execution authority or a substitute
for a durable assignment route. The production context tool saves selection after
reading it; that save can still fail and hide a successful read. The small
separate-outcome correction remains open in the [alpha policy](operating-policy.md).

Observation starts retain the original work association. Missing or ambiguous
starts cannot borrow a newer selection. Incomplete capture is not successful
evidence. See [evidence reliability](evidence-reliability.md) and the precise
[read consistency guarantees](read-consistency.md). Read snapshots are not leases
against later edits. Preserve existing bounded processing/retrieval behavior;
none establishes a whole-process or unlimited-readable-history guarantee.

Capture errors are warnings rather than native execution blockers. Explicit
Loom reads/writes can still fail clearly if storage is unavailable. The database
is not tamper-proof against evaluated code with the same operating-system rights;
strong adversarial evidence collection is outside this plugin's current scope.

## Implementation and evidence status

| Layer | Status |
| --- | --- |
| Five tools, optional plans, role/context injection and append-only history | Production implementation in this draft; see feature-specific regression reports |
| Completion/reopening and contextual question/answer operations | Implemented; not a delivery or wakeup service |
| Tool discovery | Usage help is registered directly in tool descriptions, not only Markdown |
| Installed-host boot | Existing loader/equivalent-empty-ledger check; not whole collaboration acceptance |
| Direct bridge and primary-first comparison | Test-only feasibility; user reports independent acceptance at `925a79f` and `c2db6e7` respectively |
| Durable primary-first delivery, routing, recovery and cancellation | Target contract in `coordination.md`; not implemented by this reconciliation |
| Practical live-model improvement, production readiness | Not established by scripted-provider tests |

## Next bounded work

Follow the sequence in [Coordination](coordination.md): assignment/routing,
transactional answer-delivery intent and Session-wide access, safe admission
recovery/cancellation, then native re-delegation integration and search-visible
help. Keep the measured whole-chain endpoint and stronger duplicate counterchecks.
Do not assume untested background/replay paths work because the foreground
comparison passed. This document does not authorize paid inference.

The small context-read/selection-save correction, one tested manual backup/restore
procedure, and external agent/config migration remain separate alpha work. Agents
and skills live outside the plugin; migrated prompts must not depend on removed
workflow tools. Preserve optional external `SKILL.md` / `ASSESSMENT.md` / `QA.md`
companions and native loading. The skills repository is
[bateau84/skills](https://github.com/bateau84/skills).

## Deferred, not missing prerequisites

Scheduling, dashboards, automatic parent completion, universal grants/gates,
legacy ledger import, automatic retention and elaborate storage maintenance are
not prerequisites for this coordination candidate. They need their own demonstrated
use and explicit scope before development; their presence in old Loom is not a
reason to restore them. E remains partial without storage/whole-process claims.

The PR stays draft until the chosen usable alpha and migration are verified.
Removed tests and historical success do not certify rewritten behavior.

## Versioned references

The current compatibility target is OpenCode 2.0.29; see the
[upgrade notes and pinned sources](opencode-2.0.29.md). Earlier evidence reports
retain their historical v2.0.18 references rather than being relabelled as new runs.
Production YAML parsing uses the [pinned bounded parser](configuration-parser.md),
not an assumed allocation boundary from Bun YAML alone.
