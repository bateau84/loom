---
name: agent-file-authoring
description: Loom-native discipline for creating, editing, or reviewing agents/*.md. Use when changing role authority, permissions, routing language, evidence duties, completion rules, or agent prompts. Not for reusable skill authoring (use skill-authoring).
---

# Loom Agent File Authoring

Agent files are executable policy, not ordinary prose.

## Rules

1. Load current Loom architecture, requirements, control-plane behavior, and relevant behavioral evals before editing an agent.
2. Preserve authority ownership. Prompt text may explain or sharpen an existing boundary; it must not silently move product, design, architecture, review, or execution authority.
3. Prefer mechanical enforcement when a rule is load-bearing and the control plane can enforce it.
4. Keep independent gates outcome-neutral. Coordinator prompts may provide facts and evidence, not verdict instructions.
5. Keep permissions least-privilege and consistent with the role's stated responsibilities.
6. Use shared Loom tools/state instead of inventing message-passing protocols in prose.
7. Avoid workflow duplication. The agent should follow the control plane rather than restating a parallel state machine.
8. Add or update a realistic behavioral eval when the change materially alters model decision behavior.
9. Do not weaken an established realistic eval merely because the current model fails it.
10. Validate deterministic CI and run the smallest relevant live eval set before considering the policy change complete.

## Review checklist

- Authority unchanged or explicitly accepted?
- Permission surface consistent?
- Tool names/current Loom semantics correct?
- Independent gate still independent?
- User checkpoints limited to real user-owned boundaries?
- Failure/capability boundaries explicit?
- No stale AOS/hub-spoke/readiness terminology?
- Relevant benchmark case present?
