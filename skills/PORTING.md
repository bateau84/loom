# Loom skill-port decisions

Source inventory: `nrkno/mats-opencode-setup/skills`.

Loom uses skills as **on-demand methodology**. Skills do not create authority; Loom role directives and control-plane state remain authoritative.

## Three-layer inheritance

The original skill library's useful separation between practitioner methodology and independent assessment is preserved and extended:

- `SKILL.md` — practitioner methodology;
- `ASSESSMENT.md` — Reviewer-only normal conformance/domain assessment;
- `QA.md` — Critic-only Quality Assurance attacks aimed at residual false confidence.

The old AOS `ASSESSMENT.md` files often mixed Reviewer criteria, Critic adjudication, and scaling. During Loom migration, Reviewer content stays in `ASSESSMENT.md`; Critic/adversarial content moves to `QA.md`. Old lifecycle/gate semantics are not restored.

Companions are optional. They are added only when they carry domain-specific discriminating value.

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
- report-to-keep
- hallmark
- design-implementation
- prototyping

### Hallmark and design-craft adaptation

Hallmark is now included in the trusted baseline as a self-contained Loom-native adaptation, not a verbatim import of the large source overlay. Source inspected: `nrkno/mats-opencode-setup/skills/hallmark/SKILL.md`, version `1.1.0`, Git blob `bc6ef6237a286a791461b14dc81d0e3eefd6f965`. The adaptation preserves context-led visual production, meaningful structural exploration, existing-system inspection, honest copy, token discipline, and deliberate craft.

The upstream theme catalog, provider branding/integration, automatic theme rotation, universal eight-state quotas, append-only tokens, fixed layout recipes, self-awarded scores, and extra user checkpoints are not imported. The two bundled Hallmark references replace dependencies on the old cookbook; `design-implementation` no longer points to absent upstream files. This is not a promise of compatibility with the upstream command verbs, numbered gates, or theme catalog.

`prototyping` retains scenario walkthroughs, command transcripts, state/key maps, pseudocode, comparative analysis, and static rendered exploration; compact text templates are in its `references/`. It now also supports scoped interactive experiments. Static HTML existed before this change; the corrected gap was interactive/surface capability and evidence boundaries, not the total absence of visual prototypes.

Design direction and production-pattern references extend the existing Experience Design handoff. Designer and Worker have explicit loading/consumption hooks; the existing review and validation methods evaluate craft without a new agent, authority document, or approval gate. No tool permission, runtime schema, or workflow state is changed by these methodology edits.

## Baseline reusable families

The baseline includes reusable methodology for:

- accessibility and human-centered design;
- CLI, TUI, desktop, and web interface design;
- information architecture, interaction design, user flows, visual hierarchy, context-led web visual craft, and prototyping;
- Git commit/conflict/PR discipline;
- Go implementation, testing, debugging, TUI, database, concurrency, observability, security, performance, and common libraries/tooling;
- Python implementation, async, database/ORM, FastAPI, Pydantic, testing, linting, typing, observability, and error handling;
- JavaScript runtime semantics plus TypeScript common practice, type safety, async correctness, testing, and browser Web API implementation;
- observability/infrastructure: Prometheus, PromQL, Loki, Mimir, OpenTelemetry, dashboards, infrastructure telemetry;
- Terraform module/provider testing and provider resources/actions/docs;
- MCP server construction;
- language-agnostic TDD and performance methodology.

Legacy role nouns in copied house skills were normalized to current Loom terminology where practical. Current Loom role directives/control-plane state always override stale coordination wording inside a technical reference.


## Recovered portable authoring knowledge

The initial Loom port intentionally rewrote `skill-authoring` to remove old AOS governance. That rewrite preserved the main authority boundary but compressed several portable authoring conclusions too aggressively. Loom now explicitly restores the generalizable parts without restoring the old workflow engine:

- descriptions are retrieval contracts: capability first, concrete trigger anchors, narrow sibling exclusions, and re-testing after meaningful trigger compression;
- progressive disclosure keeps the load-bearing normal path in `SKILL.md` while direct references carry depth;
- skill structure follows the work type rather than one universal template;
- instruction specificity scales with risk and fragility;
- Skills preferentially encode durable procedure/heuristics while fast-changing operational facts come from current runtime sources;
- reusable Skills should compose rather than grow into monoliths;
- new behavioral/discipline rules should be grounded in observed RED evidence when practical;
- examples, source claims, and imported methodology remain honest and attributable;
- realistic behavioral evals verify outcomes/decisions, while Loom's central eval system owns execution, isolation, judging, evidence, cost control, and ablation.

Portable source lineage includes `nrkno/mats-opencode-setup/skills/skill-authoring/references/authoring-principles.md`, the accepted skill-system architecture, and the later skill-authoring lifecycle. AOS-specific hub/spoke routing, old readiness/task-manager gates, report contracts, skill-local provider scheduling, and historical approval choreography remain intentionally excluded.

## Deliberately deferred from the trusted baseline

- `readiness` — duplicates obsolete Solution Readiness composition gating.
- `improve-my-code` — old hub/spoke dispatch and user-checkpoint workflow; needs a Loom-native redesign.
- `compress` — destructive external-model overwrite workflow.
- `find-skills` — external skill discovery/installation is outside the trusted baseline.
- `graphify` — optional external CLI/index integration.
- `visual-companion` — interactive browser-side workflow; not required by prototyping, which uses only actually available tools and current permissions.
- `teach-me` and `i-have-adhd` — user/persona modes, not autonomous workflow methodology.
- `azure-image-builder` — useful but specialized infrastructure workflow; add when a Loom-managed project needs Azure image building.
- `golang-samber-*` — package-specific optional skills; add when a project actually uses the corresponding Samber package.

## Port rule

Copy/adapt a source skill when it is reusable domain methodology and does not redefine Loom authority, routing, gates, evidence, permissions, or user checkpoints.

Rewrite useful skills that touch those governance surfaces.

Split old mixed assessment contracts by epistemic owner rather than copying their lifecycle language.

Defer optional package/persona/external-integration skills until a real project requires them.
