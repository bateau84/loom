# design-specification Reviewer Assessment

Reviewer applies the **implementation-without-UX-invention test**: a competent implementation team should be able to build the accepted journey without deciding material human-facing semantics.

## Review criteria

- Design traces to accepted product intent and relevant User Stories/Scenarios without fabricating missing product capability.
- Information hierarchy, flows, entry/exit points, branches, abandonment, and recovery compose into complete human journeys.
- Every material action has an explicit observable response and resulting state across applicable success/failure paths.
- Reachable loading, empty, disabled, validation/error, success, stale/interrupted, and domain states are specified where relevant; meaningless states are not added by quota.
- Error/cancel/back/retry/interruption behavior states what progress/context is preserved and where the user re-enters.
- Focus, keyboard, pointer/touch, dynamic-content, motion, destructive-action, and accessibility semantics are explicit where relevant.
- Responsive/surface adaptation changes the interaction model deliberately rather than only rearranging pixels.
- Behavioral intent stands independently of mockups/visual styling; visual semantics communicate meaning rather than hide behavior.
- Consequential design choices retain rationale/alternatives, while backend/API/schema/persistence realization remains outside Designer authority.
- Human-visible meaning is compatible with accepted Specifier obligations where they overlap; disagreements are surfaced rather than normalized.

## Review depth

Scale with scenario/state count, asynchronous behavior, destructive/recovery paths, multiple surfaces/input modes, responsive adaptation, and accessibility risk.
