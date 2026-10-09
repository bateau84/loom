---
type: design
title: Continuity Experience — Changing Course Without Losing Progress
description: Human-facing handoff for revision, interruption, switching and installation recovery.
tags: [design, loom, continuity, reliability, recovery]
---

# Continuity experience

**Status:** proposed for independent review. Docs-only design; no prototype, product test, production read, recovery execution or user study performed.

**Authority:** [Anchor](../../anchors/loom-reliability/anchor.md) at `54e0c23543958640d763b5019c5f1d78b0c5b191`. Spending OQ `d0334518-1ed9-4d30-a976-059044f488c6` separately permits eight potentially paid initial-path dispatches, not implementation, retries or a monetary ceiling.

## Experience context and direction

Changing one's mind must not turn the person into Loom's state-repair operator. Retain the conversation-first engineering partner: calm, precise, accountable. Show consequences and progress, not an org chart/control sequence. Progress means the authorized goal moves forward, not finding an exit button.

The three [Stories and four Scenarios](index.md) cover distinct human jobs: revise/finish; abandon or switch/return; recover an unusable installation. Audience expectations are scenario assumptions, not research findings.

| Direction | Benefit | Journey failure/trade-off | Decision |
| --- | --- | --- | --- |
| Cancel and reconstruct | Simple-looking exit | Makes feasible continuation depend on abandonment and reauthoring proof | Reject as default; retain deliberate user exit |
| New recovery wizard/dashboard | Centralized explanations | Parallel process makes people coordinate normal revision | Reject primary journey; no dashboard redesign |
| Continuity in place with short impact/re-entry summary | Retains goal and meaningful changes | Depends on real applicability/operation evidence; cannot hide contradictory bookkeeping | Select, paired with separate simplification proof |

This analytic comparison is not observed usability or acceptance of architecture candidate A. No unresolved interaction choice currently warrants a prototype. Architect can choose mechanisms within the Anchor.

