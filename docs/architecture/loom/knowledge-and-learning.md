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

Loom keeps the canonical episode record in structured plugin storage with:
- exact evidence references;
- project/workflow provenance;
- active/retired status;
- SynaBun synchronization status.

SynaBun stores the semantic recall copy. A SynaBun hit is therefore a discovery mechanism, not the canonical record.

If SynaBun is unavailable, episode creation still succeeds. The record remains pending/failed for semantic synchronization and can be retried later.

### Heuristics

Cross-task or cross-project patterns that may improve future judgment.

Heuristics begin provisional.

Validation requires repeated support from independent workflow/project sources and an independent Reviewer or Critic decision.

If supporting episodic evidence is later retired, that support is removed and a heuristic is demoted from validated to provisional when the remaining evidence is insufficient.

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
4. SynaBun semantic recall for potentially relevant past experience;
5. canonical resolution of recalled `LOOM_EPISODE_ID` records through Loom;
6. targeted code inspection.

The current repository and current evidence are established before memory is allowed to influence judgment.

Broad codebase reading is a fallback, not the default.

## Learning Safety

The ordering is:

```text
current accepted authority
  > direct current evidence
  > validated heuristic
  > provisional heuristic
  > episodic memory
```

SynaBun is never product authority.

Every Loom-authored semantic memory embeds its canonical `LOOM_EPISODE_ID`. Agents resolve that ID against Loom before relying on the lesson, so a stale SynaBun copy can be detected as retired.

Durable learning requires real Loom evidence references. Free-form recollection is not sufficient.

If memory conflicts with current authority, current authority wins.

If a heuristic conflicts with direct current evidence, current evidence wins.

A useful lesson may influence research or design without silently becoming a mandatory product rule.

## Satisfies

- [BR-009](../../requirements/loom/br-009-maintain-living-repository-knowledge.md)
- [BR-010](../../requirements/loom/br-010-fresh-sessions-start-from-map.md)
- [BR-011](../../requirements/loom/br-011-preserve-learning-without-memory-as-law.md)
- [BR-013](../../requirements/loom/br-013-diagnose-root-causes.md)
