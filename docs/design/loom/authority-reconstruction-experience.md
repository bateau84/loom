---
type: design
title: Loom Authority Reconstruction — Human Surface and Journey Assessment
description: Candidate surface scope, user journeys, couplings, regression evidence, and unresolved human-facing scope for Loom.
tags: [design, loom, experience, authority-reconstruction, scenarios]
---

# Loom authority reconstruction — human surface and journey assessment

**Status:** Design analysis for accepted `docs/anchors/loom-authority-reconstruction/anchor.md`; not a replacement Anchor or implementation acceptance.

## Human problem and intent

A developer/product owner wants to delegate software work without becoming its project manager, yet needs to understand what Loom is doing, inspect evidence, retain authority over real product choices, and recover when reality diverges from the plan. Too much ceremony makes autonomy unusable; too little transparency makes it opaque and potentially unsafe. This repository-grounded design hypothesis is not user research; actual user frequency, dashboard prominence, and appetite for direct Plan/workflow editing remain unvalidated.

### Experience goals

1. **Conversational, not procedural:** Think aloud and investigate without learning roles or choosing workflow mode.
2. **Legible delegation:** Resume after a gap and understand outcome, state, evidence, dependencies and next decision without reconstructing internals.
3. **Trustworthy recovery:** Failure, uncertainty and interruption are explicit; useful work remains visible; no false success or unsafe duplicate action.
4. **Proportionate control:** Routine expertise choices remain Loom's; people retain meaningful product, risk and scope choices.

### Realization principles

- Report user-relevant outcome/boundaries, not internal dispatch bookkeeping.
- Distinguish product Plan from execution steps; unknown/stale/conflicting data is not healthy zero.
- Consequential transitions have truthful observable state and safe re-entry; an attempt is not success.
- Conversation is the route for refinement/questions; observation does not imply execution authority.
- Prefer recognizable work names and progressive technical detail; preserve exact IDs for diagnosis/routing.
- Do not promise timing/progress the host cannot observe.

## Candidate surfaces and scope recommendation

“Implementation evidence” means source/tests exist or current-system docs describe behavior; it does not prove deployment, usability or desired scope. Value rationale is separately grounded in accepted authority.

| Surface / job | Implementation or current-document evidence | User-value rationale | Recommendation |
|---|---|---|---|
| **Conversation:** explore, spar, research, diagnose, refine, commit | `docs/user/getting-started.md`, `docs/system/flows/product-workflow.md`, `agents/general.md`, `evals/conversation*.md`; `conversation-first-experience.md` is proposed. | Direct Anchor context and AC 1–3, 21–23, 26; BR-019/020. | **Core product surface.** Preserve legible discussion-vs-execution boundary and one coherent thread. Stories/scenarios added. |
| **External dashboard:** locate work, see attention, inspect state/evidence, clean terminal attempts | Concrete source: `plugins/loom/dashboard-web/{client,readability,ui,validation,styles}.ts`, `dashboard/server.ts`, `dashboard/*.test.ts`, `dashboard/*.e2e.spec.*`; `docs/user/dashboard.md`; projection/control docs. Design docs are detailed; refresh proposal remains proposed. | Accepted BR-018 directly values operational visibility and bounded cleanup; Anchor AC 24 supports observability but does not alone enumerate every dashboard capability. | **Include as an operational companion under BR-018**, not alternative primary interaction. Read-first, attention-led; cleanup only within accepted bounded semantics. Validate real UI, not fixture. |
| **Workflow/Plan controls:** inspect Objective→Phase→Wave→Task, questions, evidence, budget/activity; potentially edit/answer/cancel/retry | `docs/architecture/loom/work-hierarchy.md`, `control-plane.md`, `docs/system/components/control-plane.md`; Loom tools expose status/OQ/cancel/budget actions; dashboard design says resolve via Loom and no Plan mutation. | Anchor AC 24 and AC 26 justify understandable inspection; user retains material scope/risk decisions. No accepted source establishes direct Plan editing or dashboard OQ answering as desired interaction. | **Include progressive, human-readable inspection and boundary presentation.** Keep execution mutations conversational/governed for now. Dashboard Plan editing, OQ answering, cancellation or generalized workflow controls remain **user-owned scope unresolved**, not implied by tool availability. |
| **Recovery:** retries/budget continuation, cancellation, restart/upgrade, stale/conflicted dashboard response, diagnosis | Current docs: BR-008/013/017/020, `docs/user/upgrades.md`, lifecycle/control-plane/runtime-isolation and dashboard projection/cleanup docs. Regression suites in `dashboard/` and `plugins/loom`. | Anchor AC 10–14, 21, 24 explicitly require evidence, recoverability, bounded progress and honest stop. | **Core cross-surface experience**, not separate destination. Maintain safe re-entry, preserved evidence, explicit cause/next step and no duplicate action. |

