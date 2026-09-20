---
name: risk-driven-planning
description: Triage planning uncertainty and front-load facts that could materially change a Loom task graph. Use with Planner after candidate work boundaries exist.
---

# Risk-Driven Planning

Do not build downstream planning on an unverified fact that could materially change the plan.

## Classify uncertainty

- **Verified/local:** evidence is current enough; planning may rely on it.
- **Carryable:** uncertain, but either answer leaves task/dependency shape materially unchanged.
- **Blocking:** a different answer could change feasibility, architecture, decomposition, dependency order, scope, or acceptance evidence.

## Method

1. Enumerate assumptions the candidate plan relies on.
2. Classify each assumption.
3. For blocking uncertainty, route the relevant factual investigation before dependent planning proceeds.
4. Place risky but executable work early when its result can invalidate substantial downstream effort.
5. Add focused verification at the boundary where the risk becomes observable.

This skill does not perform the research and does not create product or architecture decisions.
