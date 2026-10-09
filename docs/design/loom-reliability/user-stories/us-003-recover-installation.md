---
type: design
title: US-003 — Recover a Broken Installation Without Losing Trust
description: Understand and safely recover installation state even when the plugin cannot start.
tags: [user-story, loom, recovery, upgrades]
---

# US-003 — Recover a broken installation without losing trust

**Actor / context:** The person operating their installation, unable to start its plugin after an upgrade. Assumption: they can follow documented steps but should not need database expertise.

**Trigger:** Upgrade/startup failure prevents normal access to work.

**Goal:** Recover protected progress and understand remaining uncertainty without guessing state or silently losing newer work.

**Observable success:** Instructions remain accessible outside the plugin. Before acting, the person can identify the installation, verified pre-upgrade recovery point, affected durable work and newer work at risk. Code restoration, data restoration and external outcomes are separate. Loss requires specific confirmation. Re-entry shows preserved decisions, attempts, evidence and reviews plus unfinished obligations; restoration never manufactures PASS.

**Derived from:** [Anchor](../../../anchors/loom-reliability/anchor.md), safe testing/recovery and journey 4. Later proof uses synthetic installations, never production reads as canaries.
