---
type: specification
title: Brainstorm Planned Advisory Tasks
description: Bounded native advisory Task binding and explicit receiving-authority resolution within role-safe Plan execution.
tags: [architecture, loom, planning, brainstorm, authority, handoff]
---

**Status:** proposed implementation-facing decision and contract; independent architecture review required before implementation. No runtime support or acceptance is claimed.

## Derived from

- [Accepted Anchor](../../../anchors/loom/anchor.md), first principles 3–8 and AC8/9/11/12/33/36.
- [Accepted BR-024](../../../requirements/loom/br-024-preserve-authority-ownership-through-handoffs.md), especially native responsibility, supported paths, explicit handoffs and no inferred authority resolution.
- [Role-safe Plan execution](../role-safe-plan-execution.md), dedicated Task bindings, reviewed handoffs, Brainstorm advisory limits, whole-Plan feasibility and exact receipts.
- `agents/brainstorm.md`: alternatives, assumptions and trade-offs; concise findings returned to Loom; no accepted authority, execution, repository mutation or ideation-as-decision.
- Bounded request `task:4e22715d-c930-4a7e-a721-c3f2247ece3c`.

## Satisfies and scope

Realize Brainstorm as a planned **advisory contribution**, followed by the actual receiving authority's resolution. This is one additional native path, not universal all-role Task support. Existing Brainstorm OQs and Reviewer review Tasks remain distinct. Planner native Plan/replan Tasks, Critic holistic Tasks and Acceptance scenario Tasks remain unsupported in this increment. General remains coordinator, not a new Task recipient. No installed-host changes, new user flag, agent frontmatter or mandatory registry entry.

## Decision question and observed seams

How can planned ideation finish as attributed advice without masquerading as an authority artifact or allowing dependent authoritative work to skip its receiver?

Inspected current source on 2026-10-08: `tasks.ts` admits seven producer roles but not Brainstorm; `work.ts:validatePlanRoleFeasibility` checks all Phase/Wave Tasks against these paths; `workflow.ts:applyTaskPlan` creates exact role-bound `task:<id>` work slots and intermediate `task-review:<id>` gates for cross-role consumption. `executableTaskPlanFingerprint` hashes Task contracts and gate edges. `index.ts` exposes registered tools, exact attempt attachment/completion, scoped permissions and serialized workflow/work transactions. `WorkTaskResult` already preserves producer, attempt, semantic closure, executable fingerprint and dependency-result digests; Wave completion follows scoped review and releases claims. The existing plugin-boundary Brainstorm OQ test exercises registered grant, permission evaluation, attachment and answer without Task credit. Brainstorm has no artifact write default and is not a product-scope-elevating agent. These are source observations, not execution proof.

## Options considered

| Option | Mechanism / benefit | Cost, failure modes and authority impact |
| --- | --- | --- |
| A — native advisory descriptor over existing work slot (selected) | Keep `role=brainstorm`, `responsibility=produce`; derive native kind `advisory` from that exact pair. Add one explicit receiver edge and typed resolution on the receiver's existing completion. Reuse ordinary attachment, result storage, handoff gates and Wave receipts. | Adds contract fields and causal resolution validation throughout fingerprints/lifecycle. Omitting any projection or reuse check could launder stale advice. No new workflow state or authority is granted. |
| B — separate advisory step kind and dedicated result/resolution tools | Add an `advice` StepKind with its own publish/resolve operations and result store. Native semantics visibly distinct; typed tools can restrict operations precisely. | Viable with equivalent fences, but duplicates completion, satisfied/runnable, receipts, reopen and storage machinery. Partial publish/resolve creates extra atomicity and restart cases. More compatibility burden without stronger semantics than A's typed payload and descriptor. |
| OQ-only or add Brainstorm to producer constant | Cheapest text change. | Not complete alternatives: OQ-only never executes the planned Task; producer-only permits summary-as-authority and lacks required receiver resolution. Both fail accepted meaning. |

A wins on least complete structural change. Its native kind is a control-plane descriptor, not a Planner-supplied classification. `produce` means producing **advice**, not authority, for this pair. B merits reconsideration only if existing completion cannot atomically store/validate the typed result; current storage/locking seams support that operation without a second engine.

## Exact Plan and compiled contract

