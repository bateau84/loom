---
name: design-implementation
description: Implement human-facing UI from accepted design, carrying product direction, real components/tokens/flows, applicable states, and observed quality through to the assembled experience. Use before interface implementation edits, including preparing the concrete implementation approach. Not for inventing unresolved design or production capabilities.
license: MIT
metadata:
  author: Bateau
  version: "2.0.0"
---

# Design Implementation

Implement the accepted experience, not a generic recipe. Product/design authority and the current role's permissions win over this skill. A project pattern is evidence of existing practice, not permission to override accepted intent.

## Consume the handoff before editing

Read the current accepted design and the smallest relevant slice of its scenarios, design direction, states, accessibility decisions, and exceptions. Follow references to the actual project templates, complete flow examples, components, and token definitions needed for the change; do not merely repeat their names from a coordinator summary.

For each material part of the implementation, establish:

```text
accepted intent -> real project pattern/component -> planned change -> check
```

Preserve the rationale that makes the result specific to this product. Check reference versions or status where supplied; stale examples do not defeat current authority. Identify absent references or real capability gaps rather than inventing a component/API or a backend promise. Missing product-wide branding alone is not a blocker for a bounded change that safely inherits the existing interface. Resolve consequential design choices through the existing Designer/OQ path; do not block unrelated work or create a new approval stage.

For web visual production load `hallmark`, which is bundled with Loom. Load relevant surface and accessibility methodology only when it materially applies. For program-bearing edits also follow the role's normal engineering baseline.

## Separate invariants, defaults, and choices

**Invariants** come from accepted authority and applicable accessibility/behavior contracts. **Defaults** are useful starting points. **Open choices** require professional judgment within the assigned authority. Do not turn a heuristic into a product requirement.

- Implement all reachable, meaningful states: default, hover where supported, focus, active, disabled, loading, empty, validation/error, success, stale/interrupted, and domain states as applicable. Do not manufacture all eight states for every element. A navigation link is not an asynchronous save operation.
- Reuse semantic tokens. Add, change, or remove tokens only within accepted design and mutation scope, inspecting affected consumers. Neither append-only growth nor an unreviewed global token change is a valid universal rule.
- Let accepted content and tasks drive responsive behavior. Wrapping a long control label or deliberately scrolling a data table can be correct. Fix unintended page overflow; do not clip inaccessible content just to hide it. Test the project's actual viewport/terminal/input constraints rather than an unrelated fixed width checklist.
- Respect focus, keyboard, touch/pointer, semantics, announcements, and reduced-motion needs. Do not hard-code a particular color, opacity, or animation as the accessibility contract.
- Use motion to clarify or express accepted character without obscuring state or delaying frequent work. Provide the required non-motion alternative.
- Use optimistic updates, retries, undo, and rollback only when supported by accepted semantics and real capability. Do not make a simulated success state stand in for persistence or completion.

## Build the flow, not isolated components

Carry the same user-visible identity, vocabulary, and state meaning through entry, action, feedback, error, recovery, and return. Reuse complete project flow patterns where they fit; verify the composition still serves the scenario.

Use realistic content, including long labels, missing data, permission limits, and reachable failure states. Write specific action labels and useful, honest feedback. Never invent metrics, testimonials, causes of failure, or product guarantees. No mandatory macrostructure comments, taste scores, theme rotation, or page-level ceremony belong on a small component change.

A disposable prototype is not production delivery. Keep its fixtures and simulated behavior isolated; its use does not relax production scope or accepted design.

## Check the result and hand back evidence

Inspect the actual rendered/interactive result when tools are available and that observation is material. Exercise the relevant whole journey and important negative paths. Compare both behavior and intended character with accepted design; a build passing or a component screenshot alone is insufficient evidence for the assembled experience.

Correct implementation drift within the task, then recheck affected paths. Route a necessary new design decision to Designer rather than silently redesigning the contract to fit the implementation. Separate defects from optional polish and stop at the assigned outcome and accepted quality bar; no endless refinement or new craft gate.

Record the relevant source/build, context, exercised scenarios, concrete observations, and remaining limits for downstream review. When no renderer or interaction tool is available, say which claims are static only. Never report observed visual quality, focus behavior, animation timing, or product success from code inference or a prototype substitute. Independent review and `design-validation` retain their existing roles.
