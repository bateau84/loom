# Loom skill-port decisions

Source inventory: `nrkno/mats-opencode-setup/skills`.

Loom uses skills as **on-demand methodology**. Skills do not create authority; Loom role directives and control-plane state remain authoritative.

## Rewritten for Loom

These were rewritten because the source versions encoded old AOS roles, gates, readiness, or artifact workflows:

- agent-file-authoring
- skill-authoring
- behavioral-spec
- architectural-design
- architectural-decision
- architectural-spec
- work-decomposition
- risk-driven-planning
- product-acceptance
- documentation
- design-specification
- design-review
- design-validation

## Baseline reusable families

The baseline includes reusable methodology for:

- accessibility and human-centered design;
- CLI, TUI, desktop, and web interface design;
- information architecture, interaction design, user flows, visual hierarchy, and prototyping;
- Git commit/conflict/PR discipline;
- Go implementation, testing, debugging, TUI, database, concurrency, observability, security, performance, and common libraries/tooling;
- Python implementation, async, database/ORM, FastAPI, Pydantic, testing, linting, typing, observability, and error handling;
- observability/infrastructure: Prometheus, PromQL, Loki, Mimir, OpenTelemetry, dashboards, infrastructure telemetry;
- Terraform module/provider testing and provider resources/actions/docs;
- MCP server construction;
- language-agnostic TDD and performance methodology.

Legacy role nouns in copied house skills were normalized to current Loom terminology where practical. Current Loom role directives/control-plane state always override stale coordination wording inside a technical reference.

## Deliberately deferred from the trusted baseline

- `readiness` — duplicates obsolete Solution Readiness composition gating.
- `report-to-keep` — tied to old ephemeral-report persistence.
- `improve-my-code` — old hub/spoke dispatch and user-checkpoint workflow; needs a Loom-native redesign.
- `compress` — destructive external-model overwrite workflow.
- `find-skills` — external skill discovery/installation is outside the trusted baseline.
- `graphify` — optional external CLI/index integration.
- `hallmark` — large opinionated design overlay; may be added explicitly for projects that want it.
- `visual-companion` — interactive browser-side workflow.
- `teach-me` and `i-have-adhd` — user/persona modes, not autonomous workflow methodology.
- `azure-image-builder` — useful but specialized infrastructure workflow; add when a Loom-managed project needs Azure image building.
- `golang-samber-*` — package-specific optional skills; add when a project actually uses the corresponding Samber package.

## Port rule

Copy/adapt a source skill when it is reusable domain methodology and does not redefine Loom authority, routing, gates, evidence, permissions, or user checkpoints.

Rewrite useful skills that touch those governance surfaces.

Defer optional package/persona/external-integration skills until a real project requires them.
