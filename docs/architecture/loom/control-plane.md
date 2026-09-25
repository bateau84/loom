---
type: design
title: Loom Control Plane
description: OpenCode plugin that enforces workflow state, routing, evidence coordination, bounded execution, and shared questions.
tags: [architecture, loom, control-plane, plugin, workflow]
---

**Status:** proposed

## Responsibility

The control plane handles rules that should not depend on an LLM remembering them.

It is implemented as a global OpenCode V2 plugin under `~/.config/opencode/plugins/loom/`, with custom tools and hooks. Loom's repository mirrors the global config directory, so OpenCode-specific files live at repository root.

## Core State

Each workflow has:

```text
workflow id
anchor
execution stage
work scope attachment (when hierarchical work applies)
required capabilities
completed capabilities
tasks
dependencies
open questions
evidence references
retry/progress counters
review counters
critic counters
resource limits
status
```

Runtime state is not product authority.

Durable product meaning remains in OKF documents.

For Planner-driven product work, persistent work hierarchy state is separate from workflow execution state. The accepted Objective identity is established from accepted authority before Planner; Planner may propose Phase/Wave/Task decomposition only inside that Objective. The control plane validates and materializes hierarchy mutations, owns node lifecycle transitions and roll-up, and rejects stale or conflicting shared-state updates. See [Hierarchical Work Model](work-hierarchy.md).

The workflow-local field historically described as `phase` is an **execution stage**, not a hierarchical Phase. New state/API vocabulary uses `executionStage` (or equivalent unambiguous naming). Legacy workflow snapshots with `phase` retain execution-stage meaning only.

## Control Tools

The plugin exposes a small Loom tool namespace.

Initial capabilities:

- **intent** — track one-question-at-a-time product-intent interviews, resolved decision branches, draft readiness, and exact Anchor acceptance.
- **workflow** — start, inspect, advance, block, complete.
- **route** — classify required capabilities and inspect unmet prerequisites.
- **task** — register a validated implementation DAG, expose runnable tasks, and enforce bounded per-task write surfaces.
- **oq** — raise, list, answer, reconcile, reopen.
- **evidence** — register and query observed verification evidence.
- **progress** — record attempt deltas and detect repeated non-progress.

The exact tool surface should stay small and deep rather than mirror every internal state operation.

## Enforcement Hooks

OpenCode plugin hooks enforce:

### Permission boundary

Permission hooks deny writes outside the active worker task's allowed surface.

Static agent permissions provide the first boundary; task-scoped control adds the second.

### Evidence capture

Tool execution hooks record compact observations for non-Loom tool calls:
- session and agent identity when available;
- tool name and success/failure;
- timestamp;
- digests of input and result;
- redacted shell command or file path when safely available.

Raw tool output is not copied into the ledger by default.

Agents may create evidence claims only by referencing observations from their current session. Test/build/lint/security claims additionally require a recognized observed command of that class.

When a workflow step completes, its session observations are bound to that step. Reviewers can query the step's observations and claims directly.

An agent cannot create equivalent proof by merely writing prose.

### Context shaping

Session context hooks can add the current compact workflow/task envelope and remove tools that are not valid for the active role.

### Retry limits

Session retry and Loom progress state bound repeated attempts.

Identical failure + unchanged strategy beyond the configured limit routes upward or stops.

## OQ Board

Questions are shared workflow state, not messages carried manually by General.

An OQ records:
- the exact question and source evidence;
- the authority required to answer it;
- whether it blocks work;
- affected workflow-step consumers;
- the authoritative answer;
- per-consumer reconciliation.

Any active specialist may raise a question. The required authority reads and answers it directly from shared state. General schedules the required authority when needed but does not interpret or relay the question.

An answer is not closure when consumers already relied on the unresolved or prior meaning. Each declared consumer records `incorporated`, `unaffected`, or `explicitly-deferred`. Blocking work cannot complete until its relevant question is closed.

For a blocking question raised before downstream work begins, the raising step is automatically a consumer. Future dependent work consumes the corrected artifact normally and does not need ceremonial reconciliation merely because it is downstream.

