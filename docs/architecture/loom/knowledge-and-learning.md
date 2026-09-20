---
type: design
title: Loom Knowledge and Learning
description: Living OKF documentation, fresh-session recovery, episodic memory, and evidence-backed heuristic learning.
tags: [architecture, loom, documentation, memory, heuristics, okf]
---

**Status:** proposed

## Four Knowledge Classes

### Authority

Durable product truth:
- Anchor;
- requirements;
- accepted human-facing design;
- accepted architecture;
- other normative product documents.

Authority lives in the repository and uses OKF-compatible relationships.

### Workflow state

Short-lived execution state:
- active tasks;
- blockers;
- OQs;
- retries;
- evidence references;
- budgets;
- completion state.

Workflow state does not become product authority.

### Episodic learning

Useful experience from actual work:
- failure causes;
- successful recovery approaches;
- provider/API surprises;
- implementation lessons;
- review escapes.

Episodic memory is searchable context, not law.

### Heuristics

Cross-task or cross-project patterns that may improve future judgment.

Heuristics begin provisional unless strong prior evidence exists.

Promotion requires independent supporting evidence or repeated successful use.

## Living Repository Map

Every produced product maintains enough current knowledge to answer:

- What is this product?
- What are its major components?
- How do they relate?
- Where does important state live?
- What external systems exist?
- What are the important end-to-end flows?
- What are the public seams of major deep modules?
- Where should a fresh agent start for a given class of problem?

This map should be concise and navigational.

It must not duplicate the codebase.

## Documentation Update Rule

When implementation changes documented reality, the same body of work updates the affected knowledge.

Unaffected documentation is left alone.

Planned behavior is clearly distinguished from implemented reality.

## Fresh-Session Bootstrap

A fresh General/Diagnostic session begins with:
1. Anchor discovery;
2. relevant requirement/design/architecture lookup through OKF;
3. system-map lookup;
4. relevant episodic/heuristic retrieval;
5. targeted code inspection.

Broad codebase reading is a fallback, not the default.

## Learning Safety

If memory conflicts with current authority, current authority wins.

If a heuristic conflicts with direct current evidence, current evidence wins.

A useful lesson may influence research or design without silently becoming a mandatory product rule.

## Satisfies

- [BR-009](../../requirements/loom/br-009-maintain-living-repository-knowledge.md)
- [BR-010](../../requirements/loom/br-010-fresh-sessions-start-from-map.md)
- [BR-011](../../requirements/loom/br-011-preserve-learning-without-memory-as-law.md)
- [BR-013](../../requirements/loom/br-013-diagnose-root-causes.md)
