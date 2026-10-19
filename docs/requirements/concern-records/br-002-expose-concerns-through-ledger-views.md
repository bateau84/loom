---
type: Behavioral Requirement
title: BR-002 — Expose concerns through ledger views
description: Keep recorded concerns discoverable through existing context and history behavior.
tags: [concerns, history, requirements]
timestamp: 2026-10-19T00:00:00Z
---
# BR-002 — Expose concerns through ledger views

**Priority:** Must. **Status:** Implemented; registered-tool/context/history evidence in [bundle overview](index.md), not live-host acceptance.

**Statement:** Persisted concerns shall participate in existing record-reading, session-context, and history surfaces under their existing selection, filtering, ordering, and size limits, rather than disappearing solely because their kind is concern.

**Acceptance criteria:**
- A concern qualifying for an existing ledger view is eligible on the same basis as comparable record entries; full history includes it when within the requested scope.
- Readers can distinguish its kind, recover its identity, and read its concern text and existing attribution/reference information to the extent the corresponding surface exposes such information for records generally.
- A context sample may omit concerns because of its ordinary selection/size limits; it must not exclude the kind categorically. This requirement does not promise every concern in every sample.
- Existing histories remain readable and existing record kinds keep their meanings. No historical data rewrite is required.

**Verification semantics:** Append a concern and an existing-kind record in a controlled scope; retrieve record/history/context views with sufficient limits and verify both are eligible and the concern remains identifiable. Include a bounded context case to verify ordinary truncation still applies. Read a pre-change history and verify unchanged interpretation.

## Derived from
User-authorized intent relayed in the 2026-10-19 assignment: concerns must be a “credible traceable session ledger, not buried in handoffs.” Discoverability through the existing ledger is a necessary consequence: accepting but systematically omitting concerns from readers would defeat this outcome. Keeping existing view limits and declining an unconditional context-delivery guarantee are ordinary compatibility choices, not a new escalation mechanism.