1. Extend semantic Task definitions and their create/amend schemas with optional `adviceForTaskId: string`. Extend compiled `TaskSpec` with the identical field. Use existing Task-ID syntax/bounds. The field is required **only** for `role=brainstorm,responsibility=produce`, forbidden on other role/responsibility pairs. Brainstorm `execute`, `review` and user-decision responsibilities are unsupported. No public `nativeKind` input is added.
2. One advisory Task names exactly one receiver Task in the same current Plan generation. Multiple recipients require separate bounded Tasks; this avoids implicit partial resolution. The receiver must be a currently supported non-Brainstorm producer/executor Task, and its role must actually own the question's resolution under its `authorityRefs`, objective and acceptance criteria. Reviewer verifies domain fit: Worker can resolve implementation alternatives within settled authority, not invent product/design/behavior/architecture. General, Planner, Critic, Acceptance, user waits and Reviewer review Tasks cannot be used as receiving Task paths in this increment. If that is the required receiver, the exact path is blocked/replanned; availability never supplies missing capability.
3. Receiver must directly list the advisory Task in `dependsOn`. Advice can be consumed directly only by that receiver or an independent Reviewer review Task. All other work using its meaning depends on the receiver's resolution/output, not directly on the advisory Task. Whole-Plan validation checks every Phase/Wave, unknown references, cycles, ordering and these edge rules. A receiver may be in a later Wave/Phase if ordinary dependency ordering permits it. The receiver link is an association, **not** an execution back-edge: advice does not depend on receiver completion.
4. Brainstorm compiled `write` must be `[]`; no writes, generation commands, repository artifacts, commits, nested dispatch or product-scope elevation are enabled. Existing read-only inspection and narrow OQ operations remain subject to existing role/tool policy. Skills and verification expectations are ordinary bounded contract fields, not extra authority.
5. Native path descriptor: `(brainstorm,produce) -> {nativeKind: advisory, stepKind: work, agent: brainstorm, result: advisory-v1, write: none, requiredReview: scoped-independent}`. Use this descriptor consistently for whole-Plan feasibility, compiled validation, dispatch, attachment, completion and status. Keep ordinary producer descriptors and Reviewer fixed review responsibility unchanged; do not interpret all roles in `LOOM_AGENT_ROLES` as producers.
6. Include `adviceForTaskId` in normalized semantic contracts, immutable revisions/amendments, closure fingerprints, executable Task equality and graph fingerprints. Retain the receiver's direct `dependsOn` edge. New required meaning is never accepted via a legacy fingerprint fallback that omits the association. Unknown required fields/kinds block admission, not strip-to-Worker normalization.

## Completion API and causal result contract

Extend the existing registered `loom_complete` (native and Code Mode schemas together) with optional:

```text
adviceResolutions: Array<{
  taskId: string,
  resultDigest: string,                 // lowercase SHA-256, 64 hex characters
  disposition: "adopted" | "rejected" | "deferred",
  rationale: string,
  resolutionRef: string
}>
```

The array uses existing Task context limits (16 entries); text fields are nonempty and bounded by `MAX_TASK_TEXT_LENGTH`. Duplicate Task IDs, unknown dispositions and unrelated entries are errors. Whole-Plan feasibility rejects a receiver with more advice inputs than the supported resolution limit. Absence remains compatible on Tasks without advisory inputs. It is forbidden on Brainstorm completion, gate verdicts, OQ answers and non-Task steps. This is typed receiving-role resolution, not a generic permission or acceptance API.

