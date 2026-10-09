---
type: quality-scenario
title: QS-002 — Controlled Upgrade and Plugin-Independent Recovery
description: Protect acknowledged pre-upgrade durable state and restore honestly after transaction or release failure.
tags: [loom, upgrade, rollback, recovery, durability]
---

# QS-002 — Controlled upgrade and plugin-independent recovery

**Statement:**
Before a controlled upgrade begins, Loom shall pause new work admissions and establish a verified recovery point protecting all pre-upgrade acknowledged durable Loom state; failed-upgrade release recovery shall restore that protected state with compatible code/safe writer fencing, including when the upgraded plugin cannot start.

**Acceptance criteria:**
- The protected cut includes all acknowledged durable installation/project/work/decision/attempt/evidence/review state and required recoverable artifacts, not convenient database fields alone. Upgrade mutation begins only after recovery-point completeness, integrity and restorability are verified. Verification failure prevents upgrade, not best-effort warning.
- Admissions stay paused until code/state compatibility, writer fencing and state consistency are established. Already-running operations are accounted for: pre-cut acknowledged work is protected; later outcomes remain attributed and are not silently dropped. Fence stale processes, not merely the visible plugin.
- A failed individual migration transaction has no partial committed state/success receipt from that transaction. Earlier committed steps may remain after a later failure; this does not prove whole-release rollback.
- Separately demonstrate restoration after an earlier committed step and a committed defective build. Code rollback is not data/schema rollback. Restore the protected durable state with compatible code before reopening admission, without invented proof/verdicts.
- Manual recovery can inspect necessary recovery information and restore through a supported path that does not import/initialize/rely on registration of the broken plugin. This capability is not permission for production operations in this phase.
- Before restore that could discard newer acknowledged work, identify affected work/loss and obtain explicit user confirmation. Without it refuse destructive activation, retain recoverable work and expose preservation/reconciliation. A recovery point remains valid for its protected cut, not automatically current after later writes.
- Wrong identity, incomplete/corrupt recovery point, disk/permission failure and interrupted restore must not cause partial activation, mixed incompatible generations, speculative consent or fabricated completion. Preserve usable protected originals; report failed/unproven condition and remedy. Destruction of all copies is not claimed recoverable from nonexistent information, nor counted as passing recovery.
- Internal restore does not automatically undo external effects. Disclose known/unresolved outcomes; do not replay uncertain effects merely because restored records predate them.

**Verification semantics:**
Use synthetic acknowledged examples of every protected fact family. Demonstrate restoration, not backup-file existence. Inject failure before commit, after a committed step, at defective-plugin import and during restore activation. Exercise stale writers, incomplete data, wrong identity, disk/permission failure, newer work without/with explicit consent and unresolved external effects. Compare synthetic facts with verified protected cut and observe compatible-code/fencing behavior. No production opens, current-backup assumption or live upgrade; unexecuted/unsupported outcomes remain unproven.

**Derived from:**
- [Accepted Anchor](../../../anchors/loom-reliability/anchor.md), accepted pre-upgrade durability, admission pause, release rollback, plugin-independent recovery and no silent loss.
- Specifier choice: protected acknowledgement cut and verified completeness/restorability before mutation. Representation, backup mechanism and running-operation treatment remain Architect-owned.
