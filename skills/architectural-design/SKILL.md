---
name: architectural-design
description: Design Loom-compatible multi-component structure, boundaries, data/control flow, lifecycle, and invariants from accepted behavior. Use for Architect work spanning several components.
---

# Architectural Design

Use this skill when several components or boundaries must fit together coherently.

## Boundary

Architecture owns technical realization, not product semantics. Accepted behavioral guarantees are constraints.

Do not add retry/recovery policy, user-visible failure meaning, guarantees, or lifecycle semantics that accepted authority has not defined.

## Method

1. Load accepted behavioral/design authority and grounded current-state facts.
2. Map each applicable obligation to the component or boundary that realizes it.
3. Define components by responsibility, not file count.
4. Define data, control, authority, evidence, and failure flow across boundaries.
5. Define ownership of persistent state and lifecycle transitions.
6. Define trust/security boundaries when applicable.
7. Prefer deep modules and a small public seam.
8. Identify verification that is load-bearing for downstream review; persist it with Loom verification state when required.
9. Raise OQs for semantic gaps instead of choosing product meaning.

Use `architectural-decision` for one bounded technical choice and `architectural-spec` for exact implementation-facing contracts.
