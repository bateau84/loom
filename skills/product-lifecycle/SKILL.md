---
name: product-lifecycle
description: Identify necessary setup, first-use, operation, recovery, upgrade, and exit work for an ongoing product. Use where those paths matter; not a universal production checklist, scope expansion, or a new operations gate.
---

# Product Lifecycle

A central feature can work while the product remains unusable to someone starting fresh, recovering from failure, or moving to the next version.

## When useful

Use for products whose accepted outcome includes ongoing use, installation, persistent data, integrations, upgrades, or operator responsibilities. Scale to intended users, environment, lifespan, and risk. A local disposable prototype does not automatically need fleet operations, telemetry, migrations, or a release programme.

This method identifies applicable work within existing authority. It does not create new requirements, permissions, roles, gates, release authority, or required documents. Missing meaning and changes to scope/guarantees go to their current owners.

## Method

1. **Establish the delivery boundary.** Identify who installs, uses, and operates the product; where it runs; what data or credentials it owns; and which first-use, continuing-use, or release outcomes were actually accepted. Separate known context from assumptions.
2. **Follow applicable lifecycle paths.** Use only the paths material to that boundary:
   - Start: installation/distribution, prerequisites, configuration, permissions/credentials, initial data, and the first useful action in a fresh environment.
   - Continue: ordinary use, dependency failures, meaningful failure detection, diagnostics, resource/cost limits, and who can take action.
   - Recover: interruption, restart, partial work, data preservation, and restoration where the accepted risk/guarantees require it.
   - Change or leave: supported upgrades/configuration changes, compatibility, migration, rollback or an explicit no-rollback constraint, and data export/removal or decommissioning when in scope.
3. **Classify gaps without widening scope.** Distinguish already-supported paths, necessary consequences of accepted commitments, unresolved behavior/design/structure, and optional improvements. A checklist item is not an obligation. A demonstrated inability to reach the accepted outcome is a gap, not an authorized omission; a genuine scope or risk trade-off requires its proper authority.
4. **Resolve through existing owners.** Architect owns structural/operational realization; Specifier defines observable lifecycle guarantees; Designer owns human-facing setup and recovery; Documenter records the realized supported usage. Use only the relevant domain methods such as `architectural-design`, `quality-scenario`, and `obligation-contract`. Keep implementation and decomposition with Worker and Planner.
5. **Define realistic evidence early.** For important applicable paths, identify starting conditions, the real product entry point, and an observable outcome. Avoid developer-machine state, pre-seeded databases, cached credentials, or mocks that hide mandatory product-owned setup/recovery. A backup file alone does not demonstrate restoration; a fresh install alone does not demonstrate an upgrade. Test decisive feasibility assumptions before dependent detail using `risk-driven-planning`.
6. **Carry coverage forward.** Put necessary commitments and decisions in their established owner artifacts. Carry the required work, dependencies, and proof expectations into the existing Plan/verification surfaces. Acceptance owns executable assembled-product scenarios; local checks and documentation support but do not replace them.

## Small handoff

Reuse the current permitted artifact or handoff. For each material path, preserve its accepted basis, starting condition, owning contribution, observable result/proof need, and any genuine unresolved gap. State important exclusions and their basis when misunderstanding would matter; do not create a blank matrix for every imaginable lifecycle concern.

## Sufficient result

The relevant owners can explain how an intended user starts, obtains value, continues, and handles the material failures/changes inside the agreed delivery boundary. Necessary work has an owner and proof path; optional work is not silently promoted into scope. This is a proposed coverage result, not a claim of completed deployment or product readiness.

Example: an application works on a populated development database, but a fresh supported installation cannot initialize its required data. Surface the first-use gap and its owner before decomposing delivery; later prove the real setup-to-first-result path. Do not accept a seeded fixture as that proof or require an unrelated cloud deployment.
