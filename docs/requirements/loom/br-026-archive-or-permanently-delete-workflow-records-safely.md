---
type: requirement
title: BR-026 — Archive or Permanently Delete Workflow Records Safely
description: Archive and permanent deletion behavior that preserves project files, retained evidence, provenance, and completed work.
tags: [requirement, loom, workflow, lifecycle, cleanup]
---

# BR-026 — Archive or Permanently Delete Workflow Records Safely

**Status:** proposed

## Statement

Every workflow MUST be archivable or permanently deletable. Ordinary Delete MAY archive a workflow; archived workflows are hidden from the main list and available in a separate Archived view, where Permanent Delete is available. An Active workflow MUST be cancelled before it can be permanently deleted. Archiving or permanent deletion MUST preserve project files, retained evidence and provenance, and completed work.

## Acceptance Criteria

1. Any workflow can be archived. Ordinary Delete may perform that archival; the workflow is then absent from the main list and discoverable in the separate Archived view.
2. Permanent Delete is available for archived workflows. If an Active workflow is targeted for permanent deletion, Loom requires cancellation first; cancellation itself does not delete or archive unless separately requested.
3. A user can explicitly distinguish archive from permanent deletion and the consequence of the selected action before it is performed.
4. Archive and permanent deletion do not modify project files, retained evidence/provenance, or completed work. Preserved evidence/provenance remains attributable to the workflow after its workflow record is deleted.
5. Rejection, failure, or uncertain outcome is not reported as successful archive/deletion; protected material remains preserved and the outcome is inspectable.
6. An archived workflow remains available in Archived view until Permanent Delete is explicitly selected; archiving is not treated as permanent deletion.

## Verification Semantics

For workflows in each lifecycle state, verify ordinary Delete can archive, that archival removes the workflow from the main list and places it in Archived view, and that Permanent Delete is available there. Verify an Active workflow cannot be permanently deleted before cancellation and that cancellation alone does not delete. Compare project files, retained evidence/provenance, and completed work before and after both archival and permanent deletion, including attribution of retained material to the deleted workflow. Exercise denied, failed, and uncertain outcomes and verify no false success or protected-material loss.

## Derived from

- User-confirmed workflow lifecycle boundary: all workflows can be archived or permanently deleted; Active must first be cancelled; ordinary Delete may archive into a separate Archived view, where Permanent Delete is available; project files, retained evidence/provenance, and completed work remain protected.
- Accepted Loom Anchor, especially AC 10, 12, 14, and 24 (evidence-based truth, safe recovery, bounded work, and inspectability).
