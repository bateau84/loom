---
name: design-review
description: Review a proposed human-facing design for coherence, usability risks, accessibility, state coverage, copy honesty, product character, and implementation-ready precision.
---

# Design Review

Review the design itself before implementation.

## Review for

- clear user goal and task flow;
- complete material states: default, loading, empty, error, success, disabled/recovery as applicable;
- visible system status and recoverability;
- keyboard/focus/accessibility behavior;
- responsive or surface-specific constraints;
- honest content: no fabricated metrics, testimonials, capabilities, or guarantees;
- consistent hierarchy and interaction grammar across the complete journey;
- realization of accepted product character and craft criteria, not just a generic theme or individually polished screens;
- real project patterns, components, tokens, and accepted exceptions that an implementation role can actually find and use;
- meaningful alternatives and appropriately scoped prototype evidence where an important design choice was open;
- no accidental technical-realization decisions outside Designer authority;
- enough precision for downstream implementation and validation.

For web visual craft, load `hallmark`. When acting as Reviewer, consume its assessment through `loom_assessment`; this instruction does not direct Critic to use Reviewer methodology or let a producer call self-inspection independent review. Other roles retain their own authority and method-loading rules. Judge the evidence and user/context consequence, not a self-awarded taste score. A familiar pattern is not a defect merely because it is familiar.

Return concrete findings. Distinguish deviations from accepted direction and usability defects from optional refinement. Do not replace the design with a different preferred aesthetic unless the accepted design is actually defective; do not create new acceptance criteria merely because further polish is possible. Recheck the affected intent and journey after correction. A design-artifact review does not establish rendered or production behavior.
