# Loom skills

Skills are optional methodology loaded by the authorized role. They never override Loom authority or control-plane state.

## Core role methodology

| Loom role | Core skills |
| --- | --- |
| Designer | design-specification; design-validation for realized experience; surface/design skills as needed |
| Specifier | behavioral-spec |
| Architect | architectural-design; architectural-decision; architectural-spec |
| Planner | risk-driven-planning; work-decomposition |
| Acceptance | product-acceptance |
| Documenter | documentation |
| Reviewer | design-review for design artifacts plus task-relevant domain skills |
| Worker | task-relevant engineering/domain skills only |
| Diagnostic | narrow troubleshooting/domain skill matching the observed failure |

## Loading discipline

Load the smallest useful set. A Go database task might use `golang-common-practice`, `golang-database`, `golang-testing`; it should not load every Go skill.

For Python tasks, use `python-how-to` / `python-common-practice` to select the relevant Python family.

For human-facing work, combine cross-surface skills (`information-architecture`, `interaction-design`, `user-flow-design`, `visual-interface-design`) only when that dimension is actually in scope, plus the relevant surface skill.

See `PORTING.md` for provenance and deferred source skills.
