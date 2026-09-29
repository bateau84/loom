---
type: anchor
title: Loom — Autonomous Product-Building AOS
description: OpenCode-native agent operating system that turns user intent into trustworthy, usable software with minimal human intervention.
tags: [anchor, loom, aos, autonomy, opencode, software-engineering]
---

**Status:** accepted

## Goal

Build an OpenCode-native Agent Operating System that can take a user's product intent, refine it into a clear accepted outcome, and autonomously produce a trustworthy real-world software product.

The user should provide intent and genuinely user-owned decisions. Loom should handle the remaining research, design, specification, architecture, planning, implementation, verification, documentation, troubleshooting, and learning without requiring the user to herd agents.

Quality and correctness are more important than speed. Autonomy must remain bounded: Loom must stop safely rather than fabricate success, repeat failed work indefinitely, or consume unbounded resources.

Loom's first proving ground is **YuHaul**. Its longer-term target is harder: Loom should become capable of building and evolving **Leash** itself.

## First Principles

1. **Intent is authority; implementation is evidence.** Code, tests, bugs, and fixes help reveal current behavior and gaps, but do not by themselves determine desired product scope or guarantees.
2. **Conversation is the primary interface.** The user expresses outcomes and genuine choices; Loom privately coordinates proportionate expertise and durable work.
3. **Every planned obligation has clear accountability.** A planned work item must identify its accountable role and a supported execution or decision path. Work must not silently default to Worker when another authority owns the decision or deliverable. When responsibility changes, make the handoff explicit; when no valid path exists, report the blocker rather than claim completion.
4. **Expertise and independent authority remain distinct.** Specialists own decisions and deliverables in their domains; independent review, Critic challenge, and user acceptance are not interchangeable with implementation or coordination.
5. **Make observable behavior and material guarantees explicit.** Dependent work must not invent missing product meaning; define seams and failure/recovery expectations where correctness depends on them.
6. **Evidence outranks claims.** Verification, product behavior, and historical incidents are described only at the level supported by observed evidence, with uncertainty and provenance visible.
7. **Recover truthfully and preserve what matters.** Interruption, failure, stale information, and unavailable capabilities must not appear successful; recovery preserves valid user intent, evidence, and completed work.
8. **Autonomy is bounded and progress must be real.** Loom stops or reroutes rather than looping without material progress, exceeding agreed limits, or making false completion claims.
9. **Maintain useful knowledge, not ceremony.** Durable artifacts and repository maps should help future work; implementation details do not become semantic authority merely because they are documented.

## Acceptance Criteria

