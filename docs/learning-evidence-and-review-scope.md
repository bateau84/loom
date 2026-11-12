---
type: Architecture
title: "Review-scoped evidence and whole-work retrospectives"
description: "Draft refinement of Loom's evidence, work references and learning: exact dispatch attribution, explicit review subjects and automatic checkpointed multi-Session evaluation."
tags: [loom, learning, evidence, review, retrospective]
timestamp: 2026-11-12T00:00:00Z
---

# Review-scoped evidence and whole-work retrospectives

**Status: draft concept; not implemented or a new runtime guarantee.** This proposal records the user's intended outcome and a suggested architectural direction. It changes no runtime code, configuration, capture policy, permissions or model dispatch. It extends the accepted learning work in [issue #227](https://github.com/bateau84/loom/issues/227); it does not close that issue or reactivate the deferred reporter/controller.

## Purpose and governing outcome

Loom should continuously preserve the observable history of engineering work, associate it with the exact Session, dispatch and worked-against scope, and automatically evaluate accumulated work over time. A Reviewer or Critic may assess the combined result of **one, ten or one hundred tasks**, including research, design, implementation and other agents' work. Both the reviewer and the later Evaluator must know precisely what was in that review's scope, which revisions were assessed, what evidence was available, and what the verdict actually covers.

The primary learning output is the **broad evaluation of complete objectives across related Sessions and time**. Idle-time step and Session analysis prepares evidence for that evaluation. It is provisional, not a score to average into a system verdict and not authority to change a skill. Later review, correction or verification can change the current interpretation without rewriting the original facts.

Normal operation must not require the user to export Sessions, create evidence links, assemble reports or invoke `/retro` for each evaluation. One-time capture/access/budget configuration is compatible with automation. An optional command can inspect or request a run through the same mechanism; it is not a second workflow.

**Example:** a change comprises 100 tasks under several plan revisions and Sessions. Review R1 assesses the assembled artifact at revision A and finds a defect spanning tasks 7 and 42. Corrective dispatch D101 changes revision A to B. Review R2 checks that correction. The retrospective sees the full trajectory, each task's actual obligations and each review's actual coverage. It must not count 100 task handbacks, two reviews and one correction as 103 independent successes, nor assume that R2 reviewed every part of B.

## Existing foundation to refine