Discovery inputs read remotely on 2026-10-09: [foundational discovery](https://raw.githubusercontent.com/bateau84/loom/discovery/foundational-continuity-20261009/docs/architecture/loom/discovery/change-without-losing-progress.md) and [journey catalogue](https://raw.githubusercontent.com/bateau84/loom/discovery/foundational-continuity-20261009/docs/architecture/loom/discovery/continuity-journeys.md), draft PR #168, source baseline `7f0ddd14`. Their cancelled-adapter references, production canary language and catalogue-wide prerequisites are superseded by the accepted Anchor. They are not accepted architecture or runtime proof.

## Information hierarchy and vocabulary

At material revision, return or blocker, show:

1. **Current goal/context:** recognisable name/project; disambiguate identical names through stable references before mutation.
2. **Progress retained:** useful completed outcomes and consequential changes, not the whole history by default.
3. **Attention needed:** affected obligations/reviews, actual failure, permission/resource need, running/unknown operation.
4. **What happens next:** productive authorized action, genuine wait with owner/resume condition, or explicitly chosen exit.
5. **Inspect basis:** stable references to accepted decision, result/input identity, original attempt/evidence and exact review finding.

Distinguish **completed then** (original execution), **usable now / needs revalidation** (current consumer applicability with reason), and **review passed/failed/pending for this scope** (independent judgment and reviewed subject/version). Retention is not approval. **Running / outcome unknown** is independent of workflow status; Stop requested is not stopped. **Planning complete; implementation not authorized** is never product completion.

Avoid “nothing lost,” “all rolled back,” “resumed successfully” or “safe to retry” without evidence for that precise claim. IDs support inspection, not memorisation. Material answers/evidence are directly inspectable independently of notification/current transcript. Consumers record substantive use, rejection or justified deferral; delivery is not a decision.

## Flows and interactions

Requests below are meanings, not magic phrases or new tools. Summaries are presentation, not another stored authority. Users must not need to operate internal reconcile/attach/dispatch tools.

| Trigger | Response/resulting state | Failure, departure and re-entry |
| --- | --- | --- |
| Split C; keep A/B | Acknowledge; show retained/affected work and why. Resolve professionally owned changes/review, continue authorized work | Changed scope/risk needing user authority holds only affected work. Declining retains prior accepted direction; proposal remains unaccepted. Restart returns actual revision status, not guessed acceptance |
| Restart / where were we? | Restore context and retained/changed/next summary; proceed within existing authority | Unknown remains unknown; inspect evidence before duplicating work. Missing proof names exact verification, retaining history; no database edits |
| Failed review | Keep exact finding; explain affected repair path; obtain independent re-review after repair | Self-verification is not PASS. Interrupted repair retains bytes/evidence, re-enters affected repair/review; unrelated work is not reset |
| Existing answer needed | Authorized reader opens original answer/evidence, records meaningful treatment | Missed notification is not reason to ask again. Materially stale meaning can justify reopening with reason. Access denial names actual authority boundary |
| Leave this idea; do something else | Abandon unaccepted interview; preserve history and handle new request at proper depth | Old unanswered/obsolete question is not prerequisite. Factual aside neither accepts nor abandons intent. Late answer cannot revive it |
| Pause A; start B | Report requested versus confirmed pause, retained progress and existing operations; switch at safe boundary | Pending pause is not complete. On denial retain A context, identify productive remedy or genuine wait. No global pause/file rollback |
| Cancel B; return A | Confirm only recorded explicit cancellation; B remains unfinished. Reorient A, continue within authority | No dummy success/external undo. Failure preserves both contexts and names boundary; late B output stays history |
| Permission/resource unavailable | Name proposed effect, required authority/resource, retained work, owner/resume condition | Do not re-request existing authority. New spending/permission/guarantee changes stay user-owned. Service/resource waits legitimate; exhaustion grants no hidden retries |
| Shared-file authorship unclear | Preserve bytes; name disputed contribution and supported isolation/handoff path | Scope/file names do not prove authorship. Publication denial means pending, not completed. Never unstage/adopt others' changes as recovery |

**Cross-state rules:** Acknowledge requests without claiming completion. Pending transitions retain inspection and safe departure; repeated input cannot imply duplicate effects. Show observable progress, never invented percentages or timed updates while host observations are unavailable. Errors retain input/context/history and name cause, remedy and re-entry. Unavailable actions explain why and enabling condition. Empty history says none recorded; missing proof is not success. Stale/conflicting information is labelled and cannot authorize mutation. Success names exact result/checks, not an unqualified Objective claim.

Before execution commitment, explain any known minimum capacity/capability shortfall and the bounded alternative or genuine authorization wait. A dispatch count is not a price guarantee; unknown costs remain unknown. Do not begin a known-infeasible path and convert its predictable shortage into repeated surprise approvals.

## Installation recovery flow

Human meaning, **not an executable production runbook**; backup mechanisms and manual commands are not established here.

1. **Pre-upgrade:** identify installation/version, paused admissions, verified recovery point and coverage of acknowledged durable state. Explain handling/uncertainty of running work. Without verified protection/safe writer handling, do not report ready; keep original intact and name remedy.
2. **Failure orientation:** distinguish failed transaction, overall upgrade status, code compatibility and external outcomes. Provide instructions reachable without starting the plugin.
3. **Choose safe path:** professionally determined options explain consequences. Preview target, protected point, affected work/newer work at risk. Inspection is non-destructive; no option silently weakens preservation. Unknown impact is not “no loss.”
4. **Confirm consequence:** action-labelled explicit confirmation ties restoration to selected point and named loss, if any; no detached generic yes. Changed target/impact requires renewed confirmation. Cancel retains originals. Loss/material-risk acceptance remains user-owned.
5. **Recover/re-enter:** pending, restored, failed and interrupted are distinct observed outcomes. Establish compatible code/data and safe writer handling before admissions resume. Failed/interrupted recovery preserves originals and precise re-entry path, not blind retry. Original reviews do not become new approvals; changed contracts/missing proof require validation.

Impact/results state **code**, **schema/data**, and **external operations** separately. Backup creation is not restoration proof; post-breakage backup is not protected pre-upgrade point. One transaction rollback is not whole-upgrade restoration. These meanings follow Anchor; Specifier owns guarantees, Architect realization.

## Accessibility and surface constraints

Normal journeys remain usable in conversation/persistent text, not only animated panels/notifications. No new web visual layout/tokens are selected. SynaBun style-guide lookup returned **Project not registered**; do not invent branding. Host mechanics remain implementation-owned.

| Interaction | Standard/convention | Requirement | Later verification |
| --- | --- | --- | --- |
| Summaries/evidence | WCAG 2.2 1.3.1–1.3.2, 1.4.1; terminal text completeness | Goal → retained → attention → next → basis reading order; status/unknown in text, not color/hover alone. Reference labels name result/answer/review | Linear/plain-text inspection retains meaning |
| Actions/references | WCAG 2.2 2.1.1, 2.4.3, 2.4.7, 2.4.11, 4.1.2 | Keyboard or typed access, names match labels, focus visible/unobscured. Inspection/focus/selection cannot execute silently | Keyboard-only SC-001–004 and accessible-name inspection |
| Confirmation/error | WCAG 2.2 3.3.1–3.3.3, 3.3.7; APG Dialog if modal | Persist input/preview; name target/cause/remedy. Never re-enter existing answers to resume. Modal: focus impact heading, then safe cancel, specific confirm; Tab inside, Escape cancels/returns trigger focus. Error focuses summary; user navigation focuses destination heading | Close/reject/error retain data; focus returns predictably; focus alone cannot confirm |
| Background updates | WCAG 2.2 4.1.3, 3.2.1–3.2.2 | Concise announcements without moving focus/replacing read text; no per-internal-event noise or rushed confirmation timers; retained inspectable history | Actual surface screen-reader/focus checks |
| Any web realization | WCAG 2.2 1.4.3–1.4.4, 1.4.10–1.4.11, 2.5.8 | 4.5:1 normal text; 3:1 large text/components/focus; usable 200% text/320 CSS px reflow; 24 CSS px targets or standard spacing exception; no hover/drag-only recovery | Measure contrast/targets, zoom/narrow/keyboard |

No motion is necessary. Added transitions are decorative with instantaneous reduced-motion alternative and identical information. Offline recovery output works without color, accepts copied references and distinguishes failure/unknown/success. Technical interface owner defines exact command syntax/exit codes, not guessed design commands.

## Existing experience challenged; dependencies

- [Conversation-first experience](../loom/conversation-first-experience.md) usefully separates conversation/investigation/execution and honest Stop reporting. Retain meanings, not mandatory notification-driven orchestration. Evidence access cannot depend on delivery.
- [SC-007](../loom/scenarios/sc-007-backburner-resume-and-backtrack-work.md) describes pause/revisit as a design gap, not implemented capability. Selected-work pause versus display pause remains useful.
- [Upgrade guide](../../user/upgrades.md) advertises narrow same-owner access return after **successfully completed** side work. That alone cannot meet pause A → cancel B → return A. Cancellation/replacement remains a user exit, not required recovery for feasible A.
- Dashboard containment/legacy-link compatibility are not mandatory here. A conversation can access retained work contexts; viewing/selection is not lifecycle authority. No dashboard redesign/mutation controls selected.

Dependencies: exact context identity; applicability reasons shared by actual consumers; attributed decisions/attempts/evidence/reviews; observed operation outcomes/unknowns; meaningful consumer treatment; confirmed lifecycle transitions; independent recovery access, protected point, impact preview and verification. These are required information/capabilities, not invented existing tools.

Published docs/tool descriptions establish narrower **advertised** capability, not current runtime reproduction. Supplied source-only Research suggests duplicated contracts/validity and no coordinated backup/restore in bounded inspection; those are not fresh Designer findings or proof every candidate incident fails. Professional owners must establish recovery feasibility; mocks cannot hide mandatory gaps. Candidate A is provisional; no schema/service/transaction/executor/backup design is selected.

## Decisive probes and measures

Use SC-001–004 for the Anchor's four human journeys. Discovery PR #168 is candidate input, not accepted test authority. Select contrasts exposing different mistaken meanings: unchanged/materially changed consumed input; delivered/missed answer; pause/termination; abandoned/accepted intent; transaction/whole upgrade; protected/newer-at-risk work; working/broken plugin; admitted/refused test preflight. Do not require all 26/16 catalogue permutations before planning.

Later traces record starting authority/input/result identity, action/owner, inspectable basis, retained attempts/evidence/reviews, final completion/wait/exit, outstanding outcomes and minimized counterexample for denied valid continuation. Count manual repairs, unnecessary reruns/dispatches, contradictory decisions, Loom-caused blocking and unresolved operations. Separate external waits, necessary user decisions and newly required verification. Cancellation is exit, not success for feasible authorized work.

**Reliability:** actual assembled journey reaches authorized outcome or genuine boundary; summary followed by unjustified downstream denial fails. Historical/current proof stays distinct; prompt/prototype-only success insufficient.

**Simplification:** Architect/Reviewer demonstrate removed duplicate maintained facts/decisions/coordination linked to traces. Fewer visible prompts alone cannot PASS. This hierarchy is presentation, not another authoritative status model.

Later recovery/isolation proof uses synthetic installations and independently observed restrictions; never open production databases as an oracle. No tests/imports/engines/images/providers/credential-state inspection/live operations were performed here.

## Seam, consistency and open questions

Shared Anchor fixes preservation/applicability, independent judgment, truthful unknowns and recovery risk. This handoff owns journeys/consequence presentation; parallel Specifier owns BR/QS/OC predicates. Requirements/design review checks both against Anchor before Architecture depends on them; genuine conflict goes to its owner, not transport/reminder OQs. No unresolved user preference or blocking design question is identified.

**Direct seam check (2026-10-09):** Read all eight current Specifier draft artifacts through OKF. No human-meaning conflict identified: SC-001 maps to BR-001/BR-003 and OC-001–003; SC-002/003 to BR-002 and OC-002/003; SC-004 to QS-001/002 and OC-003. In particular, pause is an admission boundary, not termination; returning access is not permission; independent consumer treatment is not delivery; protected-state recovery is not a fresh gate PASS. Drafts may still change; independent requirements/design review must recheck the reviewed revisions. This is a compatibility observation, not a verdict or ownership of normative predicates.

Architect settles observability/safe switching, offline recovery feasibility, protected-state boundary/restoration mechanisms. Planner carries capabilities/proof through delivery. These are professional choices, not user architecture approvals. Proven infeasibility, weaker guarantees or material risk goes to the user before proceeding.

Self-check: selected actions have truthful states/unknowns, preserved material and re-entry/exit; late output cannot revive superseded work; history cannot fabricate independent approval; planning is not delivery; recovery is not external undo; continuation does not repeat authorization. This analytic check is not independent review, AT testing, runtime validation or acceptance.
