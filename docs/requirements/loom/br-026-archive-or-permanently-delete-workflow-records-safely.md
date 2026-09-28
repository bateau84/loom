---
type: requirement
title: BR-026 — Archive or Permanently Delete Workflow Records Safely
description: Safe cancellation, archival, and explicitly confirmed permanent deletion that preserves project files, retained evidence, provenance, and completed work.
tags: [requirement, loom, workflow, lifecycle, cleanup]
---

# BR-026 — Archive or Permanently Delete Workflow Records Safely

**Status:** proposed

## Statement

Every workflow MUST be archivable or permanently deletable. Ordinary Delete MAY archive a workflow; archived workflows are hidden from the default view and remain available in a separate Archived view, where Permanent Delete is available. Before either Archive or Permanent Delete, an Active workflow MUST be cancelled and its ability to continue active work revoked. Permanent Delete MUST require the user's explicit confirmation of permanent record removal. These actions MUST preserve project files, retained evidence and provenance, and completed work.

## Acceptance Criteria

1. Any workflow can be archived. Ordinary Delete may perform that archival; the workflow is then absent from the default view but remains discoverable in Archived view. Archive retains the workflow record; it is not permanent removal.
2. If the targeted workflow is Active, Loom first cancels it and revokes its authority to continue active work. Neither Archive nor Permanent Delete proceeds until this has taken effect; an attempted operation against Active work cannot bypass this ordering. The workflow is not silently deleted by cancellation.
3. Permanent Delete is available for an archived workflow and requires explicit user confirmation that the workflow record will be permanently removed. Missing, declined, or ambiguous confirmation leaves the record archived and unchanged.
4. Permanent Delete removes the workflow record from ordinary and Archived views; unlike Archive, the workflow record is no longer available as a current or archived workflow. Evidence/provenance and completed work that must be retained remain preserved and attributable to that workflow.
5. Archive and permanent deletion do not modify project files, retained evidence/provenance, or completed work.
6. Rejection, failure, or uncertain outcome is not reported as successful cancellation, archive, or permanent deletion; protected material remains preserved and the outcome is inspectable.

## Authority Status

This requirement remains **proposed** and does not replace the accepted product Anchor. The earlier user resolution in OQ `3fb7f28b-e116-4765-9366-d2a84c9f7222` established dashboard cleanup limited to explicitly confirmed terminal failed/cancelled workflow records. It remains unchanged as the recorded answer to that earlier question. The user's later explicit decision in this workflow's follow-up request (2026-09-28; no separate OQ ID supplied) broadens the candidate product lifecycle scope to all workflows, with Archive and Permanent Delete as distinct outcomes and preservation guarantees. This BR records that later direction for consideration in the proposed revised Anchor; it does not silently reinterpret or overwrite the earlier OQ or assert that the proposed Anchor has been accepted.

## Verification Semantics

For workflows in each lifecycle state, verify ordinary Delete can archive, archival removes the workflow from the default view but retains it in Archived view, and Permanent Delete is available there. For an Active workflow, verify cancellation and revocation of active-work authority occur before either Archive or Permanent Delete can proceed; verify failure to reach that boundary prevents the requested transition. Verify Permanent Delete requires explicit user confirmation and removes the workflow record, while a declined/missing confirmation leaves it archived. Verify Archive leaves the workflow record retrievable in Archived view. Compare project files, retained evidence/provenance, and completed work before and after cancellation, archive, and permanent deletion, including attribution of retained material to the removed workflow. Exercise denied, failed, and uncertain outcomes and verify no false success or protected-material loss.

## Derived from

- Earlier user resolution of dashboard cleanup in OQ `3fb7f28b-e116-4765-9366-d2a84c9f7222` (terminal failed/cancelled workflow-record cleanup only; retained files, evidence, and completed work protected). This earlier answer remains recorded and is not rewritten here.
- Later explicit user decision in the authority-reconstruction workflow follow-up request (2026-09-28; no separate OQ ID supplied): all workflows may be archived or permanently deleted; Active work must first be cancelled/revoked before either action; ordinary Delete may archive into a separate Archived view; Permanent Delete there requires explicit confirmation; project files, retained evidence/provenance, and completed work remain protected.
- Accepted Loom Anchor, especially AC 10, 12, 14, and 24 (evidence-based truth, safe recovery, bounded work, and inspectability).
