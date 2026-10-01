---
name: risk-driven-planning
description: Front-load decisive uncertainty during product discovery, solution development, and task planning. Use when an assumption could invalidate dependent commitments; not for routine detail or a new gate.
---

# Risk-Driven Planning

Do not elaborate a product direction, design, architecture, or task graph on an unverified fact that could materially invalidate that commitment. Apply this before decomposition when the risk already exists; keep Planner's existing planning use.

## Classify uncertainty

- **Verified/local:** evidence is current enough for the decision being made.
- **Carryable:** uncertain, but either answer leaves the current bounded commitment viable; retain the assumption and its limits.
- **Blocking for this commitment:** a different answer could invalidate feasibility, architecture, decomposition, dependency order, scope, or required acceptance evidence. Resolve it before making the dependent commitment, not before all independent work.

## Method

1. Enumerate the few assumptions the current decision or candidate plan relies on.
2. Classify each assumption by what a different answer would change.
3. For blocking uncertainty, identify the cheapest discriminating observation, research, prototype, or technical probe and its expected evidence. Route that work to the authorized owner before dependent detail proceeds.
4. Treat a bounded authorized experiment as legitimate work to reduce uncertainty, not as proof of its own hypothesis. In particular, consciously accepted uncertainty about product value is not automatically a blocker to that experiment.
5. Place risky but executable work early when its result can invalidate substantial downstream effort. Preserve valid independent work rather than restarting everything.
6. Add focused verification where the risk becomes observable; record actual evidence and update affected decisions through their existing owners. A proposed probe is not an executed result.

This skill does not perform research, authorize writes, create product or architecture decisions, or add workflow stages. A write-capable probe needs normal execution authority. Skills and advisory investigations cannot waive established verification requirements or turn an unresolved product guarantee into an accepted trade-off.
