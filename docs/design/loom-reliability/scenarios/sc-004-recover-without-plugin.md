---
type: design
title: SC-004 — Recover Without the Plugin
description: Synthetic failed-upgrade/manual recovery with explicit preservation and loss boundaries.
tags: [scenario, loom, recovery, isolation]
---

# SC-004 — Recover without the plugin

**Context:** An operator's synthetic installation contains acknowledged decisions, attempts, evidence and independent reviews. Controlled upgrade fails, including a variant where the plugin cannot start. All fixtures/sentinels are synthetic.

**Goal:** Recover protected progress without relying on the broken component or equating external effects with restored data.

**Scenario:** Before upgrade, a recovery point is verified and new admissions paused. Failure reports its exact boundary, not “everything rolled back” from one transaction's rollback. Instructions outside Loom let the operator identify target/recovery point and inspect impact. They choose an available safe path. After verified restoration with compatible code and safe writer fencing, re-entry shows retained work and remaining obligations before admissions resume.

**Failure / edge condition:** Protection is missing/unverified, newer work exists, restore is interrupted, or external outcomes are unknown. Block unsafe restoration, retain originals/selection and name remedy. Loss of named newer work requires explicit confirmation against current impact; unknown delta is not “no loss.” Cancelling recovery retains source material. Code recovery alone cannot claim data recovery or external undo.

**Observable outcome:** Broken startup does not strand the operator. Protected state is recoverable; restoration and uncertain effects have separate outcomes. Reviews remain historical, not fresh approvals. Isolation preflight refusal occurs before imports/setup/subprocesses can reach production; restrictions and synthetic sentinel proof establish isolation without opening production databases.

**Decisive contrasts:** Single-transaction failure versus failure after an earlier migration committed; restore with/without newer work; working/broken plugin; verified/interrupted recovery; accepted/refused isolation preflight. These expose different decisions and reject backup-file-only success.

**Derived from:** [US-003](../user-stories/us-003-recover-installation.md), Anchor journey 4 and safety; discovery R01/R03/R06–R07/R10–R14/R16 inform contrasts, not a live runbook or fixed technical design.
