---
name: hallmark
description: Context-led web visual production and craft for application interfaces, websites, individual components, and visual audits. Use when choosing or realizing a web visual direction, translating accepted direction into project patterns, or evaluating generic-looking output. Not for product-intent authority, technical architecture, or proof of production behavior.
metadata:
  version: "2.0.0"
---

# Hallmark

Make the result specific to the product and its people, not merely different from another generated page. This is Loom's self-contained adaptation of Hallmark, not the upstream theme catalog or a second workflow.

Accepted product/design authority and the active role's permissions remain binding. Designer owns unresolved human-facing choices; an implementation role realizes accepted choices. Loading this skill does not grant writes, browser access, tool installation, external-provider use, or permission to redesign an accepted experience.

## Start from the actual product

Read the accepted experience goals and design direction, the relevant real screens or code, and the project's tokens, components, and complete flow examples. Inspect the smallest useful slice, not the whole design library. Verify referenced files exist and distinguish current accepted patterns from stale examples or incidental implementation.

Use existing project character before inventing a new one. When direction is open, propose a context-grounded direction and label assumptions; do not present your proposal as already accepted brand policy or invented user research. Resolve only consequential authority gaps; ordinary craft decisions belong to the assigned professional.

An isolated component normally inherits its surroundings. It does not need a new brand, page macrostructure, reference board, or mandatory alternatives.

## Establish a point of view

Extend the existing design handoff rather than creating a parallel design document. Capture only what changes decisions:

- **Character and purpose:** who this is for, what they need to notice or feel, and why.
- **References and counterexamples:** specific qualities to carry forward or avoid, with their context and source. Borrow a principle, not unrelated branding, proprietary assets, or a whole layout by default.
- **Standards:** distinguish invariants required by accepted authority from recommended defaults and open design choices. Name what consistency protects and where exploration is useful.
- **Care in the details:** identify a small number of meaningful opportunities, such as preserving orientation after interruption, reassuring copy, legible dense data, or a context-specific illustration. Do not add surprise, animation, or decoration by quota.

Character can be quiet and restrained. Beauty, expression, and delight are legitimate goals when grounded in the accepted direction; they must not impair truthful status, task completion, accessibility, or performance constraints. Likewise, functional correctness alone does not establish that the intended character has been achieved.

## Explore the consequential choice

When the direction is genuinely open, compare a small number of meaningfully different structures, interactions, or expressive directions against the same scenarios and constraints. Color swaps of the same layout are not meaningful alternatives when the unresolved question is structural. A familiar pattern may be the best answer; novelty is not a pass condition.

Use `prototyping` when seeing or using a candidate is needed to resolve the question. Choose the cheapest adequate representation, including a rendered or bounded interactive prototype when warranted. Do not default to a polished first answer, nor require a broad exploration for a settled local change.

## Produce with the project's system

Use [production patterns](references/production-patterns.md) for a compact method spanning structure, tokens, components, full flows, copy, responsive adaptation, and motion.

Carry intent into the means of implementation: identify the real template or flow to reuse, the component and token references it depends on, accepted exceptions, and the user-facing behavior that must survive composition. A component list without its journey is not a complete production pattern.

For implementation work use `design-implementation`. For surface-independent hierarchy reasoning use `visual-interface-design`; for browser interaction use `web-ui-design`; for early accessibility decisions use `accessibility-design`. Hallmark supplies web visual craft for application and marketing surfaces alike; those skills retain their distinct behavioral and accessibility responsibilities.

Do not rotate themes between pages of one product, select a catalog theme by quota, make tokens append-only, or impose a fixed hero/features/CTA rhythm. Reuse and evolve the existing system within accepted change scope. No provider, CLI, theme pack, or external service is required by this port.

## Inspect, improve, and stop deliberately

Inspect the available rendered output and walk the relevant journey. Compare it with the design direction, not your preferred aesthetic. Note a concrete mismatch or opportunity, its user/context consequence, and the smallest useful correction. Re-examine the affected journey after a correction. Use [craft inspection](references/craft-inspection.md) for practical examples.

Separate defects against accepted direction from optional improvements. Do not fail harmless variation, force novelty, lower the bar because AI produced it, or demand unlimited polish. Stop when the assigned experience and agreed quality bar are supported by the available evidence and remaining suggestions are optional. Work within the existing task budget; surface a material unresolved issue rather than silently waiving it.

When a renderer or interaction tool is unavailable, report a static/heuristic assessment and what remains unobserved. A generated screenshot, described animation, or self-awarded score is not evidence that the real product works. Production validation remains `design-validation`; prototype observations prove only the prototype.
