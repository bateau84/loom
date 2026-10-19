---
type: Behavioral Requirement
title: BR-001 — Record traceable concerns
description: Concern capture and provenance within the existing session ledger.
tags: [concerns, ledger, requirements]
timestamp: 2026-10-19T00:00:00Z
---
# BR-001 — Record traceable concerns

**Priority:** Must. **Status:** Implemented; registered-tool/SQLite evidence in [bundle overview](index.md), not live-host acceptance.

**Statement:** An agent shall be able to append a task-related concern through the record tool as a distinct concern record, retaining the existing ledger's identity, Action/task attribution, originating session attribution, and evidence/reference conventions.

**Acceptance criteria:**
- A valid concern call succeeds and returns an identifiable persisted record distinguishable from other record kinds.
- A task-associated concern preserves the supplied task association and recorded origin; recording must not reattribute it to a later reader or consolidator.
- Existing Action/selection association rules remain in force. A task association is not newly mandatory, and this change does not introduce unscoped writes, create an Action/Plan automatically, or reinterpret an explicitly invalid reference through fallback.
- Supplied evidence and artifact references retain their existing meanings and validation rules. A concern does not upgrade a reference into verified evidence or a suspected issue into a confirmed finding.
- Existing record validation, failure, and append-only guarantees apply equally to concerns. Invalid calls do not create a successful concern record. This change adds no stronger retry/idempotency or crash-recovery promise.
- Later commentary, consolidation, or a changed assessment does not overwrite the original concern or its provenance.

**Verification semantics:** Record a concern against an existing task with valid evidence/reference inputs; inspect its returned identity and persisted origin/task/references after a fresh read. Exercise invalid inputs under existing record rules and verify no successful record is created. Append a subsequent assessment and verify the original is unchanged. Run the same checks for an existing record kind to detect compatibility regressions.

## Derived from
User-authorized intent relayed in the 2026-10-19 assignment: “add concern type to record tool so task-related agent concerns are credible traceable session ledger”; “preserve origin/task/evidence and append-only history”; “using existing ledger conventions.” Distinct recording and preserved provenance are explicit; applying existing validation and failure semantics rather than inventing concern-specific behavior is a specification choice within the compatibility fence.
