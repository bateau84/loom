---
name: design-validation
description: Evaluate the real implemented human-facing experience against accepted design, representative Scenarios, accessibility, and usability evidence without silently redesigning it.
---

# Design Validation

Answer: **does the real implementation express the accepted design and allow the accepted journeys to succeed?**

Validation is evidence, not design authority. Do not revise accepted design merely to make implementation pass.

Load the smallest relevant surface skills when platform-specific interaction is materially under test, and load the implementation-focused `accessibility` skill when accessibility conformance is materially under test. Those skills provide specialist checks; this skill owns the evidence method and drift judgment.

## Method

1. **Establish the reference and observation boundary.** Read accepted Experience Design, relevant US/SC artifacts, and surface/accessibility decisions. Identify the exact build/version, environment, viewport/terminal/device/input mode, data/permissions, and other conditions actually observed.
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
   - **Visual** — hierarchy/semantic tokens/meaningful appearance.
5. **Do a second-pass usability attack.** Apply the relevant usability heuristics and a cognitive walkthrough to catch issues the design itself failed to anticipate. Keep these separate from spec deviations: they may indicate an upstream design gap rather than implementation drift.
6. **Judge severity by human consequence.** Consider task blockage, ambiguity, data/safety consequence, loss of control/recovery, trust, accessibility exclusion, frequency, and primary-journey impact—not pixel distance.
7. **Distinguish correction ownership.**
   - **Implementation drift:** accepted design is clear; Worker can correct it.
   - **Design decision required:** design is ambiguous/wrong or a real constraint requires a new human-facing choice.
   - **Missing product/behavior/architecture capability:** route to the owning authority; Designer does not fake it.
8. **Record evidence limitations and negative space.** State untested scenarios, states, surfaces, input modes, environments, or observer-only checks. A PASS cannot claim more than was actually exercised.
9. **Require human-observer verification when needed.** Rendered visual hierarchy, actual focus behavior, assistive-technology announcements, timing/animation, device ergonomics, or other effects not provable from available evidence remain explicitly unverified.
10. **When no accepted Design Spec exists**, heuristic/usability findings are not spec deviations. State that design intent cannot be traced and avoid retroactively inventing one.

## Finding shape

Every actionable finding should contain:

```text
Finding: <short title>
Drift: behavioral | structural | accessibility | visual | heuristic
Impact: cosmetic | minor | major | critical
Location: <where/how observed>
Accepted intent: <design/scenario reference, or heuristic when no spec>
Observed: <real implementation evidence>
User consequence: <what changes for the person>
Owner: implementation-fix | designer-decision | other-authority
Required correction/question: <next action>
```

An observation without accepted-intent traceability or user consequence is not automatically a defect.

## Validation result

PASS only when the exercised accepted journeys and load-bearing design assertions conform within acceptable variation and no material required state remains unverified.

Accept minor implementation variation when it preserves task completion, meaning, accessibility, and design semantics. Do not fail on harmless pixel differences.

A scenario blocked by a missing/mock product capability is evidence that the intended experience does not exist; it cannot pass through a prototype substitute.