Reopening explicitly preserves or invalidates the previous answer. Invalidating an answer clears prior reconciliation.

User-owned questions are the exception: General presents the exact stored question and records the exact user answer as user-sourced authority.

## Progressive Maintenance Routing

For non-product maintenance, migration, and refactor work, Loom distinguishes a **structural change** from an **unresolved structural decision**.

`loom_route structural=true` means current evidence already shows that Architect authority is required to choose technical realization. A mechanical config/schema/file-shape transformation whose mapping is fully determined by accepted authority or current external documentation does not require Architect merely because structure changes.

When external facts are needed first, General may route `externalUnknown=true, structural=false`. After Research and independent review establish current facts, General reclassifies only if a real structural decision remains. Satisfied work is preserved across that reclassification.

This keeps ordinary maintenance shallow while retaining evidence-triggered escalation.

## Persisted Verification Requirements

Load-bearing verification discovered by a specialist is workflow state, not prose.

An attached specialist may call `loom_verification action=require` to record:
- the evidence kind;
- the concrete required outcome;
- the downstream gate that must not PASS before proof exists;
- creating step/role provenance.

Any current workflow session with the required non-mutating capability may provide proof using observed tool-event IDs through `loom_verification action=prove`.

A gate PASS is mechanically rejected while an open requirement targets that gate.

Reopening upstream work invalidates affected proof. Reopening the requirement's creating step supersedes that requirement so the new specialist pass can restate the current obligation.

Coordinator prompts cannot waive persisted verification.

## Operational Tool Presentation

High-frequency operational tools default to compact views intended for both models and humans.

`loom_status` summarizes:
- finished/total progress;
- currently runnable work;
- recent completed/failed transitions;
- near-term blocked steps and dependencies;
- open OQs;
- open verification requirements;
- dispatch budget;
- Product Acceptance / knowledge-sync state.

Pass `detail=true` only when full workflow internals are actually needed.

`loom_evidence_observations` likewise returns a bounded recent list by default instead of dumping all observation digests into the transcript; full records remain available with `detail=true`.

## Resource Bounds

V1 MUST hard-bound:
- repeated attempts;
- Reviewer correction cycles;
- Critic invocations;
- parallel workers;
- model request count or equivalent available execution counter.

Per-request token ceilings may be applied through OpenCode session hooks.

Exact monetary hard-stop enforcement is optional until OpenCode exposes reliable server-side cost accounting to the Loom plugin. Resource exhaustion still produces an honest resumable state.

## Storage

Workflow state must be project-scoped and inspectable.

Project scoping is a mechanical isolation boundary, not a naming convention. Every mutable execution record resolves through the caller's current project identity before workflow/session identity. Session bindings, work hierarchy, OQs, evidence, scopes, budgets, Product Acceptance, knowledge, and intent state must not be addressable across projects merely because a local identifier matches.

The detailed execution namespace, membership, migration, and concurrency contract is defined in [Runtime Isolation](runtime-isolation.md). The external read-only publication contract is defined separately in [Dashboard Observability](dashboard-observability.md).

Do not store accepted product authority only inside plugin storage.

## Satisfies

- [BR-001](../../requirements/loom/br-001-run-autonomously-to-real-boundary.md)
- [BR-002](../../requirements/loom/br-002-route-missing-expertise-explicitly.md)
- [BR-005](../../requirements/loom/br-005-prevent-implementation-inventing-meaning.md)
- [BR-007](../../requirements/loom/br-007-evidence-outranks-model-claims.md)
- [BR-008](../../requirements/loom/br-008-bounded-autonomy-and-progress.md)

## OpenCode Basis

OpenCode V2 plugins expose agent/tool transforms, session hooks, permission hooks, durable JSON storage, custom tools, and session operations.

- https://opencode.ai/v2/docs/build/plugins
- https://opencode.ai/v2/docs/permissions


## Progress and dispatch budgets

Loom enforces a small execution budget independently of agent prose.

