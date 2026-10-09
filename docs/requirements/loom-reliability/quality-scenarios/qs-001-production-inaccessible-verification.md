---
type: quality-scenario
title: QS-001 — Verification Cannot Access Production State
description: Independent production inaccessibility before imports, setup and descendants with synthetic-only proof.
tags: [loom, isolation, verification, safety]
---

# QS-001 — Verification cannot access production state

**Statement:**
When tests/development verification start, including with misdirected ambient paths or early initialization, an independently enforced boundary shall prevent access to or mutation of production Loom databases/runtime state before imports, setup and descendant initialization.

**Acceptance criteria:**
- Establish/observe the boundary before product code executes. Enforcement does not depend solely on product cooperation, environment guards or test expectations. Descendants and startup/import/setup failure remain inside it.
- Use synthetic installations/sentinels only. Production opens are prohibited even read-only for an oracle, byte comparison or backup; live credentials/private runtime state are not inputs.
- Probe accidental ambient paths and realization-relevant escapes (for example mounts, paths, descendants or links). Access is independently denied; unchanged synthetic sentinel alone without restriction evidence is insufficient.
- Missing boundary/capability causes pre-execution denial with honest owned wait. No ambient-host fallback or isolation PASS; unavailable/failed probes remain unproven.
- Evidence identifies test/source identity, synthetic targets and independent restrictions at initialization/descendant boundaries. It does not prove production deployment safety or unfinished adapter success.

**Verification semantics:**
In separately authorized future isolated execution, attempt synthetic protected-state access before import, during setup and through descendants; independently observe restrictions and sentinel preservation. Never open production databases as oracle. This planning-only phase supplies no executable isolation PASS.

**Derived from:**
- [Accepted Anchor](../../../anchors/loom-reliability/anchor.md), safe testing and production-inaccessible verification.
