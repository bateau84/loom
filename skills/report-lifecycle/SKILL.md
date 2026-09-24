---
name: report-lifecycle
description: Create Loom execution reports as valid ephemeral OKF artifacts. Use only when a specialist actually needs a file report; ordinary in-session findings do not require one.
---

# Loom Report Lifecycle

Reports are execution artifacts, not product authority.

## When to persist

Prefer an in-session return. Create a file report only when the assignment, later retrieval, audit trail, or another consumer materially benefits from a file artifact.

## Ephemeral report contract

1. Write only under `ephemeral-reports/<producer>/**`, matching the producing role.
2. Use the Loom OKF report profile:
   - `type: report <producer>`;
   - non-empty `title`;
   - non-empty `description`;
   - non-empty string `tags` array.
3. Validate the report through OKF-MCP before relying on OKF discovery or handing the file off as a discoverable report. If validation is unavailable or fails, the file may still exist, but report that boundary explicitly and do not represent discoverability/handoff as complete.
4. Keep verdict, evidence, uncertainty, provenance, and provisional wording faithful to the producing role's result.
5. A report never gains product, design, requirement, architecture, review, or evidence authority merely because it exists or validates.

## Retention

Ephemeral is the default. If the raw report itself appears to deserve durable retention, the producing specialist surfaces that retention need to General; **General alone** loads `report-to-keep` and may call `loom_report_promote`. Do not manually copy reports into durable documentation and do not use report promotion to smuggle conclusions into authority-bearing documents.
