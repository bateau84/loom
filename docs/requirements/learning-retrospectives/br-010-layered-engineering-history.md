---
type: Behavioral Requirement
title: BR-010 — Navigate layered engineering history
description: Shared progressive navigation for humans and agents over authoritative engineering evidence.
tags: [learning, history, navigation, dashboard, requirements]
timestamp: 2026-11-26T00:00:00Z
---

# BR-010 — Navigate layered engineering history

**Priority:** Must. **Status:** Accepted product direction from the operator's
#227 assignment; implementation and qualification are incremental, not claimed
complete by this requirement.

**Statement:** An authorized human or agent shall be able to start with a known
Action, Session or established objective, understand the overall shape and
coverage of its engineering history, and selectively inspect related work and
permitted originals without first enumerating every child Session or record.

**Acceptance criteria:**

- Offer distinct intent/overview, execution/decisions, assessment/outcome and
  exact-original views over shared source identities, relationships and coverage.
  Original evidence can be reached directly from any applicable view.
- Preserve historical Plan and WorkRef meaning. Show current intended work,
  recorded actual work, changes and unplanned work without making a completed
  node an independently verified outcome.
- With no Plan, provide a useful structure from observed records, Sessions and
  established relationships. Do not invent a Plan, objective boundary, assignment
  or execution attempt. Proposed analytical groupings stay distinguishable.
- Keep observations, authored claims/relationships and analytical interpretations
  separate. Preserve uncertainties, contradictory evidence, partial rechecks and
  unavailable originals, including in the overview.
- Use one underlying projection for structured agent reads, the readable document
  and the human dashboard. Presentation may differ; identities, qualifications
  and coverage agree for equivalent authorized scopes.
- Let the consumer expand coherent branches and follow stable scoped references.
  Explicitly distinguish bounded representative content, complete authorized
  aggregates and genuinely unknown measurements. Exhaustive traversal remains
  available but is not the normal prerequisite for an overview.
- Apply existing source, location, recipient, disclosure and retention restrictions
  to labels, counts, edges, previews, cursors and all output formats. References
  are not retrieval or transfer authority.
- Distinguish a live navigational read from an immutable retrospective selection.
  Existing complete Stage 3 batches retain their meaning; later freezing must
  preserve exact membership, versions, permitted views, basis and gaps.

**Verification semantics:** Compare planned and unplanned forms of the same
controlled engineering trajectory. An unfamiliar investigator must identify the
failure, rerun, correction and partial/full verification branches through
supported interfaces. Compare agent/document/dashboard identities and coverage,
deny protected sources at each applicable boundary and retain the explicit
missing-native-source qualifications. A first ledger-navigation increment can
satisfy a bounded subset only when the remaining owner dependencies are named.

## Derived from

- [Issue #227 — accepted layered engineering history direction](https://github.com/bateau84/loom/issues/227).
- [BR-001 — Preserve execution attribution](br-001-preserve-execution-attribution.md), [BR-002 — Preserve historical work scopes](br-002-preserve-historical-work-scopes.md), [BR-004 — Actual review basis and qualified findings](br-004-preserve-review-basis-and-verdict.md) and [BR-005 — Source evidence and gaps](br-005-expose-source-evidence-and-gaps.md).
- [OC-003 — Protected source and derived-report access](oc-003-protected-source-and-derived-report-access.md).

## Realized by

- [Layered engineering history architecture](../../learning-engineering-history.md), with its explicit first-delivery boundary.
- [QS-006 — Progressive history navigation](qs-006-progressive-history-navigation.md).
