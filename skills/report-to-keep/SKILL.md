---
name: report-to-keep
description: Decide whether an OKF-discoverable ephemeral Loom report should be promoted unchanged into durable repository reports. Use when the user asks to keep, preserve, commit, or promote a report.
---

# Report to Keep

Promotion is a retention decision, not an authority decision.

## Default

Operational reports are ephemeral by default. Reviews, failed or passed gates, design validation, diagnostics, research notes, and similar execution artifacts belong under `ephemeral-reports/` when they need file persistence.

Do not promote a report merely because it is useful during the current workflow.

## Method

1. Use OKF-MCP to locate and read the intended report. Do not recreate report discovery in Loom.
2. Validate the source through OKF-MCP and require no validation errors. The Loom report profile is `type: report <producer>`, non-empty `title` and `description`, and a non-empty string `tags` array.
3. Confirm the source lives under `ephemeral-reports/`, then decide whether the **report itself** has lasting documentary or audit value.
4. If only a conclusion, requirement, design rule, architectural constraint, or user instruction is durable, route that knowledge to the role that owns the proper governed document instead of promoting the raw report.
5. If the raw report deserves retention, choose a non-colliding destination under `docs/reports/<producer>/` matching the source producer namespace.
6. Call `loom_report_promote` with source, destination, and a concise reason.

## Promotion semantics

- Promotion copies the report unchanged.
- The ephemeral source remains in place.
- Promotion must never overwrite an existing durable report.
- Promotion does not turn findings into requirements, approval, architecture, product truth, or stronger evidence.
- A failed Critic/Reviewer/Readiness report remains a failed report after promotion.
- Do not rewrite provisional language, verdicts, confidence, or provenance during promotion.
- Do not manually copy a report into `docs/reports/`; use the Loom promotion tool.

## Usually keep ephemeral

- routine Reviewer or Critic output;
- failed readiness/gate reports whose findings have already been corrected;
- one-off design validation;
- debugging and diagnostic reports;
- transient research used to make another durable artifact;
- eval/run summaries reproducible from source evidence.

## Plausible promotion cases

- explicit audit or compliance evidence required by the repository;
- a postmortem or investigation report intentionally retained as a historical record;
- a research dossier whose source record itself is a maintained project artifact;
- a report the user explicitly wants preserved as durable project history.

When in doubt, keep the report ephemeral and have the owning role preserve only the durable knowledge in its proper authority-bearing document.