Initial defaults:
- total subagent dispatches per workflow: 40;
- ordinary step dispatches: 3;
- Reviewer dispatches per gate: 3;
- Critic dispatches per gate: 2;
- automatic material-progress grants per target: 3;
- provider retries after the initial request: 2.

Permission hooks count authorized subagent dispatches using stable tool-call identity where available. A dispatch that exceeds its bound is denied.

Reopening failed work requires at least one explicit progress dimension: new evidence, changed hypothesis, changed strategy, or reduced unresolved work. The reopen reason is persisted. `loom_budget_grant` uses the same progress rule and remains bounded by the automatic per-target grant cap.

Automatic exhaustion is a resumable control-plane boundary, not permanent abandonment of the accepted work. When the user explicitly asks Loom to continue, General may call `loom_budget_continue` for the exact exhausted runnable step or agent-owned OQ. The tool accepts exactly one exceptional target-reserved dispatch. Before granting it, Loom compares `confirmation` with the latest observed user message in that General session and records that user-message ID; the same user message cannot authorize another continuation. Other runnable targets cannot spend the credit. The continuation preserves dispatch history, evidence, scopes, workflow identity, verification requirements, and downstream independent gates. It does not require a fabricated progress signal for that single attempt and does not create a replacement Task or workflow.

User-authorized continuation is distinct from autonomous retry and does not waive the progress governor for later attempts. A later retry still requires material progress through the ordinary grant path when that capacity remains, or a fresh explicit user message after automatic recovery is exhausted. Agents cannot self-extend, silently widen limits, batch several no-progress retries from one user turn, turn incomplete work into PASS, or use continuation to waive evidence/authority requirements. After continuation, General rechecks status, issues the normal exact dispatch grant, and sends a fresh child context to the same owner/step.

For same-agent parallel work, `loom_dispatch_grant` prevents normal operation from creating grants for **different** unadmitted targets of the same role; the first target must be launched/admitted before a grant is issued for its sibling. Multiple grants for the same exact target remain valid because they share one budget identity and are used by lifecycle recovery for independent child attachments. The subagent permission hook independently resolves the charged target from the exact usable dispatch grant rather than from runnable-step ordering. If legacy/corrupt state nevertheless contains usable grants for more than one target of the same agent, it fails closed as ambiguous. When a subagent launch is admitted, that exact grant leaves the target-selection pool while remaining consumable by the launched child, so General can issue the next same-agent target grant and retain real parallel execution without confusing budget identity.

These are safety defaults, not product semantics. Later configuration may tune them, but agents may not silently widen them during a run.


## Durable holistic Plan

For Objective-depth work, Planner produces a durable structured Plan before the executable Worker DAG is admitted. The Plan is a control-plane model, not a required Markdown report.

The Plan retains enough shared context for General and fresh child sessions to reconstruct both the whole-product picture and a Task's place inside it:

- goal, assumptions, out-of-scope boundaries, and accepted authority references;
- an obligation coverage map with source, disposition, owning Tasks, verification, and deferral authority where applicable;
- Phase → Wave → Task structure;
- material risk boundaries and whole-product acceptance coverage; executable Product Acceptance scenarios remain owned separately by `loom_pa_plan`;
- cross-Task relationships and correction routing;
- Task rationale, authority references, inherited constraints, acceptance criteria, non-executable subtasks/checklist, integration context, and verification expectations; risk/acceptance ownership is represented canonically by Plan-level records that reference Tasks.

Each materialized generation has a stable identity and immutable revisioned semantic history. `loom_work_amend` advances the current Plan revision for bounded atomic changes to pending/unclaimed Plan regions and records an amendment audit entry plus inverse delta. Loom retains one full current snapshot per generation and reconstructs prior revisions from those deltas instead of duplicating the entire Plan for every small edit. It cannot rewrite semantic context already consumed by completed work.

When the decomposition premise is no longer trustworthy, or the desired change would retroactively change completed meaning, Planner uses `loom_work_invalidate`. The invalidated generation remains historical but unfinished nodes become non-runnable; `loom_work_plan` then creates a fresh generation.

