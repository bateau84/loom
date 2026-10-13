---
name: design-validation
description: Evaluate the real implemented human-facing experience against accepted design, product direction, representative Scenarios, accessibility, and usability evidence without silently redesigning it.
---

# Design Validation

Answer: **does the real implementation express the accepted design and allow the accepted journeys to succeed?**

Validation is evidence, not design authority. Do not revise accepted design merely to make implementation pass.

Load the smallest relevant surface skills when platform-specific interaction is materially under test, and load the implementation-focused `accessibility` skill when accessibility conformance is materially under test. For web visual craft load `hallmark`. Those skills provide specialist methods; this skill owns the evidence method and drift judgment.

## Method

1. **Establish the reference and observation boundary.** Read accepted Experience Design, relevant US/SC artifacts, product direction/craft criteria, and surface/accessibility decisions. Identify the exact build/version, environment, viewport/terminal/device/input mode, data/permissions, and other conditions actually observed.
2. **Observe the real product first.** Use the implemented surface, not a prototype/mock substitute. When direct interaction or rendered observation is unavailable, say which claims are limited to code/static inspection; do not convert inferred behavior into observed evidence.
3. **Walk representative Scenarios.** Exercise load-bearing human journeys end to end, including applicable loading, empty, validation/error, cancellation, interruption, recovery, focus, and degraded states—not only the photogenic happy path.
4. **Run spec-fidelity comparison.** For each load-bearing design assertion compare:
   ```text
   accepted design -> observed implementation -> user consequence
   ```
   Classify drift as:
   - **Behavioral** — response, state, error/recovery, transition;
   - **Structural** — IA, navigation, task sequence/context;
   - **Accessibility** — focus/input/semantics/announcements/contrast or accepted accessibility behavior;
   - **Visual** — hierarchy/semantic tokens/meaningful appearance, including accepted product character.
5. **Do a second-pass usability and craft examination.** Apply the relevant usability heuristics and a cognitive walkthrough to catch issues the design itself failed to anticipate. Examine the assembled experience: do its structure, copy, visual treatment, and details express the accepted direction, and do transitions preserve a coherent whole? Keep upstream design gaps and optional refinements separate from spec deviations. Do not demand originality for its own sake or treat arbitrary taste as a defect. Equivalent functional behavior alone does not establish fulfillment of an accepted visual/experience goal.
6. **Judge severity by human consequence.** Consider task blockage, ambiguity, data/safety consequence, loss of control/recovery, trust, accessibility exclusion, frequency, and primary-journey impact—not pixel distance or taste scores. Explain how a craft mismatch affects this product's accepted experience.
7. **Distinguish correction ownership.**
   - **Implementation drift:** accepted design is clear; Worker can correct it.
   - **Design decision required:** design is ambiguous/wrong or a real constraint requires a new human-facing choice.
   - **Missing product/behavior/architecture capability:** route to the owning authority; Designer does not fake it.
8. **Record evidence limitations and negative space.** State untested scenarios, states, surfaces, input modes, environments, or observer-only checks. A PASS cannot claim more than was actually exercised. An agent walkthrough is not observation of representative people; a prototype observation is not production integration evidence.
9. **Require human-observer verification when needed.** Rendered visual hierarchy, actual focus behavior, assistive-technology announcements, timing/animation, device ergonomics, or other effects not provable from available evidence remain explicitly unverified.
10. **When no accepted Design Spec exists**, heuristic/usability findings are not spec deviations. State that design intent cannot be traced and avoid retroactively inventing one. Missing brand direction does not authorize a validator to invent a preferred aesthetic and fail the product against it.
11. **Recheck corrections and stop proportionally.** Re-exercise the changed behavior and affected whole journey after a fix; do not inherit the old PASS. Stop when the assigned accepted journeys and quality bar are supported, with optional suggestions kept separate. No new approval stage or endless polishing loop is implied.

## Finding shape

Every actionable finding should contain:

```text
Finding: <short title>
Drift: behavioral | structural | accessibility | visual | heuristic
Impact: cosmetic | minor | major | critical
Location: <where/how observed>
Accepted intent: <design/scenario/direction reference, or heuristic when no spec>
Observed: <real implementation evidence>
User consequence: <what changes for the person>
Owner: implementation-fix | designer-decision | other-authority
Required correction/question: <next action>
Recheck: <affected path and observed outcome, when corrected>
```

An observation without accepted-intent traceability or user consequence is not automatically a defect. Optional refinements are suggestions, not blocking findings.

## Validation result

PASS only when the exercised accepted journeys and load-bearing design assertions, including applicable character/craft criteria, conform within acceptable variation and no material required observation remains unverified.

Accept minor implementation variation when it preserves task completion, meaning, accessibility, and design semantics. Do not fail on harmless pixel differences or lower the quality standard because the producer used AI.

A scenario blocked by a missing/mock product capability is evidence that the intended experience does not exist; it cannot pass through a prototype substitute.