## End-to-end journeys and coupling

1. **Idea → conversation:** user describes goal/problem; Loom discusses and resolves technical/repository questions. Investigation is not permission to mutate (BR-019/020).
2. **Commit → accepted outcome:** user commits, material product ambiguity resolves, Loom chooses proportional process. Refinement returns through conversation, affects only relevant authority/work, then resumes (Anchor AC 1–3/26; BR-020).
3. **Outcome → Plan → execution:** Objective/Phase/Wave/Task meaning must persist across Planner, Worker and gates. BR-021 makes plan context a human-relevant dependency: missing context can lose rationale, ownership or acceptance meaning. Planning-only completion (BR-022) is not delivered-product completion.
4. **Execution → evidence/state:** implementation, review, verification, acceptance and knowledge are distinct. Model claims, fake fixtures or local green checks do not equal real product acceptance (Anchor AC 8–11, BR-007).
5. **Failure → recovery/stop:** evidence-led bounded recovery may proceed; exhaustion/no progress stops honestly with useful artifacts preserved and specific boundary. BR-008's explicit single continuation is not permission for repeated retries. Cancellation is not deletion; dashboard cleanup is terminal-only and preserves project files/evidence.
6. **Cross-session resume:** project, host session, workflow, plan, task and specialist contexts differ. Upgrade/legacy ambiguity must fail closed instead of guessing ownership (BR-017; `docs/user/upgrades.md`). Dashboard projection is observation, not canonical execution authority.

Coupling: accepted intent constrains design/requirements; these constrain Architecture/Plan; shared Plan informs Worker/review/QA/OQ handoffs; evidence informs independent gates; lifecycle affects what can be cleaned/reopened; dashboard and conversation must agree without stale projection mutating canonical state. Users need not manage this graph, but the interface must not flatten its important distinctions.

## Bug and regression evidence, correctly bounded

1. The accepted reconstruction Anchor records history leads for budget continuation, multi-consumer question reconciliation, specialist change publication, dashboard cleanup, while noting exact incidents/patches were unavailable in that history pass. These are **unverified leads**, not established incidents or requirements; do not promote without evidence.
2. `dashboard/review-regressions.test.ts`, `dashboard/review-regressions.e2e.spec.mjs`, and proposal `dashboard-refresh.md` list regressions: repeated wave IDs across phases, complete scope matching, same-destination link focus after rename, heartbeat refresh, long request text wrapping, leaving attention mode, producer-to-HTTP history markers and credential redaction. These expose candidate failure experiences: wrong identity, lost keyboard context, misleading freshness, clipped user context, confusing filter transitions, incomplete history and sensitive disclosure. Tests show regression coverage was deliberately encoded, **not** incident rate, deployed behavior or accepted scope.
3. Evals and deterministic tests are proxies for cases—not proof of model judgment, multi-process integration, interrupted-host experience or user comprehension. Preserve this evidence limit.

## Coverage gap and unresolved user-owned scope

Initial inventory found no durable User Story/Design Scenario corpus. New `user-stories/` and `scenarios/` add a minimum cross-surface set traced to Anchor/accepted BR. Context assumptions are design hypotheses, not research findings.

**Unresolved user-owned choice (not a blocker to current recommendation):** Should the dashboard expand from inspection plus bounded terminal cleanup into active Plan/workflow mutation, or remain conversational for these actions? Recommendation: remain read/understand-first and route material changes through the primary conversation until the user explicitly values and scopes more controls. Neither implementation affordance nor convenience resolves that preference.

## Accessibility and validation implications

Dashboard/dynamic conversation states need keyboard access and visible focus; stable focus when snapshots rename/update/disappear; text-backed status; understandable loading/stale/conflict/unknown/error; linear reading order and 320 CSS-pixel reflow; reduced motion; accessible names; exact cleanup target/consequence before destructive confirmation; no hover-only action; preservation of user-entered context. Validate actual running UI and representative journeys. Synthetic screenshots/fixtures cannot substitute for real publisher/browser interaction.

## Related authority

- Accepted Loom product Anchor: `../../anchors/loom/anchor.md` (not edited here).
- Accepted reconstruction Anchor: `../../anchors/loom-authority-reconstruction/anchor.md`.
- Requirements: BR-007, BR-008, BR-013, BR-017–022.
- Existing realization docs: `conversation-first-experience.md`, `dashboard-experience.md`, `dashboard-refresh.md`.
- Durable human goals/journeys: `user-stories/`, `scenarios/`.