`loom_work_status` exposes the full current Plan. `loom_attach` exposes a role-appropriate projection:

- Worker gets the focused Task contract plus parent Plan map/context, including durable completed-predecessor summaries and evidence-claim IDs;
- Reviewer/Critic get the broader Plan needed to distinguish local conformance from decomposition/coverage failure;
- any Loom role answering a planned-task OQ gets the originating Task plus surrounding **historical Plan revision**; non-Task raisers may name an existing current-generation Task and Loom validates the correlation; Reviewer/Critic OQ answers are not gate verdicts;
- simple Task-depth work without Planner continues to use the committed request directly.

The control plane distinguishes `taskOutcome` from the broader accepted outcome/authority. Planner wording may bound execution but cannot replace accepted product meaning.

Model-facing Plan projection is intentionally bounded even though durable Plan state remains complete. Whole-Plan context uses a compact Phase/Wave/Task map, clipped summaries, bounded ownership/reference lists, and recent amendment history; it does not duplicate the full rich Task tree. Focused Worker/OQ context retains the exact bounded Task contract. Reviewer/Critic receive the bounded holistic map and inspect exact current-Wave contracts on demand with `loom_task_status`, avoiding eager multi-Task context expansion. Omitted-count metadata makes truncation explicit rather than silently implying completeness.

## Semantic upgrade actions

Not every breaking control-plane change can be migrated mechanically. Loom therefore separates deterministic runtime-schema upgrades from semantic compatibility actions.

Runtime version 4 fences older writers but deliberately does not invent rich Plan semantics for pre-v4 Objectives. `plugins/loom/upgrade-actions.ts` derives `holistic-plan-adoption-v1` when an active current generation lacks a holistic Plan snapshot and still has claimed or unfinished implementation work. A legacy Objective whose implementation work is already complete is not reopened solely to migrate Plan representation while its remaining final documentation/acceptance gates finish.

The action is Objective-scoped and state-derived:

- while it exists, only the owning coordinator/General context receives a short instruction to call `loom_upgrade_status`;
- the detailed one-shot procedure stays behind that read-only tool rather than permanently consuming model context;
- a claimed legacy Wave keeps its admitted contract and reaches its normal review boundary; Task-linked peer OQs remain usable during that deferred period, carrying bounded legacy Task context without fabricating a rich Plan;
- adoption occurs at the next natural Planner boundary, not by reopening reviewed work solely for migration;
- a fresh Planner attachment receives the pending action automatically;
- creating a valid rich Plan snapshot satisfies the condition, so the action disappears for all sessions on that Objective without an acknowledgement call.

This mechanism is intended for future reasoning-required compatibility changes as well: detection belongs to Loom state, execution instructions belong to the action, and completion is proved by authoritative state whenever possible.

## Executable task DAG

Non-trivial product workflows contain a `plan` step owned by the disposable Planner context.

Planner registers a bounded task graph for the current work scope. For Planner-driven product work, the graph is also materialized under the persistent Objective/Phase/Wave/Task hierarchy described in [Hierarchical Work Model](work-hierarchy.md). Planner does not own or redefine Objective meaning.

For new Objective workflows, compiling the executable DAG does **not** claim the Wave. The Planner completes `plan`, then an independent Reviewer-owned `review-plan` gate inspects the persisted holistic Plan together with the exact executable Task contracts, including write scopes and verification expectations. Only a PASS causes the control plane to claim the selected Wave and make its Worker Tasks runnable. FAIL leaves the Wave unclaimed so Planner can amend/recompile the unconsumed Plan safely. Pre-`review-plan` in-flight workflows retain their historical claim behavior for compatibility; an independent assessment can be obtained through a Reviewer OQ without treating that answer as a gate verdict.

V1 validation requires:
- at least one task and no more than 24;
- stable unique task IDs;
- known acyclic dependencies;
- at least one verification expectation per task;
- bounded project-relative write scopes;
- no Worker authority over accepted Anchor, design, requirements, or architecture;
- no parallel tasks with potentially overlapping write surfaces unless dependency ordering makes them sequential.

