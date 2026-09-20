---
name: work-decomposition
description: Find coherent implementation work boundaries before Loom Planner creates the executable Worker DAG. Use when accepted work admits several plausible task splits.
---

# Work Decomposition

Analyze finely; dispatch coarsely.

## Method

1. Start from accepted outcomes, obligations, architecture, and design—not files.
2. Group work by coherent capability/module boundary.
3. Separate work only when the boundary matters to dependency order, ownership, verification, safety, or independent execution.
4. Preserve integration work across meaningful seams.
5. Keep independently runnable work parallel only when write surfaces and dependencies genuinely permit it.
6. Prefer deep-module tasks over one-task-per-file decomposition.
7. Treat design/architecture/requirement artifacts as authority inputs, never Worker write targets.

## Output to Planner

For each candidate group provide:
- objective;
- natural write surface;
- dependencies;
- relevant skill names;
- verification expectations;
- integration/acceptance implications.

Planner still owns the actual Loom task graph.
