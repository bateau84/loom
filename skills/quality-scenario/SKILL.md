---
name: quality-scenario
description: Specify a measurable quality attribute under a meaningful condition or stimulus without choosing architecture. Use for QS artifacts such as resilience, performance, availability, recoverability, security, compatibility, or observability scenarios.
---

# Quality Scenario

Use when a claimed quality becomes meaningful only when the system is placed in a concrete operating condition, stress, failure, threat, load, or recovery situation.

A Quality Scenario is a specialized behavioral obligation, not a vague non-functional requirement.

## Method

1. Identify the accepted quality or the necessary quality consequence of accepted product meaning. Do not invent arbitrary thresholds, priorities, or risk acceptance.
2. Construct the scenario using the classic quality-scenario lenses internally:
   - **source of stimulus** — who/what causes the condition; this is not provenance;
   - **stimulus** — the event, load, failure, request, or threat;
   - **environment** — normal, degraded, peak, startup, recovery, partial outage, etc.;
   - **target** — the semantic behavior affected; avoid naming an architectural component unless already authoritative;
   - **response** — what observably must happen;
   - **response measure** — the boundary that makes the quality pass/fail.
3. Compress those lenses into the Loom artifact instead of exposing six ceremonial fields:
   - `Statement` carries the relevant environment + stimulus + required response/target.
   - `Acceptance criteria` carry concrete response boundaries and measures.
   - `Verification semantics` state how the condition is induced/observed and how the measure is judged.
   - `Derived from` carries provenance. It is distinct from the classic "source of stimulus."
4. Prefer scenarios that distinguish real possession of the quality from happy-path success: degraded, boundary/load, interruption, adversarial, or recovery cases where relevant.
5. Keep measures authorized. If "fast", "available", or "recoverable" matters but no meaningful threshold is accepted or safely derivable, specify the observable qualitative boundary you do know and raise the material missing threshold rather than inventing a number.
6. Avoid duplication. A QS may derive from one or several BRs, or directly from accepted product authority. Do not restate a BR unless the condition/measure adds real quality meaning.
7. Keep human-centered usability/accessibility realization with Designer; use QS only for accepted measurable behavioral qualities inside Specifier authority.

## Durable artifact

```markdown
# QS-NNN — <descriptive title>

**Statement:**
<meaningful environment/condition + stimulus + required observable response>

**Acceptance criteria:**
- <measurable/falsifiable response boundary>
- <measurable/falsifiable response boundary>

**Verification semantics:**
<how to establish the condition and determine whether the response/measure holds>

**Derived from:**
- <BR(s) and/or closest accepted semantic authority>
```