Accepted tasks become real workflow nodes named `task:<id>`. In reviewed Objective workflows those nodes depend on `review-plan`, so merely compiling them cannot authorize Worker execution.

Each task carries:
- objective;
- dependencies;
- immutable write scope;
- suggested skills;
- verification expectations.

`review-implementation` depends on completion of every planned task.

The executable DAG is execution structure, not product authority. Changing product meaning still routes to Designer, Specifier, or Architect.

Once task execution starts, completed or claimed Task meaning is not destructively rewritten. Planner may surgically revise untouched pending/unclaimed Plan regions within the same generation by appending a new immutable revision when the current generation remains valid. Executable Worker freshness is fenced by the selected Wave's semantic fingerprint, not by the Objective-global Plan revision, so unrelated concurrent Waves remain valid. A broader semantic change invalidates the generation and creates a new hierarchy/Plan generation; completed historical nodes remain immutable, and carry-forward requires control-plane validation that scope, authority, prerequisites, and verification meaning remain materially equivalent.

## Worker task scopes

For planned product work, the validated task DAG creates each Worker scope mechanically. General cannot widen a planned task's scope ad hoc; changing it requires reopening planning.

For the simple non-product `worker` path, General may declare a bounded scope directly.

Repository-wide wildcards and accepted authority roots (`docs/anchors`, `docs/design`, `docs/requirements`, `docs/architecture`) are rejected.

The Worker child session must attach to the exact currently runnable workflow step before editing. Attachment returns the task envelope for planned work.

For every Worker edit permission evaluation, Loom checks the requested resource paths against the attached task scope and denies any edit outside that scope.

This V1 boundary governs OpenCode edit/write/apply-patch permissions. Arbitrary shell side effects are not path-contained by Loom and remain separately restricted through the Worker shell policy.


## Worker shell boundary

OpenCode shell commands run with the host user's authority, so Loom does not treat shell as equivalent to scoped edit tools.

Worker shell permission is restricted to a conservative inspection and verification allowlist. Compound commands, redirection, common write/fix flags, dependency installation, and arbitrary script execution are denied in V1.

External-directory access is denied for Worker.

This is intentionally restrictive. Mutation-heavy shell operations need a later controlled capability with stronger containment rather than a broader generic shell permission.


## Living-knowledge synchronization

Product workflows and structural maintenance include a `knowledge-sync` step after implementation review.

Documenter may update only current-reality knowledge surfaces:
- `docs/system/**`;
- `docs/user/**`;
- top-level `README.md` when setup/use materially changed.

Normative Anchor, requirements, design, and architecture remain owned by their existing authorities.

Before `knowledge-sync` may complete, Loom requires a structured knowledge report backed by an observed successful OKF-MCP discovery or verification call from the attached Documenter session.

A valid report either names changed knowledge documents or records a concrete reason why existing knowledge remains accurate.

If upstream work is reopened, the knowledge report is invalidated automatically and must be re-established before final product review.


## Intent and Anchor boundary

Intent shaping is tracked separately from autonomous workflow execution.

An intent session records:
- the original fuzzy request;
- the single currently-open user question, if any;
- recommendation and rationale attached to that question;
- resolved decision branches with source `user`, `repository`, or `research`;
- evidence references for non-user resolutions;
- the draft-ready Anchor summary;
- the accepted Anchor path and exact user acceptance confirmation.

The control plane refuses a second simultaneous user question and refuses repository/research resolutions without evidence references.

`loom_start` refuses autonomous execution while the active intent session is unresolved. When the accepted Anchor starts its workflow, the session's active-intent pointer is cleared while the durable interview record remains auditable.


## Workflow cancellation and reviewed completion

