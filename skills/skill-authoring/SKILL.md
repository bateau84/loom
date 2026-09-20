---
name: skill-authoring
description: Loom-native reusable skill authoring and maintenance. Use when creating, porting, editing, auditing, or packaging skills under skills/. Not for role policy (use agent-file-authoring).
---

# Loom Skill Authoring

Skills are on-demand methodology. They do not create Loom authority, routing, gates, permissions, evidence, or user checkpoints.

## Three-layer skill contract

A skill directory may contain three distinct context layers:

- `SKILL.md` — **required** practitioner methodology: how an authorized role does the work well.
- `ASSESSMENT.md` — **optional** Reviewer methodology: how normal independent review checks conformance and domain correctness.
- `QA.md` — **optional** Critic methodology: how Quality Assurance tries to falsify confidence after competent production and review.

The three files must not become increasingly severe copies of the same checklist.

### SKILL.md ownership

Keep producer/practitioner method here.

Do not put Reviewer rubrics, Critic attack plans, gate verdict criteria, or QA checklists in `SKILL.md`.

### ASSESSMENT.md ownership

Create it only when the domain has meaningful skill-specific review expertise.

It must answer: **Did this work satisfy its accepted inputs and domain obligations?**

Keep it bounded and evidence-oriented. Do not put broad speculative red-teaming or Critic/systemic adjudication here.

### QA.md ownership

Create it only when apparently competent reviewed work can still be materially wrong because of hidden, correlated, systemic, compositional, adversarial, recovery, security, or false-confidence failure modes.

It must answer: **How could this still be wrong even though it looks correct and passed normal review?**

QA may attack assumptions and evidence quality; it may not create new product or architecture authority or require Critic to redesign the solution.

Absence of either companion file is valid. Do not generate boilerplate merely for symmetry.

## Create or port a skill

1. Define a narrow trigger in frontmatter: what work should load the skill and important exclusions.
2. Put the reusable practitioner method in `SKILL.md`. Move bulky examples/reference material to `references/` only when the main method remains understandable without loading everything.
3. Decide independently whether domain-specific Reviewer assessment and Critic QA add real discriminating value.
4. Keep terminology role-neutral unless the method genuinely differs by Loom role.
5. When mentioning roles, use current Loom names: General, Designer, Specifier, Architect, Reviewer, Critic, Acceptance, Planner, Worker, Research, Diagnostic, Documenter.
6. Never embed a second workflow engine. Loom control-plane state and the active role directive win over skill prose.
7. Replace old AOS concepts such as hub/spoke routing, Solution Readiness, Task-manager gates, ephemeral report contracts, or routine user checkpoints.
8. Make verification concrete. A skill may recommend checks, but Loom evidence rules decide whether proof is sufficient.
9. Preserve licenses/attribution for copied third-party material.
10. Keep external dependencies explicit; do not assume a CLI/service is installed.
11. If a skill changes behavioral decisions rather than merely technical method, add a realistic eval for that decision boundary.

## Companion quality tests

A useful `ASSESSMENT.md` should fail the Rename Test: renaming the skill should make the criteria obviously wrong for another domain. It should contain domain-specific evidence, boundary, negative-space, and false-confidence checks rather than "check correctness/tests/edge cases."

A useful `QA.md` should expose failure modes that a competent producer **and** competent Reviewer could plausibly share. If it merely repeats `ASSESSMENT.md` with harsher wording, delete it.

## Port classification

- **Copy/adapt:** domain methodology that does not redefine Loom governance.
- **Rewrite:** useful methodology entangled with old agent/routing/gate semantics.
- **Defer:** niche package/persona/external integration that is not part of the trusted baseline.
- **Reject:** content whose primary purpose duplicates or bypasses Loom authority/control-plane behavior.

A good Loom skill answers: "How should an authorized role do this work well?"
Its companions answer how Reviewer assesses that work and how Critic attacks residual confidence. None answers who is authorized, what phase Loom is in, or whether a control-plane gate may be bypassed.
