---
name: behavioral-spec
description: Common Specifier methodology for deriving and reconciling implementation-independent behavioral authority, selecting BR/QS/OC artifacts, preserving provenance, and preventing downstream backflow.
---

# Behavioral Specification

Use this skill for material Specifier work. It owns the common reasoning shared by Behavioral Requirements, Quality Scenarios, and Obligation Contracts.

## Boundary

Own **what must be observably or semantically true**, not structural realization. Do not choose components, schemas, protocols, storage, libraries, deployment topology, or implementation mechanisms unless accepted external/product authority itself fixes them.

Specifier may resolve ordinary semantic detail inside delegated product authority. It may not silently create a new capability, scope, material guarantee, risk acceptance, or user-reserved preference.

## Common method

1. **Establish semantic authority.** Read the accepted product authority relevant to the work. For each candidate normative claim distinguish:
   - **sourced** — explicitly fixed by accepted authority;
   - **derived** — a necessary consequence of it;
   - **specified** — an ordinary semantic choice Specifier is delegated to settle inside the accepted envelope;
   - **open** — materially changes capability, scope, risk, guarantee, or reserved preference and needs owning authority.
   These are reasoning states, not mandatory document fields.
2. **Preserve source modality.** A suggestion, example, preference, possibility, or exploration prompt does not become a mandatory guarantee merely because it appears in accepted context.
3. **Derive before reconciling.** First establish the clean obligation meaning from accepted semantic authority. Then compare it with Designer artifacts, architecture, existing requirements, tests, code, and implementation evidence. Downstream material may expose a gap, conflict, or missing case; it does not silently become upstream product truth.
4. **Choose the smallest artifact set.**
   - Behavioral Requirement: one normative observable behavior.
   - Quality Scenario: a quality must hold measurably under a meaningful condition/stimulus.
   - Obligation Contract: independently realized parties must share semantic agreement at a correctness-sensitive seam.
   Use the artifact whose semantic role is primary:
   - If the obligation exists specifically as a quality under a defined condition, stimulus, load, degradation, threat, or recovery situation, make the QS normative. Add a BR only when there is a distinct baseline behavior that remains meaningful independently of that scenario.
   - If the obligation exists specifically because independently realized parties must agree at a seam, make the OC normative for that shared meaning. Add a BR only when there is a distinct system-level outcome outside the seam contract.
   Cross-reference related artifacts instead of restating the same guarantee in multiple types. Do not create BR/QS/OC copies for symmetry or completeness.
5. **Check semantic completeness.** Cover consequential ordering, precedence, continuation/termination, lifecycle, failure, cancellation, timeout, retry/recovery, authority, compatibility, evidence/provenance, destructive behavior, and edge combinations when applicable.
6. **Check architecture leakage.** Ask: could materially different architectures satisfy this obligation while preserving the same meaning? If not, verify that the structural constraint is itself authoritative; otherwise rewrite the obligation or route the structural choice to Architect.
7. **Make meaning falsifiable.** A normative claim must admit a real pass/fail observation. Avoid vague qualities, hidden defaults, ambiguous quantifiers, and requirements that can pass vacuously because the triggering state is impossible or its evidence is suppressed.
8. **Reconcile with Designer.** User Stories and human-centered Scenarios may constrain observable experience inside Designer authority. The BR/QS/OC layer and Designer layer must agree before Architecture depends on them; disagreements are gaps to resolve, not permission for either role to silently overwrite the other.
9. **Define verification intent, not tests.** State what must be observed to prove or falsify the obligation. Do not prescribe implementation-specific test mechanics unless the verification surface is itself authoritative.

## Durable bundle

Use one anchor-rooted bundle:

```text
docs/requirements/<anchor-slug>/
  index.md
  requirements/
    br-NNN-<descriptive-slug>.md
  quality-scenarios/
    qs-NNN-<descriptive-slug>.md
  obligation-contracts/
    oc-NNN-<descriptive-slug>.md
```

Use independent BR/QS/OC numbering. The bundle index is navigation and relationship context, not a replacement for the artifacts.

Existing flat BR/OC bundles remain valid until an intentional migration updates them and their references; do not move legacy artifacts merely to satisfy the new-work layout.

Load the artifact-specific skill before authoring each artifact type.
