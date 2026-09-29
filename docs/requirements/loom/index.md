# Loom Requirements

Navigation and relationship entry point for Loom's product requirements.

- [BR-001 — Run Autonomously to a Real Boundary](br-001-run-autonomously-to-real-boundary.md)
- [BR-002 — Route Missing Expertise Explicitly](br-002-route-missing-expertise-explicitly.md)
- [BR-003 — Resolve Technical Unknowns Before Asking the User](br-003-resolve-technical-unknowns-before-user.md)
- [BR-004 — Produce the Whole Product](br-004-produce-the-whole-product.md)
- [BR-005 — Prevent Implementation from Inventing Missing Meaning](br-005-prevent-implementation-inventing-meaning.md)
- [BR-006 — Independent Verification Is Normal; Holistic Attack Is Selective](br-006-independent-review-and-selective-critic.md)
- [BR-007 — Evidence Outranks Model Claims](br-007-evidence-outranks-model-claims.md)
- [BR-008 — Bounded Autonomy and Progress](br-008-bounded-autonomy-and-progress.md)
- [BR-009 — Maintain Living Repository Knowledge](br-009-maintain-living-repository-knowledge.md)
- [BR-010 — Fresh Sessions Start from the Map](br-010-fresh-sessions-start-from-map.md)
- [BR-011 — Preserve Useful Learning Without Turning Memory into Law](br-011-preserve-learning-without-memory-as-law.md)
- [BR-012 — Prefer Deep Modules and Remove Obsolete Implementation](br-012-prefer-deep-modules-and-remove-obsolete-code.md)
- [BR-013 — Diagnose Root Causes, Not Just Symptoms](br-013-diagnose-root-causes.md)
- [BR-014 — Support Deliberate Sparring Before Execution](br-014-support-deliberate-sparring.md)
- [BR-015 — YuHaul Is the Minimum End-to-End Proof](br-015-yuhaul-is-minimum-proof.md)
- [BR-016 — OpenCode Is the Required Initial Host](br-016-opencode-required-initial-host.md)
- [BR-017 — Concurrent Sessions and Projects Are Compartmentalized](br-017-concurrent-sessions-projects-compartmentalized.md)
- [BR-018 — External Operational Dashboard](br-018-external-operational-dashboard.md) — proposed; dashboard Archive/Permanent Delete surface for the newer all-workflow user boundary, with prior terminal-only OQ retained as history and current source gaps called out.
- [BR-019 — Keep Workflow Ceremony Proportional](br-019-keep-workflow-ceremony-proportional.md)
- [BR-020 — Conversation Is Loom's Primary Interface](br-020-conversation-is-primary-interface.md)
- [BR-021 — Preserve Holistic Plan Context Across Handoffs](br-021-preserve-holistic-plan-context.md)
- [BR-022 — Support Planning-Only Objective Completion](br-022-support-planning-only-objective-completion.md)
- [BR-023 — Explain Work State and Genuine Blockers](br-023-explain-work-state-and-blockers.md)
- [BR-024 — Preserve Authority Ownership Through Handoffs](br-024-preserve-authority-ownership-through-handoffs.md) — proposed; every Loom role (including Planner) is eligible for appropriately typed Tasks/OQs; General/Planner discover current OpenCode roster/descriptions and Loom planning insights; runtime validates supported role paths, dependencies, and gates without silent Worker fallback or inferred completion. `.loom` preferences are advisory and custom `loom:` frontmatter is not used. Supported role-safe execution is reviewed; universal routing and roster discovery are not implemented.
- [BR-025 — Govern Command Access and Preserve Work in Git](br-025-govern-command-access-and-preserve-work-in-git.md) — proposed; restrictive defaults with effect-/ownership-based command and Git elevation, explicit User authorization across the ownership/recovery boundary, exact authorship/provenance, and truthful commit/push/PR outcomes. Current implementation support is not established.
- [BR-026 — Archive or Permanently Delete Workflow Records Safely](br-026-archive-or-permanently-delete-workflow-records-safely.md) — proposed; all-state in-flight uncertainty, cancel/revoke ordering, archive markers, quiescence-gated permanent deletion, and retained evidence; preserves the earlier terminal-only OQ as historical and discloses current source gaps.
- [BR-027 — Pause, Resume, and Revisit Workflow Work](br-027-pause-resume-and-revisit-workflow-work.md) — proposed; deliberate backburnering, specific-workflow pause confirmation, all-state uncertainty, unrelated-request yielding, and backtracking.

## Obligation contracts

- [OC-001 — Independent Question-Consumer Reconciliation](oc-001-independent-question-consumer-reconciliation.md) — applies across question answer, consumer reconciliation, and readiness decisions; complements BR-017 and BR-021.
- [OC-001 — Review Repair Ownership and Independent Approval](obligation-contracts/oc-001-review-repair-independence.md)

## Archive/delete authority and implementation status

The terminal-failed/cancelled dashboard restriction in OQ `3fb7f28b-e116-4765-9366-d2a84c9f7222` is preserved as the historical answer to that earlier question. Later user decisions (intent OQs `16d3ec71-209a-480d-91c3-35a114f84b17`, `bd7d6b42-c822-4c9c-9fd0-882badb4aa41`; quiescence OQ `b3232418-978f-4209-bdbe-68f3c26814a1`; and explicit all-workflow update in this workflow on 2026-09-29 without a separate OQ ID) set a newer user-approved candidate boundary. BR-018 and BR-026 remain proposed until the revised product Anchor is accepted. Current source is documented as terminal-cleanup-only and deletes OQ answer/attribution records; it therefore does not demonstrate conformance with all-workflow lifecycle or evidence preservation and is not evidence of deployed runtime behavior.

Each requirement is its own OKF document so relationships, dependencies, retrieval, and future supersession remain explicit and machine-discoverable.
