---
name: feature-handoff
description: Compile a compact, self-contained implementation request for another component, repository, or fresh agent session when current work depends on functionality elsewhere. Use for cross-component or cross-session handoffs such as frontend→backend, service A→service B, application→infrastructure, or one independently handled subsystem→another. Not for Loom internal task routing, implementation plans, or authoring durable product/architecture authority (use behavioral-spec, obligation-contract, or architectural-spec when those artifacts are the actual work).
---

# Feature Handoff

Use this skill when work in the current context discovers a dependency that must be implemented somewhere else, often by another agent in a separate session.

The output is a **copy/paste artifact**, not a conversation summary. The receiving agent must be able to understand and act on it without access to the source session.

## Boundary

A handoff packages the need already established by the current work. It does not create new product authority.

- Preserve accepted requirements and constraints at their existing strength.
- Do not promote an idea, example, or implementation convenience into a requirement.
- Describe the required outcome before proposing a mechanism.
- Do not prescribe the receiving component's internal implementation unless the interface or mechanism is itself part of the established dependency.
- If the handoff exposes a correctness-sensitive semantic seam that needs durable normative authority, use `obligation-contract` instead of hiding that work inside the handoff.
- If the work is really a durable behavioral specification, use `behavioral-spec`. A feature handoff may reference such artifacts but does not replace them.

## Requirement levels

Use requirement levels deliberately:

- **MUST** — the receiving implementation must satisfy this for the source need to work.
- **SHOULD** — expected unless the receiver has a concrete reason to choose differently.
- **MAY** — optional capability or convenience.

Never use `MUST` merely because the source implementation was designed around one possible solution.

## Method

1. **Identify the seam.** Name the source component/context and the target component or responsibility. If the exact target is unknown, describe the responsibility instead of guessing a repository or service name.
2. **State the objective.** Explain what the source side needs to accomplish and why the dependency exists.
3. **Describe the current gap.** Capture only the existing behavior or limitation needed to understand the request.
4. **Describe requested behavior.** State externally observable outcomes at the seam. Keep receiver-internal design out of this section.
5. **Extract requirements.** Give each normative requirement a stable local ID. Split unrelated guarantees rather than combining them into one broad statement.
6. **Define acceptance.** Express what the source side can observe to know the dependency is satisfied. Prefer integration-boundary evidence over receiver-internal details.
7. **Preserve constraints and non-goals.** Include compatibility, authority, security, performance, lifecycle, or migration constraints only when they are established and material.
8. **Handle interfaces carefully.** If an endpoint, payload, schema, command, event, or other interface is required, mark it `required`. If it is only a useful proposal, mark it `suggested` or `example`. Do not let an example silently become normative.
9. **Surface uncertainty.** Put unresolved questions in `open_questions`. Do not guess just to make the handoff look complete.
10. **Preserve provenance.** Include concise evidence or source references when they materially help the receiver understand why a requirement exists. Do not depend on links to ephemeral chat context.
11. **Run the fresh-session test.** Read the artifact as if this conversation did not exist. Remove phrases such as "as discussed", "the above", or unexplained local shorthand. If the receiver still needs the source transcript, the handoff is incomplete.

## Default output

When asked to produce a handoff, emit only the handoff artifact unless the caller asks for explanation around it.

Use this compact YAML shape. Omit optional sections that add no useful information.

```yaml
kind: feature-handoff
version: 1
title: <short descriptive title>

source:
  component: <component, repository, subsystem, or responsibility>
  need: <why the source side needs this>

target:
  component: <component, repository, subsystem, or responsibility>

objective: >
  <outcome this dependency enables>

context:
  current_behavior:
    - <relevant existing behavior or limitation>

requested_behavior:
  - <observable outcome at the seam>

requirements:
  - id: REQ-001
    level: MUST
    text: <single falsifiable requirement>

acceptance:
  - id: AC-001
    given: <relevant starting condition>
    when: <interaction or trigger>
    then: <observable result>

constraints:
  - <material established constraint>

non_goals:
  - <explicitly excluded behavior when useful>

interface:
  status: suggested # required | suggested | example
  description: <interface proposal or established contract>
  example: <optional concise example>

open_questions:
  - <unresolved question the receiver should not silently decide>

evidence:
  - <durable source artifact, file, issue, observed behavior, or other useful provenance>
```

## Output quality rules

- Keep the artifact as small as possible while remaining standalone.
- Prefer one requirement per semantic promise.
- Use stable IDs such as `REQ-001` and `AC-001`; once another session references an ID, do not renumber it casually.
- Acceptance criteria verify the dependency from the seam, not the target's internal implementation.
- Separate established constraints from suggested design.
- Include concrete payload or interaction examples when they remove ambiguity, but label examples honestly.
- Do not include a receiving-side implementation plan, task decomposition, file list, or guessed architecture.
- Do not dump the source conversation. Distill only context needed to preserve meaning.

## Example

```yaml
kind: feature-handoff
version: 1
title: Expose registered agent metadata

source:
  component: agent-selection frontend
  need: Display available agents and let the user select an appropriate role.

target:
  component: backend agent-discovery API

objective: >
  Allow the frontend to discover currently registered agents without reading
  OpenCode configuration files directly.

context:
  current_behavior:
    - The frontend has no supported way to enumerate registered agents.

requested_behavior:
  - The backend exposes the registered agents available to the current OpenCode instance.
  - Available role and responsibility metadata is returned with each agent.

requirements:
  - id: REQ-001
    level: MUST
    text: The backend MUST expose the currently registered agents.
  - id: REQ-002
    level: MUST
    text: Each returned agent MUST include its name.
  - id: REQ-003
    level: SHOULD
    text: Each returned agent SHOULD include role and responsibility metadata when available.

acceptance:
  - id: AC-001
    given: At least one agent is registered in OpenCode.
    when: The frontend requests the available agents.
    then: The response contains that agent and its name.
  - id: AC-002
    given: A registered agent has no role metadata.
    when: The frontend requests the available agents.
    then: The agent remains discoverable without inventing role metadata.

constraints:
  - Existing agent definitions without role metadata must remain usable.

interface:
  status: suggested
  description: A read-only endpoint returning normalized agent metadata.
  example:
    method: GET
    path: /agents

open_questions:
  - Should unknown frontmatter fields be exposed or only normalized known metadata?
```

The example is illustrative. Do not copy its endpoint, fields, or assumptions into unrelated handoffs.