`loom_cancel(workflowId, reason, confirmation)` is a General-only lifecycle transition; `confirmation` records the exact explicit user request. The caller must be the workflow's persisted creating/owning session in the same project. A first cancellation of active unreleased work also requires its current binding. The owning General can cancel a failed-terminal or explicitly released historical workflow after rebinding, without changing the replacement. Repeating a completed cancellation returns the original record. Fully successful terminal workflows remain no-ops; a failed-terminal workflow still requires cancellation cleanup, retaining every failed gate verdict unchanged.

`plugins/loom/lifecycle.ts` owns cancellation and reviewed-history recovery. Under the existing ordered workflow/work locks and SQLite transaction, cancellation releases only claims naming that workflow (including stale-generation claims), revokes its unused grants, stores a cancellation record, and records the parent binding release. It leaves all step outcomes, evidence, review reports and product files intact. Missing hierarchy state is recorded and does not block cancellation; foreign ownership is reported and retained. Failure at any write rolls back the whole transition.

Cancellation is a durable terminal marker, not a new step result. `runnable` becomes empty; normal workflow mutations, grant issuance and grant consumption reject it. Native and Code Mode tools share the same admission fence, and commit-time checks reject calls racing cancellation. Old child sessions cannot admit further host/MCP tools or edit/shell/delegation permissions, including non-Worker roles. Read-only Loom history is available; only a fresh exact attachment grant can authorize a reused child on a different active workflow. The owning General conversation may start new work under its normal permissions.

These checks cannot undo a host/external tool already admitted before cancellation. Its later return may be stored as passive session history but cannot complete the cancelled workflow or become new governed proof for it. Cancellation does not terminate remote processes, roll back files, close unfinished verification, or accept the Objective.

Wave completion and workflow completion are distinct. Passing `review-implementation` stores an exact reviewed-Wave receipt (workflow, generation, executed Task IDs, full reviewed Task set and time) and ends the live claim. Later gates and knowledge sync validate that receipt rather than requiring or recreating the claim. Task writes still require live ownership. An implementation reopen can reacquire its own reviewed Wave only if no downstream Wave has already consumed it; documentation-only reopen does not reacquire it.

Runtime version 4 fences version-3 and older writers before semantic Plan adoption. Existing records are not discarded. Legacy completed Waves without a receipt are recovered lazily under the same transaction only when exactly one persisted workflow proves the matching completed Tasks and passed independent implementation review. Ambiguous or mismatched history fails closed; cancellation remains the non-destructive escape from that workflow, not a way to invent review proof.


### Recovery and evidence admission

For a cancelled child, the Code Mode outer `execute` surface admits only one direct call: `return await tools.loom.code.<tool>(<JSON object>)`. `<tool>` must be `attach` or an existing read-only history/inspection tool; `verification` must have `action: "status"`. Arguments are JSON data, not expressions. No extra statements, spreads, computed properties, prototype keys or arbitrary programs are admitted. The inner tool retains its ordinary schema, project, owner and exact-grant checks. This narrow outer route never itself grants attachment authority.

Tool proof is scoped at admission, not assigned from the session at return. The observer captures workflow, step, step attempt, agent and a durable attachment epoch before execution. Every successful attachment rotates the epoch, even on the same step. Reopening advances affected step attempts; replacing pending routing/plans advances their attempts too. The observation key includes session, message, call ID and tool, in a per-plugin-instance bounded tracker.

At return, Loom serializes attribution with workflow transitions and checks the original attachment and attempt. Closed/cancelled work, rebinding, changed event inputs/actor, missing admission, duplicate in-flight IDs, tracker eviction or observer restart cannot acquire new proof scope. The result retains its known admission origin as passive history. Evidence claims, verification proof and knowledge reports reject observations from another workflow or attempt. Historical scoped records predating admission metadata remain readable and can be consumed only before their step is reopened into a new attempt. Acceptance claims also carry the originating attempt, so an already-minted claim cannot bypass the raw-observation check after reopening. Existing records are not retroactively rewritten or promoted.

Already admitted host operations are not killed by this observer. A late result cannot become replacement-workflow proof, even when the same child legitimately attaches to the replacement before the result arrives.
