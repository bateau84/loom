---
type: component
title: Loom Agent Runtime
description: Judgment roles and disposable execution contexts used by Loom.
tags: [component, loom, agents]
---

# Agent Runtime

## Primary Context

- **Loom** is the single user-facing primary agent. The current OpenCode compatibility identifier is `general`.
- Loom owns the continuing conversation across exploration, ordinary problem-solving, investigation, and execution.
- `brainstorm` is an optional fresh subagent for independent ideation, not a second user-facing primary mode.
- `diagnostic` and `research` may be used as fresh-context conversational investigation capabilities without implying permission to implement. They remain bounded internal capabilities rather than user-facing personas.

## Optional Loom runtime

The `agents/*.md` definitions contain portable professional expertise and OpenCode mode only. They do not require Loom tools or encode Loom permissions. With Loom disabled, these agents run with the host's normal policy and may perform ordinary authorized work.

When Loom is enabled, `plugins/loom/agent-contracts.ts` loads `plugins/loom/contracts/shared.md` and exactly one `contracts/<role>.md` for each registered role. Missing or empty files fail plugin setup instead of silently dropping governance. The plugin's `ctx.session.hook("context")` injects shared and role-specific guidance for known roles. Other agent types receive the shared contract only, so the host's available custom agents can understand Loom's tools without silently receiving another role's authority. A `ctx.agent.transform` provides the previous Loom role permission rules through OpenCode's agent registry only while the plugin is loaded. Loom's runtime permission and step-admission checks remain separate and authoritative.

`loom_status` exposes candidate `nextActions` to General based on live step dispatch admission. Candidates do not prove that a child is idle and cannot bypass grant/dispatch checks; status must be refreshed after child return or state changes. Detailed tool contracts define prerequisites and rejection behavior. Do not duplicate the workflow in portable role prompts.

### Instruction migration inventory

The split preserves two distinct layers. The portable `agents/*.md` retain professional judgment, methods, role identity, review independence, user communication and end-to-end responsibility. The enabled-only `plugins/loom/contracts/shared.md` retains tool discovery, dashboard/status, exact workflow admission, Git and command elevation, and policy precedence. Per-role runtime contracts retain the former Loom-specific responsibilities:

| Role | Migrated Loom-specific responsibility |
| --- | --- |
| General | Intent, orchestration, scope, dispatch, budgets, cancellation, recovery and persistent follow-through |
| Worker | Task/Plan attachment context, skill loading, scope discovery, evidence and Git delivery |
| Reviewer | Independent gate methodology, repair/re-review separation and acceptance bookkeeping |
| Critic | Solution/final gates, adversarial QA, premise checks and evidence-based verdicts |
| Acceptance | Executable acceptance plans, immutable scenario outcomes and PASS authority |
| Planner | Holistic Plan ownership, decomposition, Wave/Task contracts and readiness |
| Architect | Governed architectural authority, verification and completion |
| Designer | Governed design output, design implementation and completion |
| Specifier | Governed behavior/requirements output and completion |
| Research | Governed source/evidence reporting and completion |
| Diagnostic | Governed causal investigation and disposable sandbox boundaries |
| Documenter | Current-reality knowledge, discovery and record of updates |
| Brainstorm | Advisory Task/OQ contracts, no decision ownership |

Host OpenCode configuration owns the default agent and standalone permissions when Loom is disabled. No Loom policy is injected into these portable agent files. `scripts/test_ci_optional_agent_contracts.py` checks representative migrated contract invariants; the real host integration smoke test creates a separate OpenCode project with **no Loom plugin** and exercises agent discovery, General's read/delegation and Worker's edit/shell operations using host permissions. The real-host test proves these paths, not every role's real-world capability.

## Authority Contexts

- Designer — human-facing meaning.
- Specifier — observable behavior and guarantees.
- Architect — structural realization.
- Reviewer — normal independent verification.
- Critic — rare holistic adversarial review.

## Execution Contexts

- Planner — implementation decomposition only.
- Worker — bounded implementation.
- Research — sourced factual investigation.
- Diagnostic — root-cause investigation.
- Acceptance — real end-to-end product proof.
- Documenter — current system/user knowledge maintenance.

Each subagent runs fresh and is given only its bounded objective/context.

## Routing discovery

