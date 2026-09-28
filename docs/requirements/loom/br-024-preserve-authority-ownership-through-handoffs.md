---
type: requirement
title: BR-024 — Preserve Authority Ownership Through Handoffs
description: Specialist authority decisions and deliverables remain accountable through planning and execution handoffs.
tags: [requirement, loom, authority, routing, planning, handoff]
---
**Status:** proposed

## Statement

When accepted work requires a specialist authority to make or own a decision or deliverable, Loom MUST preserve that authority's accountability through the handoff and completion of the work. A coordinator or execution role MUST NOT silently substitute its own work for the required authority's decision or deliverable; work dependent on that authority remains unresolved until the authority has provided or explicitly resolved it.

This governs observable responsibility and completion, not how responsibility is represented. It does not require an owner field, a particular Plan or Task schema, or a particular workflow architecture.

## Acceptance Criteria

1. For work requiring a specialist-owned decision or deliverable, the relevant specialist authority actually resolves it before dependent work is treated as complete.
2. A Worker or coordinator may carry out implementation or other authorized execution based on a specialist's resolved output, but execution alone does not count as the specialist decision/deliverable.
3. If a plan or handoff does not make it possible to establish that the required authority has resolved its obligation, Loom treats that obligation as unresolved and routes or replans it; it does not silently report successful completion by substituting another role.
4. Work not requiring specialist-owned judgment or deliverables remains eligible for direct execution without unnecessary specialist involvement.

## Verification Semantics

Inspect representative planning and handoff traces where an accepted outcome requires a Designer, Specifier, Architect, or other specialist decision/deliverable, including a trace whose executable task representation has no explicit owner attribute. Pass only if the required authority's actual decision/output is evidenced and carried into dependent work before completion; a generic Worker completion or mere earlier specialist invocation is insufficient. If the required resolution is absent or untraceable, the dependent obligation must remain open or be routed/replanned rather than reported complete. Include a control case of ordinary execution that needs no specialist judgment to ensure the requirement does not force redundant role handoffs. Different responsibility representations and execution architectures may satisfy the same observations.

## Derived from

- [Loom Anchor](../../anchors/loom/anchor.md), Acceptance Criteria 3 and 26, and the boundary that routine technical, design, implementation, planning, research, and verification choices are not user approval gates when inside accepted authority.

## Related

- [BR-001 — Run Autonomously to a Real Boundary](br-001-run-autonomously-to-real-boundary.md)
- [BR-002 — Route Missing Expertise Explicitly](br-002-route-missing-expertise-explicitly.md)
- [BR-021 — Preserve Holistic Plan Context Across Handoffs](br-021-preserve-holistic-plan-context.md)
