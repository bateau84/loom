---
type: Behavioral Requirement
title: BR-005 — Expose source evidence and coverage gaps
description: Preserve an inspectable basis for retrospective interpretation without inventing unavailable content.
tags: [learning, evidence, coverage, requirements]
timestamp: 2026-11-12T00:00:00Z
---
# BR-005 — Expose source evidence and coverage gaps

**Priority:** Must. **Status:** Proposed for independent requirements assessment; not an implemented or verified runtime capability.

**Statement:** For authorized evaluation and review, Loom shall expose original, retrievable source material or an explicit, source-linked coverage limitation for each material claim that depends on that evidence.

**Acceptance criteria:**
- Bounded observations distinguish recorded identity/digest from original retrievable content. A content hash alone is never presented as the underlying tool return, transcript or artifact.
- Available content is exposed only through an authorized source or permitted retained snapshot with stable identity/version; a disappeared source after compaction or deletion is an explicit gap.
- Partial, redacted, withheld, capture-disabled, opaque or failed observation coverage remains distinguishable from a complete record and from evidence that no event occurred.
- Existing bounded metadata capture and its opt-out retain their meaning; protected additional payload capture is not silently enabled and depends on separate operator authorization.
- A report can name its material missing sources and explain which conclusions remain unqualified without storing inaccessible hidden model reasoning as if it were observed.

**Verification semantics:** Use a known source tool return, a digest-only event, an opaque nested operation, a redacted payload, deleted or compacted history and capture-disabled work. Inspect authorized evaluation input and readback; fail if missing content is filled with inference or claims of exhaustive capture.

## Derived from
The user-approved intent for [PR #233](https://github.com/bateau84/loom/pull/233) is to preserve correct Session/dispatch/task evidence and make whole-work, multi-Session learning automatic. The [accepted architecture](../../learning-evidence-and-review-scope.md) records the resulting constraints; its technical choices are not independent authority to add product behavior.
