# Portable Skill Authoring Principles

These principles are the reusable authoring knowledge that survived independent research and production use in `mats-opencode-setup`, separated from that repository's old AOS workflow mechanics. Loom's control plane and central eval harness remain authoritative for runtime state, permissions, approval, evidence, and evaluation execution.

## Discovery is part of skill behavior

A skill that is never retrieved cannot help, so description quality is part of functional correctness.

Write the frontmatter description as catalog metadata:

1. Lead with a short capability phrase: what useful ability does this skill add?
2. Add concrete `Use when` triggers: user verbs, filenames, tools, symptoms, error shapes, or situations that should retrieve it.
3. Where sibling territory overlaps, add a narrow `Not for ...` pointer to the actual sibling owner.
4. Keep the description about selection, not execution. The workflow belongs in the body.
5. When compressing a description that has worked in practice, inspect dropped trigger anchors and re-test relevant discovery cases. A dropped word is a re-test signal, not proof that it caused a regression.

A description can be grammatically excellent and still be bad retrieval metadata. Review it against realistic requests, including paraphrases and symptom-first prompts.

## Write for progressive disclosure

The practitioner should get the smallest complete high-signal context first.

- `SKILL.md` owns the normal path and load-bearing decisions.
- Direct references may hold schemas, large tables, deep examples, specialized variants, or source detail.
- A reference must add depth, not hide a rule required for correct ordinary use.
- Avoid reference chains where the actual answer requires several additional loads.
- Prefer one strong example over many shallow variants when examples materially improve the method.

Progressive disclosure is not license to make the main skill vague. The practitioner should know what to do and when to branch without loading every reference.

## Let the work determine the skill shape

Do not force every skill into one section template.

Common shapes include:

| Shape | Typical content |
| --- | --- |
| Technique | Core pattern, application, trade-offs, common mistakes |
| Reference | Fast lookup, API/command semantics, decision notes, examples |
| Pattern-recognition | Signals, interpretation, applicable responses, counterexamples |
| Discipline / governing methodology | Invariants, ordered procedure where necessary, failure modes, evidence expectations |

A skill can mix shapes, but a large mixed skill is a prompt to ask whether multiple composable capabilities would be clearer and cheaper.

## Match specificity to risk

Choose the amount of procedural freedom deliberately.

| Situation | Authoring style |
| --- | --- |
| Many valid approaches, low hazard | State outcome, constraints, quality bar, and useful heuristics |
| Preferred pattern with bounded variation | Give ordered steps, pseudocode, or a decision tree |
| Fragile, destructive, security-sensitive, or protocol-bound | Give exact sequencing where necessary, explicit invariants, and fail-closed conditions |

Do not script professional judgment merely because exact instructions are easy to write. Do not leave a dangerous boundary implicit merely because flexible prose is shorter.

Mechanical invariants belong in validators or runtime policy when possible. Skill prose should carry expert judgment, procedure, interpretation, trade-offs, and boundaries that cannot be decided mechanically.

## Prefer durable method over volatile facts

Skills should preferentially encode knowledge that remains useful across sessions and environments:

- procedures;
- heuristics;
- interpretation rules;
- invariants;
- decision structure;
- known failure mechanisms.

Fast-changing operational facts should normally be retrieved from an authoritative live source instead of baked into reusable methodology:

- current deployment/cluster state;
- incident status;
- ownership/on-call details;
- live endpoints;
- current metrics;
- mutable credentials;
- temporary feature flags.

Version-specific API/tool behavior may belong in a maintained reference skill when that is genuinely its purpose, but consequential claims need current grounding and freshness discipline.

## Design skills to compose

A useful skill should work independently and combine cleanly with adjacent skills.

Watch for two opposite failures:

- **under-owned:** the skill assumes an unnamed sibling will supply a load-bearing step;
- **monolithic:** the skill duplicates several independent capabilities, forcing irrelevant context into every use.

Prefer a small stable owner for shared methodology over copy/paste across siblings. Use trigger boundaries to make composition discoverable rather than encoding a rigid role-specific bundle.

## Ground behavioral rules in observed failure

Behavior-changing skills should earn their rules.

For a new discipline-enforcing skill, obtain realistic RED evidence before drafting when practical:

1. run or inspect the task without the candidate methodology;
2. capture the concrete failure, unsafe shortcut, or quality gap;
3. author the smallest rule/method that addresses the mechanism;
4. evaluate the candidate against the same kind of situation plus nearby negative space.

For an update, valid RED input can be a production incident, user counterexample, review/QA finding, historical transcript, or existing eval failure. Do not invent a baseline result to justify a rule.

The goal is not ceremony. It is to avoid turning plausible advice, one-off taste, or remembered anecdotes into permanent reusable law.

## Keep authored inputs honest

- Examples are inputs to learning/understanding, not hand-built substitutes for the expected output.
- Ground consequential version/API/tool claims; if verification is unavailable, narrow or mark the claim rather than projecting certainty.
- Avoid unsupported statistics, marketing language, and incident stories that do not generalize into a reusable mechanism.
- Preserve meaningful license/source attribution when material is adapted.
- Do not expose private helper scripts as public workflows merely because the implementation contains them.
- When curating an older skill, preserve the principle and its rationale while deliberately dropping obsolete control-plane mechanics.

## Evaluate behavior, not wording

A realistic skill eval should state:

- the real task/situation;
- the **trap** or failure mechanism the skill is meant to prevent;
- positive expectations for observable correct behavior;
- negative expectations for shortcuts or boundary violations.

Where the claimed output is a file, tool action, or runtime effect, prefer inspecting that output/action over trusting the model's statement that it happened.

Use real incidents and recurring work as scenario sources when possible. Synthetic cases remain useful for stable regression coverage and rare safety boundaries, but a skill should not be optimized merely to recognize its benchmark.

Loom's central eval harness owns execution, isolation, judging, ablation, evidence identity, retries, cost controls, and transport details. Do not recreate those mechanisms inside a skill.

## Preserve learning when migrating or compressing

Migration should distinguish:

- **portable methodology** — preserve/adapt;
- **authority/control-plane mechanics** — rewrite to the current runtime owner or remove;
- **historical rationale** — retain when it explains a non-obvious rule;
- **obsolete implementation detail** — discard.

Compression is successful when behavior and rationale survive with less context. A shorter file that loses the reason a rule exists can be easier to read today and harder to maintain tomorrow.

## Source lineage

This reference recovers portable conclusions from the earlier `nrkno/mats-opencode-setup` skill-authoring work, especially:

- `skills/skill-authoring/references/authoring-principles.md`;
- `docs/architecture/skill-system-architecture/skill-system-architecture.md`;
- `docs/architecture/skill-authoring-lifecycle-v2.md`.

The old hub/spoke AOS workflow, Solution Readiness, Task-manager gates, report lifecycle, skill-local provider scheduler, approval choreography, and other repository-specific governance are intentionally not restored.
