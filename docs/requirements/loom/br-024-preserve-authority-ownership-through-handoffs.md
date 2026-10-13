---
type: requirement
title: BR-024 — Preserve Authority Ownership Through Handoffs
description: Every Loom role remains eligible for appropriately typed planned work and questions, with accountable authority preserved through supported paths and handoffs.
tags: [requirement, loom, authority, routing, planning, handoff]
---
**Status:** accepted

## Statement

For each accepted planned work item or question, Loom MUST identify the accountable/responder role and provide a supported path for that role to perform its assigned responsibility. Every Loom subagent, including Planner, MUST be eligible for appropriately typed Plan Tasks and OQs; eligibility does not make every task suitable for every role, transfer role authority, or require dispatch when that role is not appropriate. Tasks MUST preserve role-native work: the task's kind and expected outcome must fit the assigned role's accepted responsibilities rather than recasting all work as generic Worker execution. When work requires specialist authority, the responsible specialist role MUST remain identifiable through handoffs: another role's implementation or a Worker-only compilation MUST NOT imply that the specialist performed, delegated, or resolved that responsibility. If responsibility passes between roles, the handoff MUST make the transfer and the relevant resolved or remaining work explicit. Dependent work remains unresolved until the required authority has provided or explicitly resolved its decision or deliverable.

General and Planner MUST discover the currently available OpenCode agent roster and descriptions, together with Loom-maintained planning insights, when selecting recipients and task kinds. Discovery informs routing only: a preferred `.loom` registry in OpenCode configuration is advisory, not an allowlist, permission grant, or proof that a path is supported. Loom MUST NOT add custom `loom:` frontmatter to agent definitions for routing metadata, because OpenCode routes unknown frontmatter fields to provider options. At runtime Loom MUST validate that each selected role has a supported path for the specific Task or OQ, including applicable role dependencies, gates, and task paths. An unsupported or invalid path remains explicitly blocked or is replanned; Loom MUST NOT silently substitute Worker or infer the role-owned work complete.

This governs observable accountability, supported execution/decision paths, and completion, not how responsibility is represented. A specialist may own work; implementation may be performed by another role when the handoff makes the authority boundary and resulting responsibility clear. It does not require an owner field, a particular Plan or Task schema, or a particular workflow architecture.

## Acceptance Criteria

1. Each planned work item exposes an identifiable accountable role and a supported path for that role to perform its assigned execution or decision responsibility; a Worker-only compilation that leaves the accountable role indeterminate does not satisfy this criterion.
2. Every currently available Loom subagent, including Planner, can be selected for a Plan Task and an OQ when the work's type and role authority make that assignment appropriate; no role is categorically excluded merely because it is not Worker.
3. The selected Task kind, expected deliverable, and OQ responder responsibility fit the assigned role's native authority; routine work can remain directly assigned without unnecessary specialist involvement.
4. General and Planner can inspect current OpenCode agent names/descriptions and Loom-maintained planning insights as routing inputs. A preferred `.loom` registry may inform preference but cannot alone exclude an available role, establish permissions, or prove a task/OQ path valid; routing does not depend on custom `loom:` frontmatter.
5. Before dispatch or completion, runtime validation establishes that the specific role/task-or-question path and its required dependencies and gates are supported. Invalid or unavailable paths remain blocked or are replanned; Loom neither silently falls back to Worker nor treats an absent role-owned decision/deliverable as complete.
6. For work requiring a specialist-owned decision or deliverable, the relevant specialist role remains identifiable and its actual decision/output is evidenced before dependent work is treated as complete.
7. Another role may implement or execute work based on a specialist's output, but that execution alone does not count as the specialist's decision/deliverable or imply transfer of the specialist's authority.
8. When responsibility passes between roles, the handoff identifies the responsibility being passed and what is resolved or remains, so the receiving role has a supported path forward and the originating authority is not silently erased.
9. If a plan or handoff does not make the accountable role or required authority resolution establishable, Loom treats the obligation as unresolved and routes or replans it rather than silently reporting success through role substitution.

## Verification Semantics

Inspect roster-discovery and routing observations plus representative plans and handoff traces: test every currently available Loom subagent (including Planner) against appropriate Task kinds and OQ response assignments; include routine work, specialist-owned decisions/deliverables, specialist work implemented by another role, a role whose selected path is unsupported, and a handoff that changes accountability. Confirm General and Planner receive current OpenCode agent descriptions and Loom planning insights, and that a configured `.loom` preference neither acts as an allowlist nor proves permissions/path support. Confirm no custom `loom:` frontmatter is required. Pass only if every appropriate role/task-or-question assignment has a supported path with its dependencies/gates validated; role-native responsibility remains clear; required specialist output precedes dependent completion; and unsupported paths stay blocked or are replanned without silent Worker fallback or inferred completion. A missing/ambiguous assignment remains unresolved. Include a routine-work control case. Different responsibility representations and execution architectures may satisfy the same observations.

## Derived from

- [Loom Anchor](../../anchors/loom/anchor.md), Acceptance Criteria 3 and 26, and the boundary that routine technical, design, implementation, planning, research, and verification choices are not user approval gates when inside accepted authority.
- [Loom Anchor](../../anchors/loom/anchor.md), Acceptance Criteria 8 and 36: accountable role and supported path for planned work; General and Planner discover current OpenCode agents/descriptions and Loom planning insights.
- User direction for this revision: every Loom subagent, including Planner, is eligible for appropriately typed Plan Tasks and OQs; role-native work remains distinct; the preferred `.loom` registry is advisory only; no custom `loom:` frontmatter; runtime validates specific paths, dependencies, and gates without silent Worker fallback or inferred completion.

## Related

- [BR-001 — Run Autonomously to a Real Boundary](br-001-run-autonomously-to-real-boundary.md)
- [BR-002 — Route Missing Expertise Explicitly](br-002-route-missing-expertise-explicitly.md)
- [BR-021 — Preserve Holistic Plan Context Across Handoffs](br-021-preserve-holistic-plan-context.md)

## Current implementation context

Current supported role-safe Plan execution exists and has been reviewed. General and Planner can use bounded `loom_roster` discovery of current host names/descriptions and separate plugin-owned advisory planning insights; provider-free mock-host tests cover that increment. Brainstorm advisory OQs are supported. Universal Task routing remains incomplete: planned Brainstorm, Planner, Critic and Acceptance Tasks are unsupported. Actual installed-host behavior and full Objective acceptance remain unproven; this requirement does not claim its complete acceptance criteria are satisfied.
