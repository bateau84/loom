---
name: loom-learning
description: Preserve reusable Loom lessons and heuristics without letting memory become authority. Use when current evidence reveals a lesson likely to matter beyond the current task or when existing learning must be validated, demoted, or retired.
---

# Loom Learning

Learning preserves experience; it does not create authority.

## Record

Record a lesson only when it is both reusable and supported by current Loom evidence. Prefer lessons about failure causes, successful engineering patterns, diagnostic traps, review findings, or operational behavior that are likely to recur.

1. Keep current accepted authority and current evidence primary.
2. Use `loom_learn_record` with the supporting evidence/provenance.
3. New heuristics are provisional unless independent support justifies stronger status.
4. When the result provides a `synabunRemember` payload, index it with `SynaBun_remember`. Failure of the semantic index does not invalidate the canonical Loom record.
5. Never store an unconfirmed theory as established learning.
6. When one or more recorded episodes justify a reusable general rule, any role may propose it with `loom_heuristic_propose`; it remains provisional until authorized independent review.

## Recall and correction

Semantic recall is advisory. Resolve canonical Loom episode IDs before relying on remembered material.

When direct evidence contradicts recalled learning:
- any role may treat it as stale for the current decision and surface the contradiction;
- only Reviewer or Critic performs canonical episode retirement/demotion and heuristic validation/retirement through `loom_heuristic_review` / the Loom review tools.

If a heuristic loses enough independent support, Reviewer/Critic demotes it rather than pretending it remains validated; loss of support alone does not prove the whole heuristic false.

Memory and heuristics never silently override current accepted authority or direct current evidence.
