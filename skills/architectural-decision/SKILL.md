---
name: architectural-decision
description: Make one bounded technical realization choice with alternatives, drivers, consequences, and verification. Use for Architect decisions inside accepted Loom authority.
---

# Architectural Decision

Use this skill for one technical choice: library, representation, persistence mechanism, synchronization pattern, transport, provider, or similar.

## Method

1. State the decision question in one sentence.
2. List accepted constraints and decision drivers.
3. Identify at least two viable alternatives when alternatives materially exist.
4. Eliminate options that violate accepted guarantees.
5. Compare remaining options on the drivers that actually matter.
6. Choose one option and state the consequences and reversibility.
7. Name what would falsify the choice or force reconsideration.
8. Persist any load-bearing downstream verification through Loom when needed.

## Boundary

Do not route ordinary technical choices to the user.

Do route the question when the choice would change observable product meaning, weaken a mandatory guarantee, cross a user-reserved decision, or require explicit material-risk acceptance.
