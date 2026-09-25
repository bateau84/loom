---
name: user-story
description: Capture a small human-centered User Story from accepted product intent without turning it into a system requirement or implementation design. Use for durable US artifacts.
---

# User Story

Use when a human-facing capability or change needs a durable statement of **who is trying to achieve what, in what context, and how they know they succeeded**.

A User Story is design authority about human intent. It is not a Behavioral Requirement, architecture, task, or UI component specification.

## Method

1. Identify the closest accepted product/user authority for the human need.
2. Name the actor by meaningful role/context, not a generic "user" when the context changes design decisions.
3. State the trigger or situation that creates the need.
4. State the human goal/outcome, not the feature or interface mechanism.
5. State observable success from the person's perspective.
6. Keep the story implementation-independent. Do not prescribe screens, APIs, storage, components, or technical workflow.
7. Keep one coherent human goal per story. Split stories when actors, goals, or success conditions materially differ.
8. Do not use a Story to create product capability absent from accepted authority. Surface the gap instead.
9. Use Scenarios for concrete end-to-end situations, branches, interruptions, or failures that exercise the story.

## Durable artifact

New durable stories live under:

```text
docs/design/<anchor-slug>/user-stories/
  us-NNN-<descriptive-slug>.md
```

```markdown
# US-NNN — <descriptive title>

**Actor / context:**
<who, and context that materially affects the need>

**Trigger:**
<what situation causes the need>

**Goal:**
<what the person needs to accomplish or understand>

**Observable success:**
<what the person can observe/know when the goal is achieved>

**Derived from:**
- <closest accepted product/user authority>
```

Prefer this explicit form over ceremonial "As a / I want / so that" prose when the latter hides context or success semantics.
