---
type: architectural-decision
title: Same-Owner Coordinator Resumption
description: Restore a General coordinator's current binding to its own existing workflow without recreating execution authority or history.
tags: [architecture, decision, loom, recovery, authority, concurrency]
---

**Status:** implementation-facing decision; implementation and runtime availability are not claimed.

## Derived from

- Accepted bounded request `task:24eea0bc-8600-4924-8b17-23f1b1f55eac`: restore the **same** General's access to original workflow `e71579e4-2666-4b92-9243-2436a26295e9` after side repair `9fc34e84-c2b5-4713-ad2b-3a5ab1a9118d`, without replacement, ownership transfer or history loss.
- [Runtime scope](../specs/runtime-scope.md): one current project-local session binding, selectors are not authorization, controlled rebinding clears old attachments, scoped/version-fenced transactions.
- [Role-safe execution](../role-safe-plan-execution.md), [mutation guard](cross-process-mutation-guard.md), and [verification](../verification.md): independent gates, exact attempts, serialized admission, and evidence remain authoritative.

## Satisfies

The bounded restoration request only. This is coordinator **access restoration**, not general pause/resume, recovery of uncertain operations, a new owner, a new execution attempt, or authorization to execute the original product work. It does not implement the broader lifecycle proposal in [BR-027](../../../requirements/loom/br-027-pause-resume-and-revisit-workflow-work.md).

## Decision question and evidence

How can the original coordinator regain its own workflow binding after completed side work without weakening membership checks?

Current `plugins/loom/runtime.ts:sessionBoundToWorkflow` checks one `session/<id>` value. `plugins/loom/index.ts` start creates a new workflow, records `createdBySession`, replaces that binding, clears step/OQ selectors and initializes new limits/budget. `assertSessionRebindingAllowedLocked` checks the prior binding but does not select an existing target. `plugins/loom/lifecycle.ts:workflowBindingTerminal` describes logical terminal state, not host execution liveness. No supported existing-workflow restoration surface was found. These are repository observations, not inspection of the two live workflows.

## Drivers, options and comparison

| Option | Benefit | Cost, failure mode and authority consequence |
| --- | --- | --- |
| Dedicated same-owner rebind command (selected) | Keeps start/create semantics and ordinary membership checks unchanged; narrow transaction and explicit success meaning. | One small public surface plus source/target activity checks. Must fence stale selectors and all competing admission, not just write one key. |
| Add an existing-workflow mode to start | Can share the same safe rebind transaction and need no separate tool name. | Overloads create/restore inputs and responses; accidental reuse of creation initialization can reset budget or attach a new workflow to the Objective. Viable with strict separation, but less clear and no smaller correctness boundary. |

Both retain one current binding and require the same ownership and quiescence proof. A binding stack, multiple simultaneously authorized workflows, owner-ID fallback in every tool, raw storage editing, and creating a replacement are not alternatives within this request: they expand authority or fail identity/history preservation.

## Decision and interface

Expose `loom_resume({ workflowId, fromWorkflowId })` to General, with equivalent native and Code Mode behavior. `workflowId` selects the existing target; `fromWorkflowId` is an explicit compare-and-swap expectation for the current binding. Neither grants authority. There is no caller-supplied session/project/owner, force flag, grant, release, cancellation, reopen, or budget override. Host caller identity and project epoch supply scope.

Success returns `status=resumed`, source and target IDs, and an explicit statement that only coordinator access changed and no work was dispatched. An already-current, same-owner target returns `status=already_current` without mutation; it does not attest quiescence or execution readiness. A repeated request after a lost response may use this outcome, but cannot switch away from an intervening different current workflow. Denial gives a bounded reason (ownership/project mismatch, stale source, incomplete source, active work, unknown activity, unavailable state/runtime), without disclosing another project's workflow contents. No automatic retry or fallback to start.

### Admission and preservation invariants