- Brainstorm calls exact attached `loom_complete(...,summary,outcome=complete)` with nonempty bounded findings. Findings identify meaningful alternatives, assumptions, trade-offs, uncertainties and unresolved choices within the supplied scope. No mandatory repository artifact or new option schema is needed. Control plane persists the original summary as `nativeKind=advisory`, attributed to Brainstorm's workflow, generation, Task, Plan binding, step attempt and session. Evidence references remain observed evidence, not authority.
- Expose a canonical `resultDigest` for the immutable advisory result via focused Task/attachment context. Compute SHA-256 of a fixed-field canonical representation of original result identity and content: workflow ID, generation, Task ID, step ID, attempt, producer role, native kind, semantic closure fingerprint, executable Task fingerprint, `adviceForTaskId`, summary and sorted evidence claim IDs. Exclude mutable status/timestamps/review state. Persist the digest with the result; reuse cannot recompute it against newer semantics. Reuse existing dependency-result hashing infrastructure with this explicit representation rather than introduce another store.
- Receiver attachment includes exact reviewed advisory summary, digest, source attempt/role and source gate or predecessor Wave receipt. Receiver completion must provide exactly one resolution for each direct Brainstorm predecessor naming this receiver. It must consume the exact current original result digest; an OQ answer, paraphrase, different attempt or summary assertion cannot satisfy it. The receiver's own native output remains required.
- `resolutionRef` locates the receiver's actual decision/deliverable: `artifact:<project-relative-path>` under that role's admitted scope, `evidence:<claim-id>` for an observed evidence claim belonging to this receiver attempt, or `task:<receiver-id>#result` for an in-control-plane decision whose content is in the receiver's completion summary. Reject other reference forms. The control plane validates existence/ownership and current attempt (the self-result reference resolves against the candidate result atomically being committed); Reviewer verifies that the referenced content really resolves the advice and preserves accepted meaning. Artifact references must be backed by current-attempt observed authorship, not just file existence; original unchanged artifacts can be retained only through existing exact receipt reuse. A bare unrelated filename or accepted Anchor link is not a receiver decision.
- `adopted` incorporates advice into the receiver's own decision; `rejected` explicitly disposes of it without adopting it; `deferred` explicitly excludes it from what this result establishes, with rationale and remaining work/authority identified in the receiver output. None grants authority. Deferral does **not** discharge a mandatory unresolved obligation: existing Plan obligation/authorized-deferral rules and independent review still block work that needs that meaning. No new product deferral policy is invented.
- Validate and persist resolution entries, receiver result and step transition in the existing serialized workflow/work mutation boundary, re-reading current bindings, result digests and gate satisfaction before commit. Invalid input causes no partial completion or receipt. A second completion cannot overwrite an original result with different advice/resolution; use existing reopen/new attempt to revise. Preserve current duplicate-completion behavior for identical existing outcomes.

## Dependency, gates and lifecycle

Same Wave: `task:advice -> task-review:advice -> task:receiver -> task-review:receiver -> dependent authoritative/implementation work` where existing cross-role handoff requires those gates. `review-plan` precedes all slots. Independent advice review checks advisory role, exact attribution, alternatives/trade-offs, scope and named recipient, **not** adoption or accepted meaning. Receiver review checks actual resolution and its authority output before cross-role work advances. Explicit Reviewer Tasks retain existing subset behavior and do not remove mandatory handoff gates; neither can substitute for receiver resolution.

Cross Wave/Phase: source Wave scoped review and exact completion receipt replace the source handoff gate as the reviewed predecessor proof. The receiver Wave admits only with that current receipt and original advisory result/digest. Later consumers similarly need the receiver's reviewed Wave receipt. Feasibility checks the entire Plan now; compilation of one Wave must not discard or invent the later receiver link. Reviewed advice may complete its own Task/Wave before the receiver runs: that is **delivered reviewed advice**, not resolved meaning or Objective completion. Do not create a cycle by waiting for later receiver resolution to finish the advice Wave.

Role-only advisory Waves still have real Task results and scoped Wave review. `review-implementation` remains the existing internal gate ID; describe its scope truthfully as role-work review when no Worker is present. No empty Worker-list auto-completion. `syncWorkTaskStatuses`, Wave receipts and ancestor roll-up use exact Task/native result and required gates; planning-only PASS claims no Wave, dispatches no Task and completes no Objective.

Reopen advice invalidates its review, receiver resolution and transitive consumer satisfaction/receipts. Reopen receiver invalidates its resolution and downstream consumers but retains unchanged advice as original evidence. Changed recipient, role, native contract, source content/digest or gate edges invalidate affected semantic/executable closure and approval. Existing denial of reopening a reviewed Wave already consumed by claimed/completed downstream work remains; no bypass or new recovery policy. Amend/recompile/review through existing paths. Cancellation revokes grants/new operations, preserves completed results/history and releases owned incomplete claims; cancelled completion cannot create advice or resolution credit. Restart rehydrates exact persisted results, references and receipts; absent original provenance blocks reuse rather than reconstructing it from prose.

## Admission, permissions and failures

Keep host names/descriptions separate from plugin-owned native path descriptors and advisory insights. Refresh actual host availability at admission/dispatch; absence of Brainstorm, receiver or independent Reviewer reports exact Task/Phase/Wave/path and leaves it unresolved. Permission admission binds the one-use grant to `task:<id>`, role Brainstorm and attempt. Attachment by Worker/General/another role, stale attempt, OQ grant used for Task, stale Plan, mismatched recipient or cancelled workflow fails closed. An unlisted host agent stays visible in roster discovery but receives no invented native path. Config preferences, descriptions and insight hints never allow mutation or dispatch.

