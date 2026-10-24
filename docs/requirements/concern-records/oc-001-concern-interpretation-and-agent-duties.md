---
type: Obligation Contract
title: OC-001 — Concern interpretation and agent duties
description: Shared meaning between concern authors, routing agents, consolidators and ledger readers.
tags: [concerns, agents, contracts]
timestamp: 2026-10-19T00:00:00Z
---
# OC-001 — Concern interpretation and agent duties

**Priority:** Must. **Status:** Guidance implemented; source-lookup and guidance checks summarized in the bundle's `index.md`; see the [implementation boundaries](../../design.md). This is not proof of universal agent compliance.

**Participants:** Concern-writing agents; General as routing agent; critic as consolidator; ledger readers.

General and critic describe responsibilities in the user's workflow, not guaranteed native agent IDs. Guidance uses the actual roster/configured roles; it does not provision or rename agents.

**Preconditions:** An agent identifies a task-related uncertainty, possible problem, or confirmed problem worth preserving for other agents. This contract governs tool guidance and agent instructions; it does not require automated detection or enforcement of agent compliance.

**Guarantees:**
- Guidance directs every agent to record its own task-related concerns, rather than relying only on a handoff or assuming another agent will record them.
- A concern is a recorded concern, not proof of a defect. Its content distinguishes uncertainty/suspicion from a confirmed finding and states the supporting evidence or what remains unknown. Confirmation must not be inferred merely from record kind or the existence of a reference.
- General routes blockers through the existing coordination process; this is an agent responsibility, not automatic tool escalation or a new execution gate.
- Critic consolidates patterns with the identities of the source concern records, preserving traceability and distinguishing suspected from confirmed claims. Consolidation does not replace or silently resolve source concerns.
- “Documented,” “outside the current task,” and “handed off” do not mean resolved. Recording alone does not establish resolution.

**Semantic input/output:** Input is an attributed concern with its assessment, context and available support. Output is a durable concern and, when agents route or consolidate it, attributable commentary referencing its record identity. No new structured relationship field, status enum, or lifecycle operation is required; representations remain an integration decision under existing ledger conventions.

**Failure semantics:** Missing evidence remains uncertainty rather than fabricated confirmation. Missing routing or consolidation is not evidence of resolution. Failure to record is not successful preservation. This contract adds no guaranteed response time, automatic retry, notification, or escalation delivery.

**Invariant:** Neither documentation, routing, nor consolidation changes the original record's origin or transforms an unresolved question into a verified resolution.

**Verification semantics:** Inspect shipped record help and agent guidance for each responsibility. Walk through (1) a suspected issue without proof, (2) a supported confirmed issue, and (3) an outside-task documented concern. Verify guidance preserves the distinctions. Have a consolidating agent reference two recorded concerns by their returned identities and verify a reader can locate the unchanged originals using existing ledger reading. These checks demonstrate the supported convention, not universal future agent compliance.

## Derived from
User-authorized intent relayed in the 2026-10-19 assignment: “Concern uncertainty differs from confirmed defect; outside-task or documented does not mean resolved”; “Every agent records, General routes blockers, critic consolidates patterns with linked concern IDs and distinguishes suspected/confirmed.” Guidance rather than mandatory enforcement, and use of existing textual/reference conventions without a lifecycle API, are ordinary specification choices constrained by “no automatic escalation, mandatory gates, elaborate risk workflow.”
