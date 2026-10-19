---
type: Log
title: Concern requirements change log
description: Changes to the concern record behavioral baseline.
tags: [concerns, requirements]
timestamp: 2026-10-19T00:00:00Z
---
# Change log

## 2026-10-19

- Implementation: concern kind now follows existing add, evidence validation, exact/Session reads, bounded context and Action/Session full history. [Overview evidence](index.md) maps all six acceptance cases to registered-tool tests; simulated host, not live installed acceptance.
- Guidance: updated [tool guide](../../tools.md), [implementation boundaries](../../design.md), [context policy](../../context-relevance.md), live tool help, configured agent guidance and bundled Loom guide. Capture is shared; General routing and critic consolidation map to coordination/qa responsibilities, not native IDs. No lifecycle, structured links, escalation or gates added.
- Status: marked [BR-001](br-001-record-traceable-concerns.md), [BR-002](br-002-expose-concerns-through-ledger-views.md) and [OC-001](oc-001-concern-interpretation-and-agent-duties.md) implemented at their stated verification boundaries; accepted requirements unchanged.

- Creation: [BR-001](/docs/requirements/concern-records/br-001-record-traceable-concerns.md), [BR-002](/docs/requirements/concern-records/br-002-expose-concerns-through-ledger-views.md), [OC-001](/docs/requirements/concern-records/oc-001-concern-interpretation-and-agent-duties.md), and [bundle overview](/docs/requirements/concern-records/index.md), from relayed user-authorized intent; implementation pending.
- Update: reconciled baseline with existing tool/design/context/evidence documentation; retained existing association and evidence semantics, identified integration coverage, and specified bounded acceptance cases and deferred capabilities.