1. Loom can turn an initially vague product idea into a clear Anchor through focused user questions and independent research.
2. After the Anchor is accepted, Loom proceeds autonomously until completion or a genuinely user-owned decision blocks progress.
3. Technical questions are researched or routed to the capable specialist instead of being unnecessarily sent to the user.
4. Loom can determine and produce the full product solution, including code, user experience, data model, authentication, integrations, persistence, failure handling, deployment needs, and operational behavior where applicable.
5. Human-facing behavior is deliberately designed rather than emerging accidentally from implementation.
6. Observable behavior and important guarantees are explicitly defined before dependent implementation invents them.
7. Structural and technical decisions are made deliberately from accepted product behavior, realistic constraints, and current evidence.
8. Planning preserves the accountable role and supported execution/decision path for every mandatory work item. A Worker completion cannot substitute for a required specialist decision or user acceptance. Unrepresentable or unavailable ownership remains an explicit blocker.
9. Independent review checks normal work for correctness, conformance, security, evidence quality, and boundary drift.
10. Holistic adversarial review challenges the assembled proposed solution and the final realized product from a fresh model/context where practical.
11. Claims of successful builds, tests, integrations, runtime behavior, or Product Acceptance require observed evidence; model assertions alone are insufficient.
12. Fake, mocked, skipped, or hand-constructed verification cannot stand in for the real product-owned behavior it claims to prove.
13. Loom can recover from normal adversity by inspecting evidence, researching, testing hypotheses, trying bounded alternatives, and routing to the correct authority.
14. Repeated work must show real progress through new evidence, a changed hypothesis, a changed strategy, or a reduced unresolved set; otherwise Loom stops or reroutes instead of looping.
15. Workflows have bounded resource use, including practical limits on retries, review loops, parallelism, and expensive adversarial reasoning.
16. Loom produces maintainable code with deep, well-defined modules and replaces or removes obsolete implementation when appropriate rather than endlessly adding parallel code paths.
17. Loom maintains concise living documentation describing product intent, important behavior, components, dependencies, data, integrations, major flows, and usage as the system evolves.
18. Documentation is updated when the represented reality changes; documentation work must not become ceremony that blocks useful progress.
19. A fresh session can understand the repository's purpose and important structure from its maintained knowledge base before needing to explore the entire codebase.
20. Loom preserves useful lessons from successful work and failures so later sessions and projects can benefit from them.
21. Learned heuristics remain evidence-backed and advisory until sufficiently validated; memory never silently overrides current accepted product authority.
22. Loom supports deep diagnostics that seek root cause rather than merely mitigating symptoms.
23. Loom supports deep research using multiple relevant sources, explicit uncertainty, and active attempts to prove and disprove important theories.
24. Loom's normal primary conversation supports sparring, deep research, diagnosis, and refinement before or outside autonomous execution without requiring the user to select an agent or workflow mode.
25. The user can inspect what Loom is doing, why it is doing it, what evidence supports it, and why it stopped when work cannot safely continue.
26. Loom runs inside OpenCode.
27. Loom presents one primary user-facing identity and automatically selects proportionate specialists, durable artifacts, and governance after the user commits to execution.
28. The external dashboard is an observational companion for working-directory, session, workflow, status, and evidence inspection. Inspection does not authorize or perform execution or planning changes.
29. A user can Archive any workflow to remove it from the default dashboard and find it in an Archived view. An Active workflow must be cancelled before it can be archived or permanently deleted. If an admitted operation may still be in flight, Archive preserves an explicit uncertainty marker and relevant evidence; Permanent Delete is available from the Archived view only after explicit confirmation and confirmed quiescence. Neither action deletes project files, retained evidence/provenance, or completed work. Cancellation, Archive, and Permanent Delete are distinct transitions.
30. A reviewed plan-only Objective outcome is a useful intermediate result, clearly distinct from a completed product Objective and granting no implementation authority.
31. A user can deliberately pause/backburner a workflow and resume it later without losing its task, plan, evidence, or provenance. Pause is distinct from cancellation and dashboard-refresh pause. A confirmed pause prevents new workflow operations from being admitted; it does not imply already-admitted host operations have stopped or quiesced. Loom keeps their in-flight/uncertain state and evidence visible and reconciles their outcomes before dependent work resumes.
32. When the user asks for unrelated work during an active workflow, Loom must confirm the pause boundary for that specific workflow before proceeding with the unrelated request. It preserves separate context and truthfully discloses any already-admitted operation that may still be in flight; uncertainty remains visible until resolved.
33. Loom can revisit earlier work when current evidence requires it, preserving history and invalidating affected downstream results, claims, and approvals rather than silently treating stale work as current.
34. An agent can request task-scoped command elevation when a required command is denied. Permitted in-scope commands can continue immediately; destructive, host-wide, and out-of-approved-path commands require explicit user approval. Availability is not blanket execution permission.
35. Git commands needed for authorized work can be requested through command elevation with exact authorship and scope preserved. Agents commit their work as it progresses and push to origin when available; General or an authorized agent can create a PR when the work is concluded. Missing origin or rejected commit/push is reported truthfully, not treated as successful publication.

## Minimal Version

The first usable Loom must prove itself by taking the **YuHaul** product from accepted Anchor to a real, usable application without manual agent herding.

That run must include, as needed:

