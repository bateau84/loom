---
name: architectural-design
description: Design Loom-compatible multi-component structure, boundaries, data/control flow, lifecycle, and invariants from accepted behavior. Use for Architect work spanning several components.
---

# Architectural Design

Use this skill when several components or boundaries must fit together coherently.

## Boundary

Architecture owns technical realization, not product semantics. Accepted behavioral guarantees are constraints. Do not add retry/recovery policy, user-visible failure meaning, guarantees, or lifecycle semantics that accepted authority has not defined.

## Method

1. **Ground the design.** Load accepted behavioral/design authority, relevant existing architecture, and current-system facts the design depends on. Separate verified facts from assumptions.
2. **Map obligations.** For each applicable obligation, identify the component or boundary that realizes it, or name where it is already satisfied, deferred by accepted authority, or blocked by an unresolved semantic gap.
3. **Start from the minimum-sufficient baseline.** Reuse adequate components, state, protocols, and seams. Every new service, store, lifecycle state, synchronization mechanism, compatibility layer, or integrity mechanism must discharge a named obligation or demonstrated material risk that a simpler option cannot.
4. **Name the forces and attack failure.** Consider the forces that materially matter: correctness, operability, security, performance, compatibility, cost, maintainability, and coupling. For load-bearing promises, test relevant failure lenses: explicit error/crash; silent wrong result; stale/corrupt state; concurrent mutation; partial execution/retry/cancellation; unavailable or backpressured dependency; authority/credential misuse.
5. **Develop real alternatives before selecting.** When genuine alternatives exist, develop at least two viable options. Treat viable options symmetrically across the same relevant lenses:
   - mechanism and ownership;
   - obligations/invariants satisfied;
   - benefits;
   - complexity and costs;
   - failure modes;
   - operational, security, compatibility, and coupling effects.
   Do not backfill straw alternatives after choosing. If only one option is viable, explain which accepted constraints eliminate the others.
6. **Decide the least complex complete realization.** Compare the viable options against the named forces and obligations, then choose. More machinery wins only when the simpler realization fails a named obligation or material risk.
7. **Make guarantees executable.** For each load-bearing invariant record: guarantee, precondition, responsible component/boundary, enforcement mechanism, and falsification/verification point. State persistent-state ownership and lifecycle transitions explicitly.
8. **Check coverage, inverse paths, and composition.** Cover the meaningful inputs/states and operations, not only the happy path. Reason about reverse/paired operations where material: write/read, encode/decode, acquire/release, publish/reconcile, dispatch/cancel, create/delete. Check that individually sound components still satisfy the invariant when assembled.
9. **Model trust when needed.** For credentials, authorization, untrusted input, persistence of sensitive state, external tools/plugins/MCPs, network/process/privilege boundaries, name the assets crossing the boundary, realistic threats, enforcement point, and required evidence.
10. **Define downstream proof.** Identify the real integration, recovery, compatibility, or security evidence required to prove the design. Persist load-bearing requirements with Loom verification state. Raise OQs for missing semantics instead of selecting product meaning.

Prefer deep modules and small public seams. Exact fields, methods, messages, and schemas belong in `architectural-spec`.

## Durable design shape

A substantial Architecture Design should normally make these perspectives explicit; omit one only when genuinely irrelevant and make that obvious:

```markdown
## Derived from
## Satisfies
## Problem
## Constraints and forces
## Invariants and guarantees
## Options considered
## Decision
## Structure and flows
## Input / operation coverage
## Failure and recovery
## Security / trust boundaries
## Verification and composition
## Consequences
## Open questions
```

The headings are reasoning prompts, not ceremony. Keep sections proportional to the decision.
