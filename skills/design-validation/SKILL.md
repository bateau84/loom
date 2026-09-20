---
name: design-validation
description: Evaluate an implemented human-facing experience against accepted design intent. Use for Loom Designer validation after implementation.
---

# Design Validation

Answer: **does the implementation express the accepted design?**

Do not redesign while validating.

## Check four drift classes

1. **Behavioral:** interactions, states, errors, recovery, transitions.
2. **Structural:** information hierarchy, navigation, task sequence.
3. **Accessibility:** keyboard/focus, semantics, announcements, contrast and other accepted requirements.
4. **Visual:** hierarchy, tokens, semantic color/type/spacing where design intent depends on them.

For each finding state:
- expected design behavior;
- observed implementation;
- impact;
- evidence/location;
- owning correction boundary.

Validation is not code review and does not create new product or architecture authority.
