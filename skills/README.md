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

## Product-development methods

These are optional methods within existing roles, not a new workflow or additional gates.

| Method | Primary use and ownership |
| --- | --- |
| `product-discovery` | General keeps the problem, smallest useful outcome, evidence, and benefit assumptions visible; Designer and Research contribute within their existing domains. |
| `solution-synthesis` | General coordinates constructive reconciliation; Designer, Specifier, and Architect retain their own decisions and authoritative artifacts. |
| `product-lifecycle` | Architect leads applicable setup, operation, recovery, and upgrade coverage; Specifier/Designer own observable and human-facing meaning. Planner carries accepted work; Acceptance owns real scenario proof. |

Use `risk-driven-planning` during discovery and solution development as well as decomposition when a decisive assumption could invalidate dependent work. A bounded authorized experiment may carry uncertain value; an accepted Anchor is permission/meaning, not proof of benefit.

Reuse existing conversations, permitted handoffs, owner artifacts, Plan, and verification surfaces. Do not add a master product document, require every specialist on every change, or turn possible lifecycle concerns into accepted scope. Reviewer/Critic use the new skills' distinct companions only when relevant to their assigned review or attack.

The focused cases in `evals/product-development.json` cover these decisions; see `evals/product-development.md` for scope and commands.

## Loading discipline

Load the smallest useful set. A Go database task might use `golang-common-practice`, `golang-database`, and `golang-testing`; it should not load every Go skill.

Reviewer loads only assessment companions relevant to the reviewed surface. Critic loads QA companions only for load-bearing or materially risky domains, normally a small set rather than every skill touched by the workflow.

Absence of `ASSESSMENT.md` or `QA.md` is intentional and valid. Do not invent generic companion files for symmetry.

For Python tasks, use `python-how-to` / `python-common-practice` to select the relevant Python family.

For TypeScript tasks, use `typescript-common-practice` as the language baseline and add `typescript-type-safety`, `typescript-async`, or `typescript-testing` only when that concern is material. Load `javascript-runtime` when JavaScript execution semantics are load-bearing, and `browser-runtime` for direct Web API work. Existing design, accessibility, observability, performance, and UI skills remain the owners of those cross-cutting concerns.

For human-facing work, combine cross-surface skills (`information-architecture`, `interaction-design`, `user-flow-design`, `visual-interface-design`) only when that dimension is actually in scope, plus the relevant surface skill.

Use `feature-handoff` when work in one component or session discovers functionality that another independently handled component, repository, or fresh session must provide. The skill produces a standalone copy/paste request rather than transferring conversation history.

See `PORTING.md` for provenance and deferred source skills.
