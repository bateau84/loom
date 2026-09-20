---
name: design-specification
description: Produce an implementation-ready human-experience handoff for Loom Designer covering views, states, interactions, flows, accessibility, and surface constraints.
---

# Design Specification

Use after human-facing decisions are sufficiently formed and before structural realization depends on them.

## Include what applies

- experience goal and scenarios;
- information hierarchy/navigation;
- user/task flows;
- views/regions/components by user purpose;
- interaction states and transitions;
- loading/error/empty/success/recovery behavior;
- focus and keyboard behavior;
- responsive/surface constraints;
- accessibility requirements with verification;
- visual semantics/tokens when material.

Write behavior so an independent Architect/Worker/Reviewer can implement or verify it without another Designer conversation.

Do not choose backend protocols, persistence, component topology, or other architecture merely because the design needs a capability.
