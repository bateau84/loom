---
type: requirement
title: Loom Core Behavioral Requirements
description: Minimum behavioral contract for an autonomous, trustworthy OpenCode-native product-building AOS.
tags: [requirement, loom, aos, autonomy, quality, evidence]
---

**Status:** proposed

## Derived from

- `docs/anchors/loom/anchor.md`

## Requirements

### BR-001 — Run autonomously to a real boundary

After the user accepts an Anchor, Loom MUST continue through all expertise-solvable work without requiring routine user approvals.

Loom may stop for the user only when:
- product intent or material scope genuinely needs a user decision;
- a subjective product choice cannot be derived from accepted intent;
- a material guarantee would be weakened;
- explicit acceptance of material security, privacy, legal, financial, or destructive risk is required;
- a required capability remains unavailable after bounded recovery is exhausted.

A phase change, agent handoff, review result, planning boundary, or implementation wave is not by itself a user boundary.

### BR-002 — Route missing expertise explicitly

When work requires human-experience, behavioral, structural, implementation, research, verification, or holistic-adversarial expertise, Loom MUST route the work to a capable independent context rather than letting an unrelated context silently make that decision.

Routing MUST be explicit enough that required expertise cannot be skipped merely because the coordinating model forgets that it exists.

### BR-003 — Resolve technical unknowns before asking the user

Technical uncertainty MUST first use available repository evidence, current documentation, external research, experiments, and bounded specialist investigation.

Loom MUST NOT ask the user to answer a technical question that it can reasonably resolve itself.

Research that affects a load-bearing decision MUST use multiple relevant sources where practical and MUST distinguish fact, inference, uncertainty, and unresolved conflict.

### BR-004 — Produce the whole product

Loom MUST treat the accepted product outcome as the unit of completion.

Where applicable, completion includes:
- application code;
- usable user interface;
- persistence and data model;
- authentication and authorization;
- external integrations;
- configuration;
- failure and recovery behavior;
- operational visibility;
- deployment/runtime needs;
- user-facing documentation.

A locally complete component is not product completion.

### BR-005 — Prevent implementation from inventing missing meaning

Implementation MUST NOT silently define unresolved product behavior, human-facing semantics, guarantees, or structural authority.

When implementation reveals missing meaning, only the dependent work MUST pause. The missing decision is routed to the correct expertise, accepted knowledge is updated, and unaffected work may continue.

### BR-006 — Independent verification is normal; holistic attack is selective

Normal work MUST receive independent review against its accepted inputs, boundaries, and required evidence.

Holistic adversarial review MUST be used for:
- the assembled proposed solution before major implementation;
- the final realized product before acceptance;
- serious cross-domain disagreement or repeated failure that local review cannot resolve.

Where practical, holistic adversarial review MUST use a different model and fresh context from the producer, with independent directives or assessment criteria.

Holistic review MUST NOT reopen accepted decisions merely because another approach can be imagined; reopening requires new material evidence, contradiction, failed proof, or changed authority.

### BR-007 — Evidence outranks model claims

Claims about builds, tests, runtime behavior, integrations, security checks, or Product Acceptance MUST be backed by observed evidence.

A model statement such as "tests pass" is not evidence by itself.

Mocks, stubs, skipped paths, hand-injected state, or fabricated inputs MUST NOT be presented as proof of real product-owned behavior when they bypass the behavior being claimed.

### BR-008 — Bounded autonomy and progress

Every repeated attempt MUST produce at least one of:
- new material evidence;
- a materially changed hypothesis;
- a materially changed strategy;
- a reduced unresolved set.

Otherwise Loom MUST stop repeating the same approach and reroute or stop safely.

Workflows MUST support practical bounds on expensive reasoning, retries, review loops, parallel work, and total resource use.

Budget exhaustion or exhausted recovery MUST produce an honest resumable state, not fabricated success.

### BR-009 — Maintain living repository knowledge

As the product changes, Loom MUST maintain concise documentation sufficient to explain:
- what the product is for;
- important behavior and guarantees;
- major modules and their public seams;
- component and dependency relationships;
- important data and state;
- external integrations;
- important end-to-end flows;
- operational and user-facing usage where relevant.

Documentation MUST change when the represented reality changes.

Documentation MUST NOT be created or expanded solely because ceremony requires another artifact.

Repository knowledge SHOULD use OKF-compatible documents and SHOULD be discoverable through OKF tooling when available.

### BR-010 — Fresh sessions start from the map, not the whole codebase

A fresh Loom session MUST be able to recover the product's purpose, important structure, current authority, and likely investigation surface from maintained repository knowledge before requiring broad codebase exploration.

The system map is navigation, not proof: current code claims still require current inspection when they matter.

### BR-011 — Preserve useful learning without turning memory into law

Loom MUST retain useful lessons from failures, successful patterns, reviews, research, and product work.

Learned material MUST distinguish at least:
- current accepted authority;
- workflow state;
- episodic experience;
- provisional or validated heuristics.

Memory and heuristics MUST NOT silently override current accepted product authority.

A heuristic SHOULD become broadly trusted only after independent supporting evidence or repeated successful use.

### BR-012 — Prefer deep modules and remove obsolete implementation

When designing or materially restructuring code, Loom SHOULD prefer modules with:
- a small, clear interface;
- substantial useful behavior hidden behind that interface;
- a clean seam;
- tests that exercise the public interface;
- implementation details that callers do not need to understand.

Loom MUST NOT preserve old implementation merely because additive code is easier. When a replacement makes old code obsolete, the plan MUST include safe removal or migration unless current evidence requires compatibility.

### BR-013 — Diagnose root causes, not just symptoms

Troubleshooting MUST seek a confirmed root cause or an explicitly bounded evidence gap.

A probable theory may guide experiments but MUST NOT be treated as confirmed cause.

When a mitigation is necessary before root cause is known, Loom MUST record it as mitigation rather than silently declaring the underlying issue solved.

### BR-014 — Support deliberate sparring before execution

Loom MUST provide an interactive mode where the user can explore ideas, challenge assumptions, compare alternatives, and refine fuzzy intent before accepting an Anchor.

This mode SHOULD push back on weak reasoning rather than optimizing for agreement.

Once execution begins from an accepted Anchor, ordinary implementation work MUST NOT repeatedly reopen product intent without new material evidence.

### BR-015 — YuHaul is the minimum end-to-end proof

Loom's first acceptable release MUST demonstrate these requirements by taking the accepted YuHaul product intent to a real usable product without manual agent herding.

The proof MUST include a later fresh-session maintenance exercise in which Loom understands enough of YuHaul from its maintained knowledge to diagnose and repair a real defect.

Leash-level complexity is the longer-term target, not a requirement for Loom's first usable release.

### BR-016 — OpenCode is the required initial host

The first Loom implementation MUST run inside OpenCode.

The requirements MUST NOT assume Leash or another future runtime exists.