1. research;
2. human-centered design;
3. behavioral specification;
4. technical architecture;
5. independent review;
6. one holistic adversarial solution review;
7. executable planning;
8. implementation of the full product surface, including UI, persistence, authentication and external integration;
9. observed build/test/runtime verification;
10. real Product Acceptance;
11. final holistic adversarial review;
12. maintained repository knowledge sufficient for a fresh session to understand and continue the system.

After YuHaul is built, Loom must also be able to enter a fresh session and diagnose and repair a later YuHaul defect without requiring the user to reconstruct the product or architecture.

YuHaul is the minimum proof. **Leash is the long-term capability target**: Loom should eventually be trustworthy enough to build and evolve a system of Leash's complexity.

## Not This

- A chat assistant that mainly explains how the user could build something
- A system that requires the user to manually coordinate normal agent handoffs
- An agent role-play organization where additional personas are treated as quality by themselves
- A process that creates documentation, requirements, architecture records, or reviews only because a fixed ceremony says so
- Unlimited autonomous recursion, retries, review loops, or token consumption
- Treating model confidence as evidence
- Treating locally green tests as proof of the assembled product when they do not exercise it
- Letting implementation silently define missing product meaning
- Letting a Worker silently stand in for a role-owned decision or deliverable
- Reopening accepted decisions without new material evidence
- Keeping obsolete code merely because additive changes are easier
- Depending on the user to answer technical questions that Loom can reasonably research or resolve itself
- General support for hosts other than OpenCode in the first version
- A replacement for Leash; Loom must be useful before Leash exists and may later benefit from Leash runtime enforcement

## Reserved Decisions

The user retains authority over:

- the product goal and material scope;
- subjective product/taste choices when accepted intent does not resolve them;
- material weakening of accepted guarantees;
- explicit acceptance of material security, privacy, legal, financial, or destructive-operation risk;
- explicit acceptance of any future replacement for this accepted Loom Anchor.

Routine technical, design, implementation, planning, research, and verification choices are not user approval gates when they remain inside accepted authority.

## Context

- This document is the current accepted Loom product Anchor. Its revised content was explicitly accepted by the user from `docs/anchors/loom/anchor.proposed.md` on 2026-09-28; the prior accepted revision is superseded.
- The user's resolved surface boundaries are: dashboard directory/session/workflow views are read-only inspection; any workflow may be archived out of the default view; an Active workflow must first be cancelled; an Archived workflow may be permanently deleted only after explicit confirmation and confirmed quiescence, while project files, retained evidence/provenance, and completed work remain protected; reviewed plan-only is an intermediate outcome and grants no implementation authority.
- The user has explicitly directed that planned work make its accountable role clear. Proposed BR-024 and Architect's role-aware execution design capture this target; neither is current implementation authority.
- The current Plan-to-Worker compiler still routes every executable Plan Task to Worker. The role-aware design is proposed and is a separate future implementation change; this Anchor does not claim the capability exists.
- Current cleanup code deletes answer-bearing OQ records and attribution despite the accepted retention boundary. This is a known implementation-versus-intent gap, not proof of a historical incident and not authorization to repair code in the current authority-reconstruction effort.
- Proposed BR-025–027 now record user intent for scoped command elevation and Git publication, workflow Archive/Permanent Delete, pause/resume, unrelated-request yielding, and backtracking; they remain proposed and do not claim the current runtime supports these behaviors.
- Loom's first end-to-end proving product is YuHaul; Leash is the longer-term capability target.
- Conversation is the outer interaction loop. The user can spar, research, and debug with Loom naturally, then commit to execution and let Loom choose the engineering process.
- The system should favor software-enforced workflow, evidence, limits, and state where possible, while using models for judgment, reasoning, creativity, implementation, review, and adversarial challenge.
- Previous AOS work is research material only and carries no automatic product authority unless this accepted Anchor explicitly adopts it.
- Repository knowledge should follow OKF-compatible structure and be accessible to agents through OKF tooling where available.
