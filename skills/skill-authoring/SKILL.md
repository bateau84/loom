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

When discovery, structure, behavioral guidance, or eval design is load-bearing, read [Portable authoring principles](references/authoring-principles.md) before editing. Loom owns the runtime/eval machinery; this skill owns the portable methodology for making a reusable skill worth loading.

1. **Start from the job, not the document.** Define what the skill enables, the concrete situations that should retrieve it, nearby sibling territory, and what observable failure or quality gap justifies the skill. Walk one ordinary user request from inputs through key decisions and tools (when needed) to a useful observable outcome; a large, correct reference alone is not a working method.
2. **Treat the description as a retrieval contract.** Lead with the capability; include concrete `Use when` verbs, filenames, tools, symptoms, or situations; add a narrow `Not for ...` sibling pointer where territory overlaps. Do not turn the description into a miniature workflow. When editing a proven description, dropped trigger anchors are a reason to re-test discovery, not proof of causality.
3. **Choose a shape that fits the work.** Technique, reference, pattern-recognition, and discipline/governance skills need different bodies. Do not force every skill into one universal section template.
4. **Keep the load-bearing normal path in `SKILL.md`.** Move bulky schemas, API tables, examples, or specialized variants to direct references only when the core method remains understandable without loading them. Avoid reference chains whose real answer is several hops away.
5. **Match instruction specificity to risk.** Low-risk work with many valid approaches should state goals, constraints, and quality bars. Preferred patterns may use ordered guidance. Fragile, destructive, security-sensitive, or protocol-bound work should use exact sequences and fail-closed conditions where needed.
6. **Prefer durable method over volatile facts.** Encode procedures, heuristics, interpretation rules, invariants, and decision structure. Fast-changing environment facts such as current deployments, owners, incidents, endpoints, versions, or live metrics should come from authoritative runtime sources unless the skill is explicitly a maintained reference and freshness is part of its contract.
7. **Design for composition.** A skill should be independently useful while avoiding ownership that belongs to siblings. Split monoliths when several reusable capabilities can be selected separately; do not duplicate shared methodology merely to make one skill self-contained.
8. **Ground behavioral rules in observed failure.** For a new discipline-enforcing skill, obtain realistic RED evidence before drafting when practical: show the concrete failure without the candidate. For updates, a user counterexample, review finding, production incident, or prior eval failure can supply the RED input. Never invent a baseline result.
9. Put the reusable practitioner method in `SKILL.md`; decide independently whether domain-specific Reviewer assessment and Critic QA add real discriminating value.
10. Keep terminology role-neutral unless the method genuinely differs by Loom role.
11. When mentioning roles, use current Loom names: General, Designer, Specifier, Architect, Reviewer, Critic, Acceptance, Planner, Worker, Research, Diagnostic, Documenter.
12. Never embed a second workflow engine. Loom control-plane state, the central eval harness, and the active role directive win over skill prose.
13. Replace old AOS concepts such as hub/spoke routing, Solution Readiness, Task-manager gates, ephemeral report contracts, or routine user checkpoints.
14. Make verification concrete. Evals should resemble real work, name the trap being prevented, include positive and negative expectations, and prefer produced artifacts or observed actions over transcript self-report when those are the claimed outputs. Loom evidence rules decide whether proof is sufficient.
15. Preserve licenses and attribution for copied third-party material. Curate sources deliberately: keep the generalizable principle, record meaningful lineage, and discard obsolete workflow mechanics rather than copying them for historical symmetry.
16. Keep external dependencies explicit; do not assume a CLI/service is installed.
17. If a skill changes behavioral decisions rather than merely technical method, add or update a realistic eval for that decision boundary. Prefer real incidents and observed work as scenario sources; use Loom's central skill-ablation machinery rather than inventing a skill-local execution lifecycle.
18. **Check the consumer, not just your own fixtures.** Before claiming eval compatibility, identify the actual runner/parser and exercise it against the authored case files. Do not invent a convenient JSON shape and then write local tests that only accept that shape. Cases describe expectations; only executed baseline/candidate evidence can support a behavioral-improvement claim.

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

## Portable references

- [Portable authoring principles](references/authoring-principles.md) — discovery/retrieval, progressive disclosure, skill shapes, risk-matched specificity, composability, durable-vs-volatile knowledge, RED grounding, source curation, and eval design.
- [Loom behavioral evals](../../evals/README.md) — authoritative execution/evidence mechanics for runtime cases and skill ablations.
