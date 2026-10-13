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
2. If the targeted workflow is Active, Loom first cancels it and revokes its authority to continue active work. Neither Archive nor Permanent Delete proceeds until cancellation/revocation has taken effect; an attempted operation against Active work cannot bypass this ordering. Cancellation alone does not establish that already-admitted external operations have stopped.
3. In any workflow state, including after cancellation, pause/yield, resume, or other transition from Active, the observable workflow status explicitly marks unresolved in-flight-operation uncertainty and keeps supporting evidence available. Archive may remove the workflow from the default view while such uncertainty remains only if Archived view preserves the uncertainty/in-flight marker and evidence needed to substantiate it and support a later quiescence decision. Archival or a state transition does not represent confirmed quiescence.
4. Permanent Delete is available for an archived workflow and requires explicit user confirmation that the workflow record will be permanently removed. It MUST NOT proceed while any previously admitted external operation has unconfirmed quiescence, regardless of the workflow's current lifecycle state. Missing, declined, or ambiguous confirmation, or unconfirmed quiescence, leaves the record archived and its uncertainty/evidence available.
5. Permanent Delete removes the workflow record from ordinary and Archived views; unlike Archive, the workflow record is no longer available as a current or archived workflow. Evidence/provenance and completed work that must be retained remain preserved and attributable to that workflow.
6. Archive and permanent deletion do not modify project files, retained evidence/provenance, or completed work.
7. Rejection, failure, or uncertain outcome is not reported as successful cancellation, archive, or permanent deletion; protected material remains preserved and the outcome is inspectable.

## Authority Status

This requirement remains **proposed** and does not replace the accepted product Anchor. The earlier user resolution in OQ `3fb7f28b-e116-4765-9366-d2a84c9f7222` established dashboard cleanup limited to explicitly confirmed terminal failed/cancelled workflow records. It remains unchanged as the recorded answer to that earlier question. The user's later explicit all-workflow Archive/Permanent Delete decision in the authority-reconstruction workflow follow-up (2026-09-29; no separate OQ ID supplied), together with the user decisions in intent OQs `16d3ec71-209a-480d-91c3-35a114f84b17` and `bd7d6b42-c822-4c9c-9fd0-882badb4aa41`, establishes the newer candidate product direction. The later answer to OQ `b3232418-978f-4209-bdbe-68f3c26814a1` qualifies that lifecycle: Archive can proceed after cancellation with uncertainty evidence in Archived view, but Permanent Delete waits for confirmed quiescence. These newer decisions do not silently reinterpret or overwrite the earlier OQ or assert that the proposed Anchor has been accepted.

**Current implementation gap:** repository evidence describes cleanup of terminal failed/cancelled workflows only and reports that `plugins/loom/workflow-cleanup.ts` removes OQ records, including answered content and attribution. This does not implement or prove conformance to the proposed all-workflow Archive/Permanent Delete behavior or its evidence-retention guarantee. This is a source-level gap, not a claim about deployed runtime behavior.

## Verification Semantics

For workflows in every represented lifecycle state (including Active, cancelled, paused/yielded/backburnered, resumed, terminal, and Archived), exercise a previously admitted operation with unconfirmed quiescence: every status exposes the uncertainty marker and supporting evidence; Archive may remove the workflow from the default view only if Archived view retains them; no transition implies quiescence; Permanent Delete remains unavailable until quiescence is confirmed. Verify that an Active workflow is cancelled and its active-work authority revoked before either Archive or Permanent Delete can proceed, and failure to reach that boundary prevents the transition. Verify Permanent Delete also requires explicit user confirmation and removes the workflow record only after that confirmation and quiescence, while either unmet condition leaves it archived with marker/evidence intact. Compare project files, retained evidence/provenance, and completed work before and after cancellation, archive, and permanent deletion, including attribution of retained material to the removed workflow. Exercise denied, failed, and uncertain outcomes and verify no false success or protected-material loss.

## Derived from

- Earlier user resolution of dashboard cleanup in OQ `3fb7f28b-e116-4765-9366-d2a84c9f7222` (terminal failed/cancelled workflow-record cleanup only; retained files, evidence, and completed work protected). This earlier answer remains recorded and is not rewritten here.
- User decisions in intent OQs `16d3ec71-209a-480d-91c3-35a114f84b17` and `bd7d6b42-c822-4c9c-9fd0-882badb4aa41`, together with the explicit all-workflow scope in the authority-reconstruction workflow follow-up request (2026-09-28; no separate OQ ID supplied): all workflows may be archived or permanently deleted; Active work must first be cancelled/revoked before either action; ordinary Delete may archive into a separate Archived view; Permanent Delete there requires explicit confirmation; project files, retained evidence/provenance, and completed work remain protected.
- User answer to blocking OQ `b3232418-978f-4209-bdbe-68f3c26814a1`: after cancellation, Archive may remove a workflow from the default dashboard only if Archived view preserves an explicit uncertainty/in-flight-operation marker and relevant evidence; Permanent Delete must wait until quiescence is confirmed; protected files/evidence/provenance/completed work remain intact.
- User follow-up decision (2026-09-28; no separate OQ ID supplied) extends the uncertainty invariant to every workflow state, not only a workflow that was formerly Active: preserve marker/evidence while operations remain unresolved, and require confirmed quiescence before Permanent Delete.
- Accepted Loom Anchor, especially AC 10, 12, 14, and 24 (evidence-based truth, safe recovery, bounded work, and inspectability).
