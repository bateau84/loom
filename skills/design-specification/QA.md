# design-specification Quality Assurance

Critic-only adversarial contract. Assume competent production and Reviewer conformance; attack residual UX false confidence without creating new authority.

## QA criteria

- Walk representative Scenarios step by step and pause anywhere implementation would still need to invent user-visible behavior.
- Attack interruption, slow/failing dependencies, partial progress, back/cancel/retry, stale state, repeated action, and re-entry.
- Enter each reachable state through a non-happy path and ask whether the user knows what happened, what is preserved, and what they can do next.
- Switch input mode, viewport/device/terminal size, keyboard-only use, reduced motion, and assistive-technology assumptions where relevant.
- Search for local screen/component designs that are coherent individually but lose context or control across the complete journey.
- Remove visual styling/mockups mentally and check whether behavioral intent is still implementable.
- Search for nonexistent/mock product capability that makes an accepted journey look complete.
- Challenge design alternatives that differ only cosmetically when the underlying interaction direction was genuinely open.

## QA depth

Increase depth where a hidden UX decision could survive competent design/review and be discovered only during implementation or real use.