General and Planner use `loom_roster` for current host agent names/descriptions and a separate `planningInsights` advisory view. Each call asks the host for the current worktree; the roster is not filtered by Loom role names or advice availability. The response bounds the roster to 200 agents (with `truncated`), names to 128 characters and descriptions to 2,000. Advice is plugin-maintained in `plugins/loom/planning-insights.ts`, keyed by exact live name, with at most 200 hints and 1,000 characters per native-work/caution field. Missing, malformed, or stale entries contribute no hint and never remove a host agent; advice for a truncated name is omitted rather than matched ambiguously.

The advisory table is not a duplicate installed-agent registry, a permission source, a Task contract, or a native-path descriptor. No external `.loom` advice registry is read by this increment, and no custom agent frontmatter is used. Runtime Task/OQ validation remains separate. Brainstorm advisory OQs are supported; planned Brainstorm, Planner, Critic and Acceptance Tasks remain unsupported. Provider-free mock-host boundary tests verify this discovery increment; they do not prove actual installed-host behavior or full Objective acceptance.

When a shared OQ answer becomes durable, Loom sends a best-effort synthetic steer to the latest session attached to each current consumer step attempt. The wake-up carries only correlation, not answer authority: the child re-reads persisted OQ state and reconciles it before completion. Same-attempt redispatch replaces the session pointer, and reopened attempts use a different pointer, so stale child sessions are not revived. General treats that runtime wake as the first continuation attempt and does not launch a parallel continuation merely because the answer arrived. Recovery is consumer-specific and follows fresh current-state/delivery evidence; when delivery status is genuinely unknowable, the answered OQ remains a resumable incomplete boundary rather than being guessed into a duplicate dispatch.

## Repository execution and delivery

Loom derives ordinary repository capability from the already-attached role; it does not issue a second per-command grant.

- **Worker** may inspect, build, test, and run within its execution policy. Its Task write paths are a starting expectation; when implementation discovery finds another project-local mutation target, Worker calls `loom_scope_elevate` and continues immediately when `continue=true`.
- **Designer, Specifier, Architect, Documenter, Worker, and other attached producer roles** mutate product files only under the exact current step attempt and current effective Loom write scope. Role artifact paths are defaults for expected work, not hidden hard file ceilings. Crossing a role default is recorded as scope activity for General/review visibility.
- **Structured edit hard-boundary writes** outside the project, through a symlink escape, or into repository-internal state return `continue=false`. The child stops; only the exact user **Allow once** decision can authorize those edit paths for that step attempt. An elevated shell command is a separate audit-only exception whose effects Loom cannot confine or validate.
- **Git delivery follows product write authority.** Loom records exact admitted file fingerprints per step attempt. Those exact bytes may be staged/committed; a fresh session on the same attempt can use durable provenance, including exact already-staged bytes, without a separate adoption tool. The shared repository index admits one coherent staged owner set at a time: unrelated staged entries from another Loom session or external actor block new staging before Loom changes the index. Untouched, unproven, or subsequently changed dirty bytes remain ineligible.
- **Ephemeral reports** are a separate output class: producer-scoped and intentionally non-committable. Durable retention uses report promotion. A narrow delivery-only exception lets a role that currently owns committable repository work compose a long Markdown commit message under `ephemeral-reports/<role>/commit-messages/<name>.md` and pass that exact current-session-authored, unchanged regular file to hookless `git commit -F`. The scratch file never becomes stageable product output, and another role, stale session/attempt, pre-existing file, changed file, symlink, or hardlinked file cannot supply the commit message. Successful use consumes the scratch file and invalidates its session ownership so a later commit must write a fresh message.
- **Diagnostic** may inspect, build/test through the existing verification allowlist, and inspect Git/PR/CI state conversationally. Arbitrary project execution remains governed because raw project code can have host/external side effects.
- An attached governed **Diagnostic** may create a disposable experiment sandbox: Loom snapshots the current working-directory bytes without host `.git` metadata or Loom's `.loom/project-id` marker, mounts that copy read/write plus a separate Loom-owned baseline read-only into ephemeral Podman/Docker executions, and may explicitly select host networking. The real project is never mounted. Images must already be local; Loom resolves the requested reference to an immutable local image ID at sandbox creation and all later experiments execute that ID. Execution overrides image entrypoints, drops capabilities, clears proxy-environment inheritance, and uses a read-only container root. Sandbox changes persist only inside the experiment copy and never create product/Git delivery authority. Sandbox identity is durably preregistered before project bytes are copied so process death leaves partial snapshots discoverable for later cleanup; create/execute/diff/destroy serialize per sandbox across processes. Materialization records the private baseline Git tree hash and rejects source drift during capture so causal evidence is bound to one exact snapshot instead of a torn concurrent view. Governed Diagnostic completion fails closed until its active sandbox is destroyed; workflow cancellation attempts sandbox cleanup and surfaces cleanup failures explicitly. Sandbox execution/diff results enter Loom's evidence ledger with safe outcome metadata for later causal review.
- Dangerous broad staging, plain force-push, arbitrary shell composition, and PR merge remain blocked unless a separate explicit capability authorizes them.

