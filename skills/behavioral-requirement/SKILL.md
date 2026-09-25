---
name: behavioral-requirement
description: Author one implementation-independent, falsifiable Behavioral Requirement from accepted product authority. Use for BR artifacts; not for quality-under-stress scenarios or cross-party seam contracts.
---

# Behavioral Requirement

Use when one observable or reviewable system behavior must be normative and falsifiable.

## Method

1. Identify the closest accepted semantic authority and the single behavior this BR must make precise.
2. Write one normative statement. Split unrelated promises rather than creating a compound catch-all requirement.
3. Define acceptance criteria across the perspectives that materially apply: normal behavior, edge/boundary conditions, failure, recovery, authority/security, compatibility, and interaction with related requirements.
4. Make ordering, quantifiers, continuation/termination, defaults, and exceptions explicit when they change the outcome.
5. Run the architecture-leak test: two materially different realizations should be able to satisfy the same requirement unless accepted authority fixes the structure.
6. Run the vacuity test: identify a plausible implementation that technically satisfies the wording while defeating the intended outcome. Tighten the requirement if one exists.
7. Define verification semantics as the observable evidence that would prove or falsify the requirement; do not merely name a test type.
8. Preserve provenance in `Derived from`. Do not cite architecture/code as product authority merely because they already implement the behavior.

## Durable artifact

```markdown
# BR-NNN — <descriptive title>

**Statement:**
<one implementation-independent normative behavior>

**Acceptance criteria:**
- <falsifiable condition>
- <falsifiable condition>

**Verification semantics:**
<what must be observed to prove or disprove the behavior>

**Derived from:**
- <closest accepted semantic authority>
```

Keep dependencies/relationships in the bundle index or repository relationship mechanism unless they are needed to understand the requirement itself.