Brainstorm must remain without an artifact write surface even if General declares scope or its completion is a normal work slot. Apply role restrictions to declaration/elevation/edit/shell/generation/subagent hooks, not only a prompt. No source fallback to Worker, fixed earlier route result, OQ answer or historical advice. Status and attachment projections show `advisory`, receiver ID, source digest, pending review/resolution and the exact blocker; model-readable clipping includes omitted counts and does not conceal a required unresolved input. Projection data grants nothing.

New readers retain old supported results without changing their meaning. Old Brainstorm OQs stay OQs. No historical Task is retroactively credited as advisory. Require current writer/version-fencing support before emitting new contracts; older runtimes must block unknown required advisory meaning. Unclaimed Brainstorm Tasks without a receiver require a permitted Plan amendment and fresh review, not automatic migration. Missing original evidence/receipts remains missing; unavailable workflow `e71579e4` and historical Plan PASS are not recovered or treated as implementation proof.

## Implementation seams and consequences

- `tasks.ts`/`work.ts`: native descriptor, receiver validation across all Phases/Waves, amendment/context/result types and exact semantic closure. Do not merely expand `PLAN_PRODUCER_ROLES`.
- `workflow.ts`: role-bound work slot, existing handoff gates, fingerprint association, satisfied/runnable/reopen propagation; preserve existing supported paths.
- `index.ts`: all mirrored tool schemas, compilation equality, capability/host checks, exact-role grants/attachment, typed completion transaction, result/context projection and role permission hooks.
- `lifecycle.ts` and receipt/reconciliation helpers: advisory/resolution preservation, digest/closure checks, cancellation/reopen/history and no historical backfill. Planning insights may describe the newly supported path only once actually implemented; roster entries remain advisory.

Price: one association field, one completion payload and typed result metadata must move together. This is additional validation and test surface, not another scheduler, store, workflow kind or user mode. Receiving authorities do real resolution work; intermediate reviews are existing cross-role protection, not an extra universal gate. The structural choice is reversible before admission; admitted history must stay legible and cannot be relabelled during rollback.

## Verification and reconsideration

Required downstream proof (persisted separately through Loom):

1. Actual provider-free registered-tool path: create persistent Plan, compile advice/receiver/consumer, independently review Plan, acquire claim, obtain exact Brainstorm grant, run permission hook, attach actual named mock-host child, complete advice, independently review handoff, attach receiver and store exact typed resolution/output, independently review receiver, complete dependent work and scoped Wave. Assert persisted roles/native results/digests/gates/Task and Wave receipts and incomplete Objective. Do not seed satisfying steps or call only pure compiler helpers.
2. Run advisory-only Wave then later receiver across Waves and Phases, including planning-only feasible/infeasible later-Wave cases. Advice Wave can finish without pretending meaning resolved; missing receiver/path/gate or wrong ordering fails before Plan PASS/claim. Prove receipt-based composition, not copied summaries.
3. Negative actual tool/permission boundaries: unsupported role/responsibility, missing/wrong/cyclic recipient, direct consumer bypass, absent/disabled host agent, unlisted agent, config preference impersonation, wrong-role/replayed/OQ/stale grants, write/elevation/subagent attempts, missing/unreviewed/stale digest or resolution reference, deferred mandatory unresolved meaning, advice-as-authority and OQ-as-Task-credit. Assert no state/claim/receipt mutation or Worker fallback.
4. Reopen source/receiver, semantic amendment, changed digest/recipient/gate, cancellation, interrupted reload, missing original evidence and reuse/reconciliation. Preserve unaffected original receipts; stale resolutions and dependent receipts never carry forward. Keep existing Worker, authority producers, Reviewer subset, user waits and Brainstorm OQ regression coverage. Planner/Critic/Acceptance Tasks remain blocked.

Mock only the external OpenCode host/provider boundary while invoking real plugin registration, permission hooks, storage, tools and workflow/work transitions. Report that this proves plugin control-plane composition, not installed-host execution, paid inference, hostile-plugin isolation or final inner-caller results. Current evaluation uses trusted checkout stock 2.0.23 and sole `runtime_evidence/v1`; no broker/HMAC or runner alteration. Prior aggregate test `ModuleNotFoundError: runner` remains a disclosed setup limit, not an architectural failure or full PASS. No acceptance of the original whole Objective is claimed.

Reconsider if typed result completion cannot be atomic under existing locks, a supported cross-Wave reader cannot retain original causal digests, or a real receiving-authority policy gap appears. The first two require structural repair/proof; new observable policy goes to Specifier/product authority. No current unresolved normative question was found: explicit receiver assessment, advisory-only output and fail-closed dependent meaning are already accepted.