Baseline inspected: [Loom `b235ed712b471fd25fc9b0ec12eb805f0e5ad4be`](https://github.com/bateau84/loom/commit/b235ed712b471fd25fc9b0ec12eb805f0e5ad4be). The following are current mechanisms, not proposed replacements.

| Existing mechanism | Reuse and present boundary |
| --- | --- |
| [Actor, ledger, plan and subject identities](../src/model.ts) | Records identify Session/agent and optional Action/node. Plan nodes retain purpose, criteria, dependencies and roles. These are not a general per-dispatch review-subject manifest. |
| [Revision-bound work references](../src/collaboration.ts) | `WorkRef` binds Action/node, original Action/Plan revisions and a content hash. Group references include relevant descendants/dependencies. Completion verifies the historical definition and remains an agent report, not acceptance. Preserve these semantics. |
| [Store and evidence pairing](../src/store.ts), [Observer](../src/context.ts) | The original start captures scope; a finish must not borrow the caller's newer focus. Ambiguous/reused native call identities remain unpaired. Input/result digests are not retained tool-result content. |
| [Public plugin integration](../src/plugin.ts) | Native identity checks, capture hooks, instruction observations, objective/trend readers and narrowly scoped native question delegation already exist. That delegation binding is not proof that every ordinary subagent dispatch is recorded. |
| [Objective index](../src/objectives.ts) and [comparisons](../src/objective-trends.ts) | Preserve authored source relationships, corrections, bounded snapshots, chronology and explicit unqualified origin independence. Source existence is not proof of independent work. |
| [Handoffs and independent review](handoffs.md), [review companions](review-companions.md) | Exact result pins and independent-context mode exist. Assessment/QA loaders retain instruction identities. A loaded lens is not review completion, exhaustive coverage or proof of independence. |
| [Trace projection](../src/session-trace.ts) and [audit qualification](native-evaluator-audit-qualification.md) | Bounded source access and opt-in qualification receipts exist. Current trace projection withholds raw inputs/outputs and exposes history/compaction gaps; the observer is not a production retrospective engine. |

[Current learning behavior](learning-experiments.md) deliberately has no automatic outcome-analysis callback or live experiment controller. This draft must not be read as documentation that those capabilities already ship. The [host trust contract](learning-host-trust-contract.md) still governs independent-request and direct-human authorization claims.

## Scope and exclusions

The concept covers continuous capture, exact execution attribution, historical work scopes, many-to-many review relationships, durable incremental analysis and automatic multi-Session retrospectives. Preserve successful techniques, necessary exploration, recovery and contrary evidence as well as avoidable rework. Project-code defects can be evidence, but retrospective recommendations target the engineering system and route ordinary product fixes through normal engineering work.

**Agent-directive evaluation is explicitly out of scope.** Retain instruction and criterion identities so a later authorized design can use this mechanism, but do not add directive scoring, directive-specific workflows, agent-definition changes or directive experiments here. Do not specialize the attribution model to Coder or to skill edits alone.

Also excluded: live instruction mutation, automatic canonical promotion, a new billing router, a mandatory workflow stage for every task, a replacement orchestrator, and guaranteed causal effectiveness. This draft does not prescribe SQL tables, tool schemas, default intervals or a new daemon.

## Proposed relationships and invariants

Names in this section describe concepts, not existing APIs or a settled schema.

### Keep execution ownership separate from analytical relationships

Every captured fact retains its actual producer: project/host namespace, native Session, agent, message/call identities where exposed, observer instance/epoch and original source. Add a dispatch/attempt binding when the host can establish it. Top-level work without a dispatch is different from work whose dispatch is unknown.

A dispatch is one invocation, not an agent name or child Session. A child Session reused for two dispatches must preserve both invocations. Nested/concurrent children, retries and late returns cannot inherit whichever parent scope happens to be selected when a callback arrives. A locally generated record ID identifies a recorded observation; it does not resolve an ambiguous native invocation.

Capture the parent invocation, child execution, request/return and original work reference at their actual boundaries. Record whether the relationship is host-observed, an authored interpretation, or unavailable. Do not recover missing dispatch identity from titles, similar input hashes, nearest timestamps, completion order or role names. Preserve uncertain facts at their known Session granularity rather than attaching them to a convenient attempt.

A review finding is produced by the **reviewer's** execution even when it concerns a Coder result. Its subject relationship points to earlier work; it does not transfer ownership of the original event. The same distinction applies to Critic and Evaluator output.

### Preserve the scope each task actually worked against

Reuse historical `WorkRef` and saved plan/action definitions. Retain the assigned request, expected outcome, acceptance criteria, constraints, dependencies and relevant context at dispatch, including non-code deliverables. A reference must resolve the historical content, not just its hash. Record actual provided inputs separately from requested or inferred context.

Scope can change during work. Append an explicit change and bind later attempts/results to the appropriate revision. Never substitute today's task or plan for the version that governed an earlier run. Preserve work with no Loom task as explicitly unscoped; do not invent a plan retrospectively to make capture appear complete.

Artifact identity is separate from task-contract identity. For a code review, preserve the actual base/head or worktree snapshot, including uncommitted changes where applicable. For another deliverable, use its exact document/data/configuration version. A PR number or mutable path alone does not identify the assessed bytes.

### Give every review an explicit, immutable subject set

A **review subject set** identifies the work and resulting artifacts that one review was asked to assess. It can contain 1, 10 or 100 task scopes, multiple attempts and several Sessions, and may span Actions under existing permissions. A task can participate in several reviews. Neither a parent/child edge nor a plan dependency automatically means that a task was reviewed.

The conceptual record separates:

| Part | What it must make retrievable |
| --- | --- |
| Review execution | Reviewer/Critic Session, dispatch/attempt, native source and record author; separate from the implementation executions. |
| Requested subjects | Materialized members with exact work-reference revisions, relevant producing attempts and artifact snapshots. A convenience query or group selection is frozen at review admission, not reevaluated against a changing plan. |
| Review contract | Question, intended coverage, inclusion/exclusion boundaries, applicable requirements and acceptance criteria, assigned review mode and instruction/lens fingerprints. Preserve the task scopes underneath a combined review. |
| Basis actually available | The exact provided source packet, artifact versions, test runs/results, relevant evidence links and coverage gaps as of the review. Supplied, successfully retrieved, explicitly cited and claimed-inspected are different evidence stages. None proves model comprehension. |
| Findings and verdict | Findings map to the affected subjects/evidence and distinguish observation from interpretation. Verdicts state their scope, coverage and qualifications; passing one check cannot approve unrelated tasks. |
| Follow-up | Corrections address specific findings; a re-review identifies the earlier review/findings and the new subject snapshot. It is a new assessment, not an overwrite of R1. |

One review may assess an integrated result, an earlier assessment, or both. A Critic's subjects must say which. Do not impose a fixed Coder-to-Reviewer-to-Critic chain.

For the 100-task example, a claim that the entire change passed must be supported by the declared whole-change review method and actual coverage. This does not require reading every byte or treating every task independently. Conversely, 37 inspected task outputs plus an integration test do not automatically certify all remaining obligations. Exclusions, inaccessible inputs and unresolved cross-task interactions remain visible.

Manifest size must not become a context-size limit: paginate the exact subject set without dropping members, preserve its frozen identity, and retrieve underlying scopes on demand. Do not silently reduce a 100-task review to the last few handbacks.

Independent first review receives the accepted scopes and source artifacts without producer opinions or earlier verdicts being injected as authority. Preserve later reconciliation with prior findings. [Independent-context mode](handoffs.md) helps but does not certify independence. Broader retrospectives can inspect all appropriately authorized prior reports, including disagreements.

## Continuous evidence and meaningful content

Automatic capture should cover the authorized main Session and all associated subagent work: dispatches, starts/returns/errors, tool names and arguments/results, plan/task revisions, scope changes, delivered skill/companion content identities, produced artifacts, handbacks, tests, reviews and user-visible corrections. Capture continues regardless of whether a retrospective is currently running or a particular task is selected.

This requires more than recording counters and hashes. A future Evaluator must be able to retrieve the actual permitted return or artifact that a reviewer relied on. Preserve one authoritative source or an exact protected snapshot with an immutable reference; do not require raw payloads to be duplicated in each ledger row. References that disappear after native history compaction do not meet that requirement. Opaque tool wrappers must remain explicitly opaque until a qualified hook exposes their inner events.

Separate the compact event index from locally protected content. Distinguish complete retained content, retrievable source content, redacted/excerpted content, unavailable content and capture failure. A digest verifies identity only when the original bytes remain available; it cannot replace the content or certify delivery/application. Do not silently truncate a return and describe it as complete.

Preserve event occurrence, observation and ingestion order separately. Timestamp proximity is not causality. Append source/relationship corrections rather than rewriting observed history. The permission to read one Action is not permission to read every Session named in a review manifest. Keep existing evidence-ID validation; add separately validated relationships rather than laundering cross-Action evidence into an actor's own observations.

Capture must respect project scope, existing opt-out, native permissions and explicit retention policy. Never collect credentials indiscriminately, export private transcripts by default, or claim inaccessible internal reasoning was observed. Redaction is a coverage qualification, not proof that all sensitive content was removed. Retention/deletion and missing historical imports must invalidate affected coverage honestly, with tombstones where appropriate, rather than manufacturing empty successful histories.

## Automatic incremental processing and batch evaluation

### Idle work is preparation, not the final verdict

Loom owns eligibility, durable scheduling and evidence retrieval; Evaluator owns interpretation using the audit methodology. General remains the native coordination entry where required. The precise dispatch adapter needs installed-host qualification, not a new assumption about arbitrary child creation.

When work becomes idle or reaches another safe checkpoint, process newly observed evidence into source-linked step/attempt analyses and a provisional Session report. Group meaningful steps; do not mandate one model call or Markdown file per tool event. Preserve facts, judgments, unresolved work, positive practices and negative evidence separately.

Idle is not completion. A late child result, pending review, failure, interruption or resumed request can add evidence afterward. A durable backlog must catch up on failed/interrupted Sessions and after restart, rather than relying solely on successful idle callbacks. No retrospective command or manual export is required for normal operation; authorized automatic native-history access/snapshotting is part of the implementation gap, not work silently handed back to the user.

### A batch has a fixed evidence boundary

An automatic overall evaluation selects **all eligible unprocessed or stale work within its authorized batch scope**, including previously analyzed Sessions affected by later reviews. Freeze the source membership and per-source high-water marks before processing. Large backlogs may be processed in bounded chunks, but their remainder must remain scheduled; an arbitrary page is not a complete retrospective window.

For each Session/dispatch snapshot, record the covered event ranges and gaps, original source references, relevant scope/review-manifest versions, evaluation method and instruction fingerprints, report revision and dependencies. Checkpoint completed analyses durably. Then reconstruct complete objectives across Sessions and synthesize the broader report using both original evidence and provisional reports. Previous batches remain comparison context where relevant; a previously processed objective is not a new independent sample.

The overall report asks what repeatedly helps or harms delivery, which earlier recommendations held up, what contrary evidence exists, and what should be preserved, investigated or changed. It must not average local task scores or take summaries as substitutes for review evidence. Conclusions can disagree with intermediate analyses while retaining those analyses and their source basis.

### Evaluated is revision-specific, not a permanent Boolean

A Session can be fully processed **through a specific captured boundary**, processed with disclosed missing evidence, stale because a later review changes its interpretation, pending or blocked. These are separate from whether its objective succeeded. Capture completeness and analytical completeness must not be collapsed.

Commit the report and its successful checkpoint together. A crash before durable completion must not skip the evidence; a repeated callback/retry must not publish duplicate logical reports. Checkpointing a large batch must not mark unvisited Sessions as evaluated. The batch-level synthesis has its own completion state: finished Session summaries alone do not constitute a finished retrospective.

New evidence after the cutoff enters the next batch automatically. A later R2 finding invalidates or appends to the affected subject/Session/objective interpretations and marks dependent overall reports for reconsideration; unrelated work need not be reread. Keep previous reports as historical snapshots. A methodology change similarly permits an explicit new evaluation revision rather than rewriting old scores.

Use durable claims/leases or an equivalent serialization boundary to avoid two workers publishing the same logical evaluation. Record native admission and uncertain dispatch results; do not promise exactly-once model execution across host crashes. Bound recovery attempts, concurrency and spending, and make pending/blocked reasons inspectable. A batch should finish and stop; new evidence or a later eligible boundary starts the next batch.

Capture Evaluator/retro activity too, but classify system-analysis work so it cannot recursively schedule another audit of itself forever or inflate engineering outcome populations. Evaluating the evaluator's past recommendations is deliberate later work with an explicit subject, not an automatic feedback loop.

## Evidence limits must not block all useful automation

Session/dispatch identity and task scope answer **where a fact belongs**. Trusted originating-request lineage answers **whether observations are independent**. Direct-human consent answers **whether an experimental change is authorized**. They are not interchangeable requirements.

Source-linked descriptive analysis and cross-Session synthesis can run automatically under a preconfigured read scope and authorized model budget while marking uncertain objective relationships and independence. The overall report must suppress independent-pattern and causal claims that its sources cannot support. It may report observed similarities, linked corrections, disagreements and questions for investigation without certifying a trend.

Read-only retrospective authorization is not permission to apply a candidate instruction. Keep the existing host-provenance and experiment blocks. A summary, user-role message, hash, model judgment or newly generated dispatch ID must not manufacture stronger authority. Proposed skill changes remain candidates for separate review and user authorization. No automatic edits to skills, agent directives or project code follow from a report.

## Architectural direction and consequences

Two realizations are worth comparing before detailed specification:

| Direction | Benefit | Cost and limitation |
| --- | --- | --- |
| Reconstruct primarily from native history at each evaluation | Least duplicated content; can reuse current trace/read paths and permissions. | Compaction, missing exports or mutable/deleted artifacts can remove the original review basis; repeated reconstruction is expensive. This alone cannot promise retained full-work evidence. |
| Capture-time evidence index plus protected immutable content/source snapshots | Preserves the actual execution and review boundary; supports incremental processing and late-review invalidation. | Requires attribution qualification, retention/access controls, storage limits and recovery of referenced content as well as SQLite state. |

**Proposed direction:** extend the existing Store/Observer, `WorkRef`, objective links and learning readers with the second approach, while continuing to use native history when it is available and authorized. Reuse authoritative identities and historical contracts rather than building a parallel telemetry truth source. Exact schema, storage packaging and tool changes remain design work; a new graph database, transcript store per consumer or general workflow engine is not presumed necessary.

The benefit is less user coordination and a broader basis for skill improvement. The costs fall on the operator in storage/model usage and on maintainers in lifecycle/permission correctness. Processed does not mean correct; provided does not mean inspected; reviewed does not mean every subject passed. Users must be able to inspect sources, challenge relationships and pause collection/evaluation. Automated capture broadens access to sensitive work, so scoped local retention and visible gaps are essential. Compatibility with possible future agent-directive evaluation means neutral subject references and criterion identities, **not implementing that extra capability now**.

Review and capture data are untrusted input. Enforce permission, payload and prompt-injection boundaries in the receiving analysis. Optional learning failures must not remove healthy engineering tools or routing guards. Background analysis must yield to new user work, respect provider/quota policy and never silently choose a paid fallback. Durable blocked work is preferable to an invented report or an unbounded retry loop.

The [paired recovery procedure](manual-backup-restore.md) must be extended if new durable records or external content snapshots are introduced. Backup membership must cover the content actually needed for source reconstruction, not only hashes. A restore proof must exercise the public review and evaluation readers on the final schema. Legacy records stay readable with missing dispatch/scope facts marked unknown; no migration invents lineage.

## Acceptance scenarios for future implementation

These are required falsifiable scenarios, **not tests run or features delivered by this documentation PR**.

| ID | Scenario and expected observable result |
| --- | --- |
| E1 | Concurrent/nested subagents, late returns and two invocations reusing one child Session retain distinct dispatch ownership. Colliding/opaque Code Mode keys remain ambiguous, not FIFO-paired. |
| E2 | Change selection and plan scope while a tool is running. Its return remains attached to its original start and historical contract; new work uses the new scope. |
| E3 | Capture plans, task changes, skill loads and actual permitted tool returns across a parent/child family. An Evaluator retrieves their original content or explicit redaction/gap; a digest-only row is not reported as full capture. |
| E4 | Parameterize reviews over 1, 10 and 100 coding/non-coding tasks across multiple Sessions/Actions. Every requested subject and historical criterion remains retrievable across pages, without granting cross-scope read access. |
| E5 | Review revision A while a task changes to B. R1 retains A and its original scope; a later R2 explicitly identifies B and the findings it rechecks. A partial review cannot silently approve the rest. |
| E6 | Record a reviewer's test result and finding about earlier work. Their owner remains the reviewer dispatch; typed subject/evidence links identify the earlier attempts. A Critic reviewing R1 is distinguishable from one reviewing the product directly. |
| E7 | A later review contradicts a previously processed Session. Original records remain; only affected analyses become stale, and the next overall report includes the correction and prior contrary interpretation. |
| E8 | Three locally completed attempts fail, fail, then pass verification across several Sessions. Broad evaluation reports one linked objective with recovery, not three wins; unknown independent-request membership remains unknown. |
| E9 | Process a multi-Session batch in chunks, crash between Session analysis and synthesis, then restart with new arriving events. No source is silently skipped; durable work is reused, logical reports are deduplicated, and the frozen batch ends before a new one starts. |
| E10 | Failed/interrupted work and an idle parent with running children are included appropriately. Idle alone neither certifies completion nor exhausts the backlog; partial/blocked coverage is visible. |
| E11 | In ordinary installed AOS work, Loom automatically prepares analysis, natively dispatches a bounded evaluation, persists step/Session and overall reports, and retrieves them after restart without `/retro`, manual links or manual exports. Capture-off and denied access remain effective. |
| E12 | The overall Evaluator revisits original evidence and challenges misleading local summaries. Mixed failures and post-outcome fingerprints cannot create an unqualified positive-practice recommendation; accepted prior changes are revisited without forcing a new proposal. |
| E13 | Evaluator output, repeated idle callbacks and competing workers cannot cause recursive evaluations, duplicate publication or unbounded model calls. Quota unavailability, storage failure and cancellation preserve ordinary work and a truthful pending state. |
| E14 | Restore the complete retained evidence, review manifests, report dependencies and checkpoints on an isolated host. Public readers recover the same scope/basis and oldest contrary findings; missing retained content is detected. |

Use actual shipped product-owned paths for capture, native delegation, persistence and readback. Scripted providers can qualify mechanics and negative controls; a genuine model audit of authorized original work is still required to assess reasoning quality. Do not treat synthetic human approvals or internal identifiers as proof of provenance, efficacy or billing safety.

## Questions to settle before implementation

- Which exact supported host boundaries provide unambiguous per-invocation dispatch/return identity, especially reused children and nested Code Mode? Record unsupported routes and the smallest needed host change.
- How can authorized parent/child histories and result payloads be retained automatically before compaction without widening permissions or requiring recurring manual exports?
- Which existing work references can express a review subject set directly, and what minimal additive manifest/relationship is needed for multiple Actions, artifact revisions and requested-versus-observed coverage?
- Which lifecycle signals supply safe opportunities after failure, interruption and restart? Choose admission, durable cancellation, concurrency and budget behavior against the actual host, not an assumed idle event guarantee.
- What retention/content bounds and audit batch policy are suitable for the existing configuration, and how will users inspect backlog, gaps, last overall report and reasons for deferral?

These questions refine mechanism, not the accepted goals of automation, exact attribution and overall evaluation. Do not turn them into a new batch of unrelated implementation PRs. Keep one owner for the integrated contract and verify reuse of the current foundation before adding state.

## References

- [Learning evidence and provisional experiments](learning-experiments.md)
- [Evidence pairing and capture recovery](evidence-reliability.md)
- [Progress and contextual questions](collaboration.md)
- [Original Session trace boundaries](retrospective-trace.md)
- [Native Evaluator qualification](native-evaluator-audit-qualification.md)
- [Host trust requirements](learning-host-trust-contract.md)
