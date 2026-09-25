---
name: architectural-decision
description: Make one bounded technical realization choice with alternatives, drivers, consequences, and verification. Use for Architect decisions inside accepted Loom authority.
---

# Architectural Decision

Use this skill for one bounded technical choice: library, representation, persistence mechanism, synchronization pattern, transport, provider, or similar.

## Boundary

Accepted behavior and architecture are constraints, not variables to rewrite. Route the question only when the choice would change observable product meaning, weaken a mandatory guarantee, cross a user-reserved decision, or require explicit material-risk acceptance.

## Method

1. **State one decision question.** Name context, accepted obligations, constraints, decision drivers, and what is outside the decision. If several component relationships must be designed together, use `architectural-design`.
2. **Establish the simplest viable baseline.** Start with reuse or the smallest change that could work. If it loses, name the exact obligation or demonstrated risk it fails.
3. **Develop alternatives before choosing.** Identify at least two genuinely viable alternatives when they exist. Do not decide first and manufacture rejected options afterward. For every viable option use the same relevant lenses:
   - mechanism;
   - benefits;
   - costs/complexity;
   - failure modes and risks;
   - operational/compatibility impact;
   - security/authority impact;
   - coupling/maintainability impact;
   - obligation impact.
   If accepted constraints leave only one viable option, state why rather than inventing straw alternatives.
4. **Compare on the drivers that actually matter.** Eliminate any option that cannot preserve accepted guarantees. Distinguish evidence, assumptions, and preference.
5. **Choose the least complex complete option.** State why it wins and why each serious rejected option loses. The decision should be strong enough that downstream implementation does not need to reopen the same question.
6. **Record the price.** State positive, negative, and neutral consequences where material, including migration, operations, security, maintenance, lock-in, and reversibility.
7. **Define falsification.** Name concrete confirmation evidence and the condition that would force reconsideration: benchmark, integration proof, compatibility test, runtime observation, security proof, changed premise, or similar.
8. Persist any load-bearing downstream verification through Loom when needed.

## Durable decision shape

```markdown
## Derived from
## Satisfies
## Decision question
## Drivers and constraints
## Options considered
## Comparison
## Decision
## Consequences
## Confirmation and reconsideration
## Open questions
```

Keep the comparison proportional, but make viable alternatives substantial enough that the choice is real rather than ceremonial.