1. **Same coordinator, not transfer.** The effective caller is the host-authenticated General coordinator, not a specialist/child relabelled General. Both source and target canonical workflow records belong to the current project epoch and have `createdBySession` equal to that exact caller session. Durable original creator provenance authorizes selecting the target despite the displaced current binding; a supplied UUID, shared Anchor/Objective, transcript claim, parent relationship, or current ownership of the repair is insufficient. Missing/conflicting provenance fails closed; do not manufacture it from legacy fallback. No binding of another session is changed.
2. **Completed source.** For an actual switch, the current binding must exactly equal `fromWorkflowId` and name an existing, successfully completed workflow: nonempty steps all complete/passed, no cancellation, deletion/archive fence, or unresolved lifecycle inconsistency. A failed gate, a mere release marker, an empty/unrouted workflow, or no runnable steps is not completion for this narrow command. The completed repair is eligible **only if it is still the current binding**. If another repair/restoration workflow has since become current, that exact workflow must finish and be named instead; do not silently hop via the historical repair.
3. **Existing target.** Load only from the current project namespace; reject cancelled, deleted, archived, malformed or conflicting target state. Restore its existing status unchanged, including failed gates or blockers that need normal recovery later. No need for a runnable step, no inference from pending status, and no implicit unpause/reopen. Any Objective/Plan association must still resolve consistently to its existing generation and membership; conflicting or missing associations deny, not migrate/reclaim.
4. **Source and target quiescence.** Both must have positively established absence of other executing/admitted/queued work at the transition boundary. Account for attached child turns/tools, admitted launches not yet attached, unresolved external operations, and scheduled OQ continuations or other automatic starts. An unused grant still capable of launching/attaching work blocks the switch; an admitted launch with uncertain outcome stays uncertain even after grant expiry. Consumed/revoked/expired grants remain historical and unchanged. Historical child membership and a pending step alone prove neither activity nor inactivity. The caller's current resume control invocation is excluded, not concurrent operations from that session. Use scoped durable admission records together with authoritative host activity/completion evidence as needed; missing, stale, uncorrelated or unavailable evidence is **unknown**, not idle. Never use dashboard heartbeat, process restart, or model assurances as quiescence proof. The operation does not stop, drain, cancel, revoke, or reconcile work to make itself eligible.
5. **Atomicity and admission fence.** Serialize the session binding and both workflow identities across processes; protect associated work records when validating their relationship. Re-read ownership, current binding, lifecycle and activity facts inside the guarded/version-fenced transaction. The quiescence check must remain valid through commit: competing start/rebind, grant issue/admission/consumption, child continuation/admission, reopen/cancel/delete and relevant mutations either precede the check and are accounted for, or lose/revalidate after it. A host-idle snapshot outside that boundary is insufficient. Use the existing scoped storage/locking model; an in-memory mutex alone is not sufficient. If the host/storage seam cannot establish this fence, deny and report the missing proof rather than weaken it. Readers after a crash see either the complete old binding or the complete new binding, never mixed selectors.
6. **Bounded effects.** Atomically replace only the caller's current workflow binding, rotate its attachment identity and clear its step/OQ/attempt selectors. Record durable bounded transition provenance (caller/project, source/target, time and transition identity); ordinary workflow ordering revisions may advance for that metadata. Preserve exact workflow IDs, creator, accepted authority, Objective identity, Plan generation/revision and content, Task bindings/results, claims/receipts, step attempts/statuses, OQs/reconciliation, evidence/proofs, scopes, budgets/limits/dispatch history, and all independent gate results. Preserve grant records and their expiry/consumption/revocation semantics; no grant is renewed or made eligible by rebinding. Do not initialize defaults or call workflow creation/Plan compilation as recovery. No child attachment or stale attempt becomes current through this operation.
7. **After restoration.** Normal bound-workflow status and owner tools become available; each later dispatch, mutation, gate and recovery action still passes its existing checks. No child is launched, notified, replayed, reassigned or resumed automatically. Exhausted targets remain exhausted; failed reviews remain failed. Broader product execution still requires its own accepted authority.

These are boundary contracts, not an implementation algorithm. Reuse adequate storage, binding, provenance and admission seams; the Worker must demonstrate the host activity evidence and serialization coverage rather than treating the existing terminal predicate as a liveness oracle. If that proof requires broader lifecycle policy, route the gap instead of inventing it.

## Consequences

One additive control-plane command repairs access without changing ordinary authorization. Conservative unknown-activity denial can require separate investigation; it is preferable to asserting safety after restart or from a pending step. No ownership migration or stack schema is needed. Any persistence/admission change still follows runtime-version fencing so an older writer cannot bypass the new transition boundary. Restoring access is reversible only through another separately eligible controlled transition, not a hidden rollback of execution history.

## Confirmation and reconsideration

Before implementation review passes, demonstrate through registered-tool integration and deterministic cross-process/fault tests:

- Original same-owner workflow with existing Plan, evidence, failed/pending steps, budget consumption and historical grants → completed current repair → resume → ordinary bound status access. Compare all protected state before/after; only the listed binding/provenance/ordering metadata may differ.
- Different General, child impersonation, project mismatch, missing creator/state, stale source, active/incomplete/failed source, cancellation/deletion/archive, inconsistent Plan association, and conflicting concurrent bindings deny without mutation.
- Busy **source and target independently**, idle pending children, active pending children, queued continuations, unused usable grants, admitted-but-unattached/uncertain launches and unknown host activity. Pending/completed logical status must not replace activity proof. A returning host call or delayed continuation must not race the successful transition.
- Competing starts/resumes and all relevant admissions/lifecycle changes across independent processes; crash/exception before commit, after commit and before response; safe already-current retry; no mixed attachments or restoration of old grants. Runtime-version skew fails closed.
- After success, original attempts, exhausted quotas, independent review requirements and stale child/grant denials still hold. Native and Code Mode entrypoints share authorization and effects. No roster call or original product execution is necessary to prove this command.

Reconsider if the supported host cannot furnish correlated activity evidence or fenced admission, or ownership/history cannot be proved for the real target. Report that concrete boundary; do not convert it to a force option or silently broaden this command into pause/transfer/restart.

## Operational handoff and open questions

No live resumption is authorized at architecture stage. General must first publish and notify the user of the **exact reviewed implementation commit**, checkout location/branch, and required OpenCode plugin/service restart instructions. Repository edits and tool-list visibility alone do not prove the running executor is that build: confirm the supported runtime provenance/capability after restart before invoking the new command. Use the actual current completed source at that time, not a hard-coded repair ID. Successful restoration must be reported separately from any later original-work dispatch.

No unresolved product choice is introduced. Host-specific quiescence/fencing implementation and its proof are downstream technical work; real source/target eligibility remains unproven until the supported command validates it.
