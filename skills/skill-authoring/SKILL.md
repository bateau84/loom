---
name: skill-authoring
description: Loom-native reusable skill authoring and maintenance. Use when creating, porting, editing, auditing, or packaging skills under skills/. Not for role policy (use agent-file-authoring).
---

# Loom Skill Authoring

Skills are on-demand methodology. They do not create Loom authority, routing, gates, permissions, evidence, or user checkpoints.

## Create or port a skill

1. Define a narrow trigger in frontmatter: what work should load the skill and important exclusions.
2. Put the reusable method in SKILL.md. Move bulky examples/reference material to references/ only when the main method remains understandable without loading everything.
3. Keep terminology role-neutral unless the method genuinely differs by Loom role.
4. When mentioning roles, use current Loom names: General, Designer, Specifier, Architect, Reviewer, Critic, Acceptance, Planner, Worker, Research, Diagnostic, Documenter.
5. Never embed a second workflow engine. Loom control-plane state and the active role directive win over skill prose.
6. Replace old AOS concepts such as hub/spoke routing, Solution Readiness, Task-manager gates, ephemeral report contracts, or routine user checkpoints.
7. Make verification concrete. A skill may recommend checks, but Loom evidence rules decide whether proof is sufficient.
8. Preserve licenses/attribution for copied third-party material.
9. Keep external dependencies explicit; do not assume a CLI/service is installed.
10. If a skill changes behavioral decisions rather than merely technical method, add a realistic eval for that decision boundary.

## Port classification

- **Copy/adapt:** domain methodology that does not redefine Loom governance.
- **Rewrite:** useful methodology entangled with old agent/routing/gate semantics.
- **Defer:** niche package/persona/external integration that is not part of the trusted baseline.
- **Reject:** content whose primary purpose duplicates or bypasses Loom authority/control-plane behavior.

## Quality check

A good Loom skill answers: “How should an authorized role do this work well?”  
It must not answer: “Who is authorized, what phase are we in, or may this gate pass?” Those are Loom concerns.
