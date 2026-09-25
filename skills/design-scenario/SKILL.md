---
name: design-scenario
description: Capture a concrete human-centered end-to-end Scenario that exercises accepted design intent, including a meaningful failure, interruption, or edge condition. Use for durable SC artifacts; not for Specifier Quality Scenarios.
---

# Design Scenario

Use when design needs a concrete situation against which journeys, interaction states, recovery, and later Product Acceptance can be evaluated.

A Design Scenario is **human-centered**. It is distinct from Specifier's Quality Scenario: SC describes a person's situation and journey; QS describes a measurable system quality under a stimulus/environment.

## Method

1. Trace the scenario to an accepted User Story/product need or other accepted human-facing authority.
2. Make the context concrete enough to affect design: actor, environment/device/work setting, prior knowledge, urgency/interruption, or other relevant conditions.
3. State the person's goal before describing interface steps.
4. Describe the meaningful task/journey sequence at human-visible level. Do not prescribe backend/system flow.
5. Include at least one realistic failure, interruption, mistaken action, missing information, degraded response, or edge condition when it could materially change the experience. A happy-path-only scenario rarely exposes enough design.
6. State the observable outcome: what the person sees/knows/can do at success, recovery, abandonment, or terminal failure.
7. Mark consequential assumptions instead of presenting guessed user knowledge/context as fact.
8. Keep the scenario implementation-independent enough that several interface realizations could satisfy it.
9. Reuse accepted Scenarios as design-validation and Product Acceptance inputs; do not rewrite them merely to match implementation.

## Durable artifact

```text
docs/design/<anchor-slug>/scenarios/
  sc-NNN-<descriptive-slug>.md
```

```markdown
# SC-NNN — <descriptive title>

**Context:**
<actor + concrete situation/constraints>

**Goal:**
<what the person needs to achieve>

**Scenario:**
<human-visible sequence/situation>

**Failure / edge condition:**
<meaningful failure, interruption, mistake, degraded state, or boundary case>

**Observable outcome:**
<what success/recovery/failure looks like to the person>

**Derived from:**
- <US and/or closest accepted human-facing authority>
```