`loom_complete` rejects admitted product changes that remain uncommitted. Reopen/reroute advances the step attempt, so prior-attempt write/Git provenance cannot silently carry into new work.


## User-owned shell and write whitelist (global → worktree)

The optional global policy is `~/.config/opencode/.loom.yaml` (or `$XDG_CONFIG_HOME/opencode/.loom.yaml`). If the current working-directory root has its own `.loom.yaml`, **that entire local policy replaces the global policy** for this worktree, including both command and write whitelists. This is useful for independent PR worktrees. An invalid or unsafe worktree file suppresses global whitelist grants rather than silently falling back. Deleting it restores the global defaults. Rules are re-read for every authorization and execution preflight.

Call `loom_policy_status` to inspect the active source, parse errors, shell rules, and role-write paths. Ordinary built-in Loom policy remains intact. Whitelists grant bounded additional access only to the current executable step, never to stale steps or advisory-only OQ attachments. `loom_command_elevate` remains an explicit one-use audit escape hatch for commands not eligible for routine or configured admission. See [Global and worktree permissions](../local-permissions.md).

## Project verification commands and traceability

Worker, Diagnostic, Reviewer, Critic, and Acceptance can run named project package scripts (`bun/npm/pnpm/yarn run <name>`), normal Python and Go test runners, and bounded shell test tools and project test scripts. The approval covers the *outer invocation*, not what its tests or scripts execute internally. It never grants product write scope. Research does not gain this role capability.

Any shell command, including Git commands, package installs, generators and command chains, may be issued a one-use **audit-only** grant through `loom_command_elevate` by an agent attached to the exact runnable step. Supply current `workflowId`, `stepId`, exact `command`, and `reason`. A grant is bound to the session, role, step attempt, exact command digest and a 15-minute expiry. It returns `continue=true` so the agent can run the command and proceed. A new grant supersedes any pending unconsumed grant for that session.

The elevated command runs with host OS permissions **without Loom command allowlist, shell/path scope or Git command checks**. This is not containment or a way to claim trusted file/Git authorship. Arbitrary commands can modify the project, external paths, repository history and remote services without Loom seeing every effect. Loom continues to enforce permissions for structured edit tools, normal non-elevated shell commands and independent workflow gates. Treat the grant and observed result as an audit receipt, not proof of safe effects or successful delivery.

A durable command-elevation receipt records the requester, workflow/step/attempt, redacted command summary, full-command digest, reason, issuance, expiry, consumption, and eventual evidence observation ID/outcome. Loom's existing `loom_evidence_observations` API contains shell command observations with actor, source step, safe command summary, input/result digests, and outcome. Observed shell calls additionally have `commandTrace` with the runner family, runner name, routine/elevated/unclassified access, start time, duration, and grant ID when elevated.

**Limit:** these are tool-boundary execution traces, not subprocess, syscall, or filesystem-effect traces. A package or shell script can modify files and access the host despite having a test-like name. The recorded data can support future tighter policies, but it cannot prove that a particular script respected Loom's file-write scope.

## Source

- `agents/*.md` (portable role guidance)
- `plugins/loom/contracts/*.md` (optional role and shared contracts)
- `plugins/loom/agent-contracts.ts` (load and optional OpenCode permissions)
- `plugins/loom/index.ts` (runtime injection and enforcement)

## Depends on

- [Control Plane](control-plane.md)


## Intent methodology

Loom loads `skills/intent-grilling/SKILL.md` after the conversation has crossed into committed product execution and user-owned product intent still needs resolution. The skill keeps interview methodology out of the always-loaded General directive and is inspired by one-question-at-a-time product grilling: recommendation with each question, resolve code/research-answerable branches independently, then converge on an Anchor.
