---
type: Quality Scenario
title: QS-001 — Concurrent execution attribution
description: Keep events and review sources correctly attributed despite parallel, reused, nested or changing execution context.
tags: [learning, concurrency, provenance, quality]
timestamp: 2026-11-12T00:00:00Z
---
# QS-001 — Concurrent execution attribution

**Priority:** Must. **Status:** Proposed for independent requirements assessment; not an implemented or verified runtime capability.

**Statement:** During concurrent or nested subagent execution, invocation reuse, retry, and mid-flight scope changes, captured evidence shall remain attributable to its true known execution and work revision, and uncertain relationships shall remain explicitly unqualified.

**Acceptance criteria:**
- A late tool result after another Task becomes selected retains the source invocation/selection established at its start.
- Two dispatches sharing a child Session do not borrow each other's results. Ambiguous reused native call IDs or opaque tool wrappers do not become confident cross-pairs.
- Review findings created concurrently with producing tasks retain the reviewing execution's author and exact subject links, not the source task's author.
- Any unsupported host identity results in an inspectable coverage gap rather than false observed completeness.

**Verification semantics:** Trigger concurrent/nested work, reused child Sessions, overlapping calls with equal arguments, late finishes and changed focus. Inspect persisted evidence after restart for false pairing or reassignment; a single incorrectly matched event falsifies this scenario.

## Derived from
- [BR-001 — Preserve execution attribution](br-001-preserve-execution-attribution.md)
- [BR-002 — Preserve historical work scopes](br-002-preserve-historical-work-scopes.md)
- [BR-004 — Preserve review basis](br-004-preserve-review-basis-and-verdict.md)
