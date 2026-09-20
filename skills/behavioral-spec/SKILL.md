---
name: behavioral-spec
description: Define falsifiable observable behavior, guarantees, failure semantics, and edge cases from accepted Loom product authority. Use for Specifier work. Not for structural realization.
---

# Behavioral Specification

Use this skill when Specifier must turn accepted product meaning into implementation-independent, falsifiable behavior.

## Boundary

Own **what must be observably true**. Do not choose components, schemas, protocols, storage, libraries, deployment topology, or other structural realization.

A refusal to choose architecture does not complete the task: fully specify the behavior that is inside Specifier authority.

## Method

1. Read the accepted Anchor and relevant already-accepted behavioral authority.
2. Identify the externally observable outcome or seam guarantee.
3. State preconditions and triggering conditions.
4. Define ordering, precedence, continuation/termination, and state-transition semantics where relevant.
5. Define success, failure, cancellation, timeout, retry/recovery meaning only when accepted authority actually determines them.
6. Cover material edge cases and ambiguous combinations.
7. Make every normative statement falsifiable by naming what evidence would prove or disprove it.
8. Route unresolved product meaning through a blocking Loom OQ rather than inventing it.

## Output

Prefer the smallest durable requirement set that is independently understandable by Architect, Worker, Reviewer, and Acceptance.

Do not encode implementation choices merely because they make the requirement easier to write.
