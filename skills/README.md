# Loom skills

Skills are optional methodology loaded by the authorized role. They never override Loom authority or control-plane state.

## Three-layer context model

A Loom skill directory can expose three deliberately different contexts:

| File | Consumer | Purpose |
| --- | --- | --- |
| `SKILL.md` | Producer / practitioner | **How do I do this work well?** Required for every skill. |
| `ASSESSMENT.md` | Reviewer | **Did the work satisfy accepted inputs and domain obligations?** Optional. |
| `QA.md` | Critic | **How could this still be wrong after competent production and review?** Optional. |

The split is about epistemic independence, not severity. `QA.md` is not "ASSESSMENT but stricter."

OpenCode discovers only `SKILL.md`. When a role loads a skill, the native skill tool also returns the skill base directory and a sampled companion-file list. Reviewer may then read `ASSESSMENT.md` if present; Critic may read `QA.md` if present.

Because the native skill tool injects `SKILL.md` while resolving that directory, Reviewer/Critic may also see practitioner guidance. That text is background only: Reviewer-specific criteria live in `ASSESSMENT.md`, Critic-specific adversarial methodology lives in `QA.md`.

## Core role methodology

| Loom role | Core skills |
| --- | --- |
| Designer | user-story and design-scenario when useful; design-specification; design-validation for realized experience; surface/design skills as needed |
| Specifier | behavioral-spec; behavioral-requirement, quality-scenario, and obligation-contract as needed |
| Architect | architectural-design; architectural-decision; architectural-spec |
| Planner | risk-driven-planning; work-decomposition |
| Acceptance | product-acceptance |
| Documenter | documentation |
| Reviewer | relevant skill `ASSESSMENT.md` files; design-review for design artifacts |
| Worker | task-relevant engineering/domain `SKILL.md` only |
| Diagnostic | narrow troubleshooting/domain `SKILL.md` matching the observed failure |
| Critic | small set of load-bearing/risky skill `QA.md` files |

## Loading discipline

Load the smallest useful set. A Go database task might use `golang-common-practice`, `golang-database`, and `golang-testing`; it should not load every Go skill.

Reviewer loads only assessment companions relevant to the reviewed surface. Critic loads QA companions only for load-bearing or materially risky domains, normally a small set rather than every skill touched by the workflow.

Absence of `ASSESSMENT.md` or `QA.md` is intentional and valid. Do not invent generic companion files for symmetry.

For Python tasks, use `python-how-to` / `python-common-practice` to select the relevant Python family.

For human-facing work, combine cross-surface skills (`information-architecture`, `interaction-design`, `user-flow-design`, `visual-interface-design`) only when that dimension is actually in scope, plus the relevant surface skill.

See `PORTING.md` for provenance and deferred source skills.
