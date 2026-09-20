---
name: agent-file-authoring
description: Loom-native discipline for creating or editing agents/*.md. Use when changing role authority, permissions, routing language, evidence duties, completion rules, or agent prompts. Not for reusable skill authoring (use skill-authoring).
---

# Loom Agent File Authoring

Agent files are executable policy, not ordinary prose.

## Authoring method

1. Load current Loom architecture, requirements, control-plane behavior, and relevant behavioral evals before editing an agent.
2. Inventory the role's current authority, inputs, outputs, permissions, completion semantics, OQ responsibilities, evidence duties, and failure boundaries before changing wording.
3. Preserve authority ownership. Prompt text may explain or sharpen an existing boundary; it must not silently move product, design, architecture, review, or execution authority.
4. Prefer mechanical enforcement when a rule is load-bearing and the control plane can enforce it.
5. Keep independent gates outcome-neutral. Coordinator prompts may provide facts and evidence, not verdict instructions.
6. Keep permissions least-privilege and consistent with the role's stated responsibilities.
7. Use shared Loom tools/state instead of inventing message-passing protocols in prose.
8. Avoid workflow duplication. The agent should follow the control plane rather than restating a parallel state machine.
9. Search for stale contradictory language after the edit, not merely presence of the new rule.
10. Add or update a realistic behavioral eval when the change materially alters model decision behavior.
11. Do not weaken an established realistic eval merely because the current model fails it.
12. Validate deterministic CI and run the smallest relevant live eval set before considering the policy change complete.

Reviewer-specific checks belong in this skill's `ASSESSMENT.md`. Critic-specific Quality Assurance attacks belong in `QA.md`; do not teach the producer those rubrics here.
