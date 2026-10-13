---
type: design
title: Loom Execution Model
description: Agent roles, worker contexts, routing, and skill use inside OpenCode.
tags: [architecture, loom, agents, routing, skills]
---

**Status:** architecture direction; supported role-safe Plan execution is implemented and independently reviewed on this branch. Bounded `loom_roster` discovery for General and Planner exposes current host names/descriptions with separate plugin-owned advisory planning insights; Brainstorm advisory OQs are supported. Provider-free mock-host checks cover these paths, not actual installed-host behavior or full Objective acceptance. Universal all-subagent Task routing remains incomplete. This branch state does not establish merge, CI, or release.

## Agent Set

Loom's repository is the global OpenCode config directory. Agent files therefore live directly under `agents/`, plugins under `plugins/`, skills under `skills/`, and commands under `commands/`.

### Primary

- **Loom** — the single user-facing conversational engineering partner. The current OpenCode compatibility identifier is `general`.
- Loom owns exploration, sparring, ordinary problem-solving and synthesis, investigation, the execution transition, autonomous routing, and continuity with the user.
- **brainstorm** is an available fresh subagent used for advisory ideation; it is not a second primary user mode. For appropriately typed planned work, its bounded output is alternatives, assumptions and trade-offs for the accountable authority to assess, never an accepted decision or generic producer result. Brainstorm advisory OQs have an exact grant/attachment/answer path; planned Brainstorm Tasks remain unsupported. An advisory answer does not complete a Task or resolve the receiving role's authority.
- **research** and **diagnostic** may be used during conversation for bounded fresh-context investigation without implying product mutation. They extend Loom's reasoning; they are not separate user-facing modes.

### Authority subagents

- **designer** — human-facing behavior and implemented-experience validation.
- **specifier** — behavioral requirements and guarantees.
- **architect** — components, interfaces, persistence, lifecycle, protocols, and technical realization.
- **reviewer** — normal independent artifact and implementation review.
- **critic** — holistic adversarial review and exceptional cross-domain adjudication.

### Execution subagents

- **worker** — implementation and bounded technical work.
- **research** — sourced investigation and external knowledge.
- **diagnostic** — root-cause investigation.
- **acceptance** — executes real end-to-end Product Acceptance scenarios and records observed proof.
- **planner** — disposable decomposition context that turns an accepted Objective into Phase/Wave/Task decomposition. Current branch code supports role-bound Tasks for a bounded set of producer roles, Reviewer review Tasks, and user-decision waits; Planner is not yet a supported planned Task recipient. A future Planner-owned Task must be bounded planning/replanning work, not generic execution or a second product authority.
- **documenter** — maintains current system/user knowledge after implementation changes and verifies it through OKF.

Planner is an execution context, not a product authority or gate owner. Objective identity and completion meaning come from accepted authority before Planner. Planner may decompose inside that Objective, but may not redefine it.

### Discovery and task-path admission

General and Planner should receive a current view of available OpenCode subagent names and descriptions, plus Loom-owned planning insights about appropriate responsibilities and known path constraints. Prefer `.loom` configuration for the advisory insight registry rather than changing agent definitions; do **not** add custom `loom:` frontmatter to OpenCode agent files (unknown fields are forwarded as provider options). The roster comes from the host's actual agent availability, not a static list or the advisory registry. Insights may prioritize candidates or warn of limits, but neither roster presence nor metadata is permission, task-path support, gate proof, or an allowlist. Missing insight for an available Loom subagent must not make the role categorically ineligible.

The control plane validates a selected role against the **specific** Task kind or OQ responder path, current host availability, role authority and permissions, dependencies, independent gates, and the Plan binding at admission and again at dispatch/completion as relevant. Every available Loom subagent, including Planner, is eligible for a suitable planned Task and OQ after its role-native path is implemented and validated. A role without such a path remains a visible planning/admission blocker, not a Worker assignment. Answering an OQ is a narrow role-owned response, not completion of a Task or an independent review verdict. See [Role-Safe Plan Execution](role-safe-plan-execution.md) for the proposed extension and the current supported-role boundary.

For Planner-driven product work, the control plane materializes Planner output into persistent Objective/Phase/Wave/Task work state plus the executable dependency DAG. Workflow state remains the bounded execution view over that work. A separate Plan document is not required unless the product itself needs one.

