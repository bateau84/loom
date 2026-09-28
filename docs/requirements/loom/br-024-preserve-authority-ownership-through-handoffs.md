---
type: requirement
title: BR-024 — Preserve Authority Ownership Through Handoffs
description: Specialist authority decisions and deliverables remain accountable through planning and execution handoffs.
tags: [requirement, loom, authority, routing, planning, handoff]
---
**Status:** proposed

## Statement

For every accepted work item that Loom plans, Loom MUST make an identifiable role accountable for the work and a supported path for that role's execution or decision responsibility. When work requires specialist authority, the responsible specialist role MUST remain identifiable through the work's handoffs: another role's implementation or a Worker-only task compilation MUST NOT imply that the specialist performed, delegated, or resolved the specialist responsibility. If responsibility passes between roles, the handoff MUST make the responsibility transfer and the relevant resolved or remaining work explicit. Dependent work remains unresolved until the required authority has provided or explicitly resolved its decision or deliverable.

This governs observable accountability, supported execution/decision paths, and completion, not how responsibility is represented. A specialist may own work; implementation may be performed by another role when the handoff makes the authority boundary and resulting responsibility clear. It does not require an owner field, a particular Plan or Task schema, or a particular workflow architecture.

## Acceptance Criteria

1. Each planned work item exposes an identifiable accountable role and a supported path for that role to perform its assigned execution or decision responsibility; a Worker-only compilation that leaves the accountable role indeterminate does not satisfy this criterion.
2. For work requiring a specialist-owned decision or deliverable, the relevant specialist role remains identifiable and its actual decision/output is evidenced before dependent work is treated as complete.
3. Another role may implement or execute work based on a specialist's output, but that execution alone does not count as the specialist's decision/deliverable or imply transfer of the specialist's authority.
4. When responsibility passes between roles, the handoff identifies the responsibility being passed and what is resolved or remains, so the receiving role has a supported path forward and the originating authority is not silently erased.
5. If a plan or handoff does not make the accountable role or required authority resolution establishable, Loom treats the obligation as unresolved and routes or replans it rather than silently reporting success through role substitution.
6. Work not requiring specialist-owned judgment or deliverables remains eligible for direct execution by an identified accountable role without unnecessary specialist involvement.

## Verification Semantics

Inspect representative plans and handoff traces, including routine execution, specialist-owned decisions/deliverables, specialist work implemented by another role, and a handoff that changes accountable responsibility. Pass only if each planned work item makes its accountable role and execution/decision path identifiable; required specialist output is evidenced before dependent completion; and a responsibility change is explicit rather than inferred from implementation or Worker compilation. A missing or ambiguous assignment/resolution must remain open or be routed/replanned. Include a routine-work control case to ensure this does not force unnecessary specialist involvement. Different responsibility representations and execution architectures may satisfy the same observations.

## Derived from

- [Loom Anchor](../../anchors/loom/anchor.md), Acceptance Criteria 3 and 26, and the boundary that routine technical, design, implementation, planning, research, and verification choices are not user approval gates when inside accepted authority.
- User clarification for this reconstruction: the Planner must know which role will perform each planned task; accountability is not inferred from Worker-only compilation, specialists may own work, and cross-role implementation requires explicit handoffs when authority changes.

## Related

- [BR-001 — Run Autonomously to a Real Boundary](br-001-run-autonomously-to-real-boundary.md)
- [BR-002 — Route Missing Expertise Explicitly](br-002-route-missing-expertise-explicitly.md)
- [BR-021 — Preserve Holistic Plan Context Across Handoffs](br-021-preserve-holistic-plan-context.md)
