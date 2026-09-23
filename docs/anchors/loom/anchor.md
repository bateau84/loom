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

## Acceptance Criteria

1. Loom can turn an initially vague product idea into a clear Anchor through focused user questions and independent research.
2. After the Anchor is accepted, Loom proceeds autonomously until completion or a genuinely user-owned decision blocks progress.
3. Technical questions are researched or routed to the capable specialist instead of being unnecessarily sent to the user.
4. Loom can determine and produce the full product solution, including code, user experience, data model, authentication, integrations, persistence, failure handling, deployment needs, and operational behavior where applicable.
5. Human-facing behavior is deliberately designed rather than emerging accidentally from implementation.
6. Observable behavior and important guarantees are explicitly defined before dependent implementation invents them.
7. Structural and technical decisions are made deliberately from accepted product behavior, realistic constraints, and current evidence.
8. Independent review checks normal work for correctness, conformance, security, evidence quality, and boundary drift.
9. Holistic adversarial review challenges the assembled proposed solution and the final realized product from a fresh model/context where practical.
10. Claims of successful builds, tests, integrations, runtime behavior, or Product Acceptance require observed evidence; model assertions alone are insufficient.
11. Fake, mocked, skipped, or hand-constructed verification cannot stand in for the real product-owned behavior it claims to prove.
12. Loom can recover from normal adversity by inspecting evidence, researching, testing hypotheses, trying bounded alternatives, and routing to the correct authority.
13. Repeated work must show real progress through new evidence, a changed hypothesis, a changed strategy, or a reduced unresolved set; otherwise Loom stops or reroutes instead of looping.
14. Workflows have bounded resource use, including practical limits on retries, review loops, parallelism, and expensive adversarial reasoning.
15. Loom produces maintainable code with deep, well-defined modules and replaces or removes obsolete implementation when appropriate rather than endlessly adding parallel code paths.
16. Loom maintains concise living documentation describing product intent, important behavior, components, dependencies, data, integrations, major flows, and usage as the system evolves.
17. Documentation is updated when the represented reality changes; documentation work must not become ceremony that blocks useful progress.
18. A fresh session can understand the repository's purpose and important structure from its maintained knowledge base before needing to explore the entire codebase.
19. Loom preserves useful lessons from successful work and failures so later sessions and projects can benefit from them.
20. Learned heuristics remain evidence-backed and advisory until sufficiently validated; memory never silently overrides current accepted product authority.
21. Loom supports deep diagnostics that seek root cause rather than merely mitigating symptoms.
22. Loom supports deep research using multiple relevant sources, explicit uncertainty, and active attempts to prove and disprove important theories.
23. Loom's normal primary conversation supports sparring, deep research, diagnosis, and refinement before or outside autonomous execution without requiring the user to select an agent or workflow mode.
24. The user can inspect what Loom is doing, why it is doing it, what evidence supports it, and why it stopped when work cannot safely continue.
25. Loom runs inside OpenCode.
26. Loom presents one primary user-facing identity and automatically selects proportionate specialists, durable artifacts, and governance after the user commits to execution.

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
- explicit acceptance of material security, privacy, legal, financial, or destructive-operation risk.

Routine technical, design, implementation, planning, research, and verification choices are not user approval gates when they remain inside accepted authority.

## Context

- Loom is a greenfield redesign. Previous AOS work is research material only and carries no automatic authority.
- The design should preserve useful lessons from the previous AOS while avoiding its bureaucracy, correction loops, and dependence on large directive sets.
- The intended user experience is analogous to: "I want a carpet." Loom should determine the remaining expertise-solvable details and return a finished, trustworthy carpet.
- Conversation is the outer interaction loop. The user can spar, research, and debug with Loom naturally, then say the equivalent of "let's build this" and let Loom choose the engineering process.
- YuHaul is the first end-to-end proving product; Leash is the longer-term target for Loom's autonomous product-building capability.
- The system should favor software-enforced workflow, evidence, limits, and state where possible, while using models for judgment, reasoning, creativity, implementation, review, and adversarial challenge.
- Repository knowledge should follow OKF-compatible structure and be accessible to agents through OKF tooling where available.