## Professional autonomy

Loom separates **hard governance** from **professional judgment**.

The control plane owns non-negotiable boundaries: permissions, accepted authority, workflow state, mutation scopes, grants, evidence provenance, budgets, and independent gates. Those boundaries should be mechanically enforced where practical rather than duplicated as long prompt procedures.

Agent directives are intentionally **slim professional charters**:

- General delegates outcomes, constraints, authority, and evidence; ordinary specialist method belongs to the specialist.
- Designer owns human-centered realization; Specifier observable semantics; Architect technical realization; Worker implementation; Diagnostic causal investigation; Research evidence strategy; Planner decomposition; Documenter knowledge representation; Acceptance scenario strategy; Reviewer independent conformance; Critic adversarial attack.
- Authority boundaries constrain what a specialist may **decide or mutate**, not what it may **notice, inspect, or understand**. A mutation scope is not a knowledge scope.
- Specialists own normal self-correction inside their domain and should prefer the smallest complete result that preserves unrelated valid behavior.
- A producer cannot honestly complete while it knows a load-bearing part of its assigned outcome is unmet. It returns the precise scope/authority/capability boundary instead.
- Reviewer is an independent gate, not the normal discovery loop. For a clear bounded Task after any required diagnosis/factual resolution, the healthy target is one competent Worker pass followed by one independent Reviewer pass; retries represent new evidence, not routine convergence.
- When Reviewer is the governed acceptance gate for durable requirements, design, or architecture, a PASS owns the narrow lifecycle transition that records that acceptance. Semantic authorship stays with Designer/Specifier/Architect; Reviewer may change only acceptance status/metadata and the matching repository acceptance history, not substantive meaning.
- Reviewer and Critic may identify or raise authority gaps. Any named Loom role, including Reviewer and Critic, may answer a question **within its own domain**; an OQ answer by a gate role is not that role's independent gate verdict and does not transfer producer authority. Product-meaning questions return to the actual product/design/behavior authority, structural questions to Architect, and mutation-scope coordination to General.

Reusable detailed methodology belongs in skills. Coordinator prompts and agent charters should not micromanage that methodology or accumulate repository-specific incident rules. Cross-cutting mechanics that do not define a profession—such as ephemeral report formatting/validation and durable learning bookkeeping—belong in shared on-demand skills rather than repeated role prose.

This model resembles delegation to experienced human professionals: **strict organizational and safety boundaries, broad judgment inside the role**.

### Objective/Wave scoping

Objective closure is a control-plane fact once Planner has materialized persistent work. When General omits the optional `workLevel` override, Objective routing begins conservatively at Wave scope so whole-product gates are not exposed before decomposition is known. At `loom_task_plan`, persistent work determines the real scope:

- more than one active Wave remains → stay Wave-scoped;
- exactly one active Wave remains → upgrade the workflow to Objective scope and add Product Acceptance, product review, Designer validation when applicable, and final Critic.

The transition preserves matching upstream step state and attempt identity. General follows persistent work state rather than predicting this internal lifecycle flag.

## Fresh Context

Authority and execution subagents run in fresh OpenCode child sessions.

Only the minimum required context is passed:

- objective and bounded Plan/Task context where applicable;
- Anchor;
- relevant accepted authority;
- relevant OQs;
- task scope;
- evidence references;
- allowed skills;
- completion proof.

Large workflow history is not copied into every child context.

## Explicit Routing

Loom does not rely only on prompt memory to decide whether expertise is required after execution begins.

Before dependent work, the control plane records required capabilities.

Typical mapping:

| Meaning affected                               | Required capability |
| ---------------------------------------------- | ------------------- |
| human-facing behavior                          | Designer            |
| observable behavior / guarantee                | Specifier           |
| topology / interface / persistence / lifecycle | Architect           |
| implementation                                 | Worker              |
| external factual uncertainty                   | Research            |
| unexplained failure                            | Diagnostic          |
| assembled-product proof                        | Acceptance          |
| product implementation decomposition           | Planner             |
| implemented-system knowledge sync              | Documenter          |
| normal independent check                       | Reviewer            |
| whole-solution challenge                       | Critic              |

The coordinator may propose classification. The control plane prevents dependent stages from proceeding when recorded prerequisites are incomplete. The mapping above names expertise, **not** a claim that every role has a currently implemented planned Task route. The supported role-safe subset and bounded live roster/advisory discovery are present on this branch; planned Brainstorm, Planner, Critic and Acceptance Tasks remain unsupported. Discovery does not grant a missing path or establish actual installed-host or full Objective proof.

## Skills

Skills provide methodology, not authority.

A worker receives only a small relevant set. Skills are loaded on demand through OpenCode's native skill mechanism.

Examples:

- Go implementation;
- concurrency;
- database migrations;
- OAuth;
- browser/UI testing;
- documentation;
- security testing.

Skill selection should later be informed by measured effectiveness, not by loading every plausible skill.

## Permissions

Each named agent has a restrictive default permission profile.

Examples:

- Reviewer and Critic cannot edit product code. Reviewer may edit `docs/requirements/**`, `docs/design/**`, and `docs/architecture/**` only for governed acceptance bookkeeping after a PASS; substantive authority edits remain producer-owned.
- Specifier cannot edit implementation.
- Architect cannot implement.
- Worker cannot edit accepted Anchor, design, requirements, or architecture. Current-reality system/user documentation belongs to Documenter; documentation work does not grant Worker normative-authority writes.
- Research has web/read tools but no product mutation.
- Diagnostic may inspect and experiment but does not silently ship fixes.

Task-specific worker write boundaries are additionally enforced by the control plane.

## Model Independence

Reviewer should differ from the producer in context.

Critic should use a different model from the primary producer where practical and always receive fresh adversarial context.

Different-model independence is preferred for holistic review, but absence of a second provider must not make Loom unusable.

## Satisfies

- [BR-002](../../requirements/loom/br-002-route-missing-expertise-explicitly.md)
- [BR-003](../../requirements/loom/br-003-resolve-technical-unknowns-before-user.md)
- [BR-005](../../requirements/loom/br-005-prevent-implementation-inventing-meaning.md)
- [BR-006](../../requirements/loom/br-006-independent-review-and-selective-critic.md)
- [BR-012](../../requirements/loom/br-012-prefer-deep-modules-and-remove-obsolete-code.md)
- [BR-013](../../requirements/loom/br-013-diagnose-root-causes.md)
- [BR-014](../../requirements/loom/br-014-support-deliberate-sparring.md)
- [BR-020](../../requirements/loom/br-020-conversation-is-primary-interface.md)

## Conversation and intent interviewing

Conversation precedes workflow. Loom may discuss ideas, compare alternatives, research, or diagnose without starting an intent session.

Loom loads the `intent-grilling` skill only after the user has committed to execution and product intent remains unresolved.

The interview follows four runtime-enforced rules:

- one unresolved user question at a time;
- every user question carries a recommended answer and short rationale;
- repository/research-answerable branches are resolved with evidence rather than sent to the user;
- execution cannot start while the active intent session is unresolved.

The interview is ready to draft an Anchor when Goal, observable success, scope, exclusions, user-owned decisions, and important context are clear enough that no unresolved user-owned branch would materially change them.

For a newly grilled or still-materially-ambiguous outcome, the user explicitly accepts the complete Anchor before autonomous execution begins.

When prior conversation already resolved the material outcome, a clear build/fix/apply commitment accepts only that established meaning. Task and Change may start request-backed without a new Anchor. Objective depth requires accepted product authority; where a new Anchor is needed, Loom captures the resolved conversation faithfully and records the exact commitment without a second routine confirmation. Newly discovered user-owned meaning remains unresolved until properly accepted.

## Composition with execution depth

[BR-019](../../requirements/loom/br-019-keep-workflow-ceremony-proportional.md) owns Task / Change / Objective routing after execution is warranted. [BR-020](../../requirements/loom/br-020-conversation-is-primary-interface.md) owns the primary conversation and its transition into that model.

Conversation is not a fourth workflow depth. Ordinary advice/research/diagnosis may remain outside durable state. Explicit tracked read-only verification uses `implementationRequested=false`; bounded implementation uses Task or Change; only Objective entails full decomposition and whole-product acceptance.

The existing control plane owns grants, terminal-state recognition, permissions, and evidence provenance. A started-but-unrouted workflow is non-terminal. Conversational observations may inform later work but cannot be retroactively attached as governed proof; evidence is associated with the exact active step when observed.
