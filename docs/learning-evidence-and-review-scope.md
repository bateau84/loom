---
type: Architecture
title: "Review-scoped evidence and whole-work retrospectives"
description: "Draft refinement of Loom's evidence, work references and learning: exact dispatch attribution, explicit review subjects and automatic checkpointed multi-Session evaluation."
tags: [loom, learning, evidence, review, retrospective]
timestamp: 2026-11-12T00:00:00Z
---

# Review-scoped evidence and whole-work retrospectives

**Status: architecture accepted by the user after independent GO at PR #233; not implemented or a new runtime guarantee.** This proposal records the user's intended outcome and a suggested architectural direction. It changes no runtime code, configuration, capture policy, permissions or model dispatch. It extends the accepted learning work in [issue #227](https://github.com/bateau84/loom/issues/227); it does not close that issue or reactivate the deferred reporter/controller.

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

**Review admission owns the requested-subject manifest; a retrospective cannot create it after the fact.** For a Loom-mediated review dispatch, the authorized dispatch owner specifies the requested work and artifact boundaries. A Loom admission component must resolve authorized historical `WorkRef`s, constituent task scopes, selected producing attempts and exact artifact versions, then durably materialize the requested membership **before** native review admission. The admitted request is linked to that frozen manifest and, only when host-supported evidence establishes it, to the exact native Reviewer's dispatch/Session/message invocation. An agent's description of its own review scope is not a host-attested manifest or evidence of a deliberate human request. Reused child Sessions and concurrent reviews require distinct admission identities, not just a shared Session ID.

If an ordinary native review is launched outside this Loom admission path, preserve the actual prompt/source and execution evidence that can be verified; record the requested subject membership as `unverified`, `partial` or `unknown` where it cannot be established. Do not silently promote the current Action selection, the complete Plan, parent/child ancestry, a PR number, or a retrospective's inferred relationship into an authoritative admission manifest. A late-discovered link may be appended as an **authored analytical interpretation**, with its provenance, not retroactively asserted as the original requested scope. Changes to requested membership or the artifact after admission require a new versioned manifest or explicit re-review, never an in-place expansion.

The manifest describes **what the reviewer was asked to assess**, not what was made accessible, successfully retrieved, cited, understood or verified. These are separately evidenced stages. Cross-Action membership requires independent permission checks for each source and does not grant read authority to the reviewing Session merely by naming an ID.

**Prove the effective review basis for the same actual execution.** An admission manifest alone is insufficient. The admitted Reviewer's native invocation/message identity must be associated with the manifest and exact artifact revision, and with host-observed evidence of (a) what source material was supplied to that invocation and (b) what authorized sources it actually retrieved through native tools. Keep `requested`, `supplied`, `retrieved`, `cited` and `claimed-inspected` distinct; an agent's own citation or generated claim does not upgrade supplied material into observed retrieval or comprehension. Record exact source identities, versions, coverage and gaps. A manifest pointer included in a prompt is not proof that its constituent task contracts were delivered or accessed. Where later transforms or the provider transport cannot be observed, label final model exposure `unverified` rather than claiming it from an earlier hook. A review may legitimately inspect a bounded subset; it must disclose that subset and must not assert exhaustive coverage.

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

Automatic capture should cover the authorized main Session and all associated subagent work: dispatches, starts/returns/errors, tool names and arguments/results where separately authorized, plan/task revisions, scope changes, delivered skill/companion content identities, produced artifacts, handbacks, tests, reviews and user-visible corrections. Capture continues regardless of whether a retrospective is currently running or a particular task is selected.

### Preserve existing capture consent; authorize richer content separately

**The existing `ledger.capture: automatic` setting keeps its present bounded metadata/digest behavior. It is not consent to retain raw tool arguments, outputs, transcripts or additional sensitive content.** Neither an upgrade nor enabling automatic retrospective analysis may silently broaden that setting. A separate, explicit collection authorization and discoverable configuration must govern any protected full-content capture, with a clear choice about eligible projects, Session/agent/tool/content classes, permitted purpose and readers, retention duration/deletion, source snapshot access and resource limits. This is a distinct product/operator policy decision to settle before activating richer content collection, not an implementation default hidden in a migration. Existing capture-off and denied-access rules remain controlling.

Absent authorization, the future engine may retain only already-permitted metadata and source references, or read original evidence under existing permissions at evaluation time. It must report `not-authorized`, `redacted`, `unavailable` or `capture-gap` as appropriate, without treating limited coverage as proof of a successful or complete review. Content removal or expiry must invalidate dependent coverage, with a non-sensitive tombstone where permitted. Backup, restore and deletion policies must include any newly authorized protected evidence, not only SQLite indices.

This requires more than recording counters and hashes. A future Evaluator must be able to retrieve the actual permitted return or artifact that a reviewer relied on. Preserve one authoritative source or an exact protected snapshot with an immutable reference; do not require raw payloads to be duplicated in each ledger row. References that disappear after native history compaction do not meet that requirement. Opaque tool wrappers must remain explicitly opaque until a qualified hook exposes their inner events.

Separate the compact event index from locally protected content. Distinguish complete retained content, retrievable source content, redacted/excerpted content, unavailable content and capture failure. A digest verifies identity only when the original bytes remain available; it cannot replace the content or certify delivery/application. Do not silently truncate a return and describe it as complete.

Preserve event occurrence, observation and ingestion order separately. Timestamp proximity is not causality. Append source/relationship corrections rather than rewriting observed history. The permission to read one Action is not permission to read every Session named in a review manifest. Keep existing evidence-ID validation; add separately validated relationships rather than laundering cross-Action evidence into an actor's own observations.

Capture must respect project scope, existing opt-out, native permissions and explicit retention policy. Never collect credentials indiscriminately, export private transcripts by default, or claim inaccessible internal reasoning was observed. Redaction is a coverage qualification, not proof that all sensitive content was removed. Retention/deletion and missing historical imports must invalidate affected coverage honestly, with tombstones where appropriate, rather than manufacturing empty successful histories.

**Derived reports cannot bypass source permissions.** A Session-level, whole-objective or longitudinal report created from protected evidence inherits the relevant source-access, sharing and retention constraints for its derived statements, citations, previews and metadata. Project-scoped `findings` or other public reader convenience does not grant another Session access to protected details merely because the Evaluator could read them. A report may instead be exposed to a wider readership only through an explicit, authorized redaction/declassification decision with a verifiable disclosure boundary. Before publishing, label the permitted audience and disclosure status, prevent protected source excerpts and identifying metadata from leaking through summaries/counts, and apply the same checks to pagination, fresh-host reads, backup/restore and subsequent access revocation. When authorized readership cannot be established, retain the report privately or withhold it from broader readers and expose only a safe pending/coverage status. Missing access is not an empty or positive finding.

## Automatic incremental processing and batch evaluation

### Idle work is preparation, not the final verdict

Loom owns eligibility, durable scheduling and evidence retrieval; Evaluator owns interpretation using the audit methodology. General remains the native coordination entry where required. The precise dispatch adapter needs installed-host qualification, not a new assumption about arbitrary child creation.

When work becomes idle or reaches another safe checkpoint, process newly observed evidence into source-linked step/attempt analyses and a provisional Session report. Group meaningful steps; do not mandate one model call or Markdown file per tool event. Preserve facts, judgments, unresolved work, positive practices and negative evidence separately.

Idle is not completion. A late child result, pending review, failure, interruption or resumed request can add evidence afterward. A durable backlog must catch up on failed/interrupted Sessions and after restart, rather than relying solely on successful idle callbacks. No retrospective command or manual export is required for normal operation; authorized automatic native-history access/snapshotting is part of the implementation gap, not work silently handed back to the user.

### A batch has a fixed evidence boundary

An automatic overall evaluation selects **all eligible unprocessed or stale work within its authorized batch scope**, including previously analyzed Sessions affected by later reviews. Freeze the complete source membership, deduplicated objective/Session identities, relevant membership qualifications and per-source high-water marks before processing. Large backlogs may be processed in bounded chunks, but their remainder must remain scheduled; an arbitrary page is not a complete retrospective window.

The existing interactive `ObjectiveTrends` reader limits selected sets to **50 objective IDs** and all-linked populations to **500 objective anchors**. These are read-safety limits, **not** accepted population caps for an automatic retrospective. A synthesis over a larger frozen population must either use a qualified bounded aggregation that covers *every* eligible member with stable denominators and deduplication across chunks, or visibly remain `incomplete/blocked`; it must never publish the processed prefix as a complete overall evaluation. Repeated membership through multiple Sessions or chunks does not multiply objective counts, and distinct authored objectives do not establish independent originating requests. Preserve explicit exclusions and unknown independence in every published denominator.

For each Session/dispatch snapshot, record the covered event ranges and gaps, original source references, relevant scope/review-manifest versions, evaluation method and instruction fingerprints, report revision and dependencies. Checkpoint completed analyses durably. Then reconstruct complete objectives across Sessions and synthesize the broader report using both original evidence and provisional reports. Previous batches remain comparison context where relevant; a previously processed objective is not a new independent sample.

The overall report asks what repeatedly helps or harms delivery, which earlier recommendations held up, what contrary evidence exists, and what should be preserved, investigated or changed. It must not average local task scores or take summaries as substitutes for review evidence. Conclusions can disagree with intermediate analyses while retaining those analyses and their source basis.

### Evaluated is revision-specific, not a permanent Boolean

A Session can be fully processed **through a specific captured boundary**, processed with disclosed missing evidence, stale because a later review changes its interpretation, pending or blocked. These are separate from whether its objective succeeded. Capture completeness and analytical completeness must not be collapsed.

**Publication invariant:** a source range or batch is `evaluated/complete` only when its report, immutable dependency/membership identities, checkpoint and every required retained-content reference are durably published and verified retrievable as one logically consistent visible generation. Loom currently has separate Action and learning SQLite databases; optional protected content may add a third storage boundary. Do not assume a single SQLite transaction makes separate databases and external content atomically available. A candidate implementation must stage/validate referenced bytes and metadata, publish completion only after all dependencies are durable, and reconcile orphaned staged content or unfinished publication after restart. A reader must not observe `complete` alongside a missing report or required source. A crash before the publish boundary leaves the work pending or explicitly incomplete, never silently covered.

Commit the report and its successful checkpoint together **at the logical publication boundary**. A crash before durable completion must not skip the evidence; a repeated callback/retry must not publish duplicate logical reports. Checkpointing a large batch must not mark unvisited Sessions as evaluated. The batch-level synthesis has its own completion state: finished Session summaries alone do not constitute a finished retrospective.

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
| E3 | With the legacy automatic-capture setting, prove no new raw payload retention. Under separately authorized scoped full-content capture, preserve plans, changes, skill loads and permitted tool returns across a parent/child family; enforce retention/access/deletion and retrieve complete original content or explicit redaction/gap. A digest-only row is not reported as full capture. |
| E4 | For Loom-mediated reviews, freeze an authorization-checked requested-subject manifest **before native admission**, then bind it to the confirmed review invocation. Cover 1, 10 and 100 mixed task subjects across multiple Sessions/Actions, with historical criteria and all members retrievable across pages; deny cross-scope reads. For externally initiated reviews, unknown membership stays unknown. |
| E5 | Review revision A while a task changes to B. R1 retains A and its original scope; a later R2 explicitly identifies B and the findings it rechecks. A partial review cannot silently approve the rest. |
| E6 | Record the real admitted Reviewer's test result and finding about earlier work. Its owner remains the reviewer dispatch; typed manifest subjects, actually accessed evidence and findings cite earlier attempts separately. An externally initiated/unqualified review cannot be falsely given a verified manifest; a Critic reviewing R1 is distinguishable from one reviewing the product directly. |
| E7 | A later review contradicts a previously processed Session. Original records remain; only affected analyses become stale, and the next overall report includes the correction and prior contrary interpretation. |
| E8 | Three locally completed attempts fail, fail, then pass verification across several Sessions. Broad evaluation reports one linked objective with recovery, not three wins; unknown independent-request membership remains unknown. |
| E9 | Process a frozen population **larger than 500 objective anchors**, across chunks with overlapping Sessions and repeated objective references, then crash between staged content, report, checkpoint and synthesis publication. Recover with stable complete denominators, no duplicate objective count, no missing-content `complete` marker, no skipped members and one logical report; events arriving afterward belong to a later batch. |
| E10 | With a failed/interrupted Session and an idle parent whose child remains active, inspect the durable backlog and observe explicit `pending/blocked` coverage for each incomplete source; an alternate restart/catch-up discovery path finds the missed Session even though no idle hook ran. Idle never certifies completion or discards running descendants. |
| E11 | **Assembled product acceptance:** in an installed AOS host, create **100 historical task scopes** and producing executions across related Sessions and plan revisions; materialize the complete authorized manifest and **natively dispatch R1** against assembled artifact A. **For that same physical native Reviewer invocation**, verify the admitted message/invocation identity and frozen manifest/artifact revision, the exact task-contract/source material actually supplied in effective native input, and separately the authorized source accesses observed through its real tool calls. Preserve gaps for omitted, denied or unavailable material; a prompt containing only a manifest pointer or a scripted finding citing tasks 7 and 42 must **not** satisfy this proof without the corresponding actual input/access receipts. Distinguish `requested`, `supplied`, `retrieved`, `cited` and `claimed-inspected` through public reconstruction; do not pretend to prove model comprehension or final provider-input exposure where unobserved. Capture R1's finding involving two distinct producing attempts; perform corrective work producing artifact B and an explicitly **partial R2** review; automatically process original evidence, both reviews, correction, remaining gaps and outcome across Sessions into one qualified whole-work retrospective. Interrupt/restart between processing stages, reconcile durable checkpoints and retrieve the same qualified overall report through public tools. **Deny an otherwise valid Session access to the derived retrospective when its source permissions do not allow it**, including via historical findings previews or aggregate metadata, unless an authorized redacted/declassified version is published; confirm authorized readback still succeeds. No `/retro`, recurring manual exports or inferred subject membership. Include missing-source/capture-off and false-coverage negative controls. Scripted providers can prove host/persistence mechanics but do not qualify real Evaluator reasoning. |
| E12 | The overall Evaluator revisits original evidence and challenges misleading local summaries. Mixed failures and post-outcome fingerprints cannot create an unqualified positive-practice recommendation; accepted prior changes are revisited without forcing a new proposal. |
| E13 | Evaluator output, repeated idle callbacks and competing workers cannot cause recursive evaluations, duplicate publication or unbounded model calls. Quota unavailability, storage failure and cancellation preserve ordinary work and a truthful pending state. |
| E14 | Restore all **authorized** retained evidence, review manifests, report dependencies, **derived-report reader restrictions/declassification provenance** and checkpoints on an isolated host using the final storage layout. Authorized public readers recover the same scope/basis and oldest contrary findings; a reader denied access to an underlying protected source cannot retrieve the corresponding unrestricted derived report after restoration. Deliberately missing/corrupt protected content blocks `complete` publication, and consent-limited evidence remains marked incomplete. |

Use actual shipped product-owned paths for capture, native delegation, persistence and readback. Scripted providers can qualify mechanics and negative controls; a genuine model audit of authorized original work is still required to assess reasoning quality. Do not treat synthetic human approvals or internal identifiers as proof of provenance, efficacy or billing safety.

## Questions to settle before implementation

- Which exact supported host boundaries provide unambiguous per-invocation dispatch/return identity, especially reused children and nested Code Mode? Record unsupported routes and the smallest needed host change.
- How can authorized parent/child histories and result payloads be retained automatically before compaction without widening permissions or requiring recurring manual exports?
- Which existing work references can express a review subject set directly, and what minimal additive manifest/relationship is needed for multiple Actions, artifact revisions and requested-versus-observed coverage?
- Which lifecycle signals supply safe opportunities after failure, interruption and restart? Choose admission, durable cancellation, concurrency and budget behavior against the actual host, not an assumed idle event guarantee.
- What **separately authorized** protected-content collection, reader access, opt-in scope, retention/deletion and restoration policies are acceptable while keeping `ledger.capture: automatic` backward-compatible? How should protected-source restrictions be enforced on *derived* reports and which operator can authorize declassification to broader readers?
- How will Loom produce a review's requested-subject manifest at **admission time** for native dispatch, and preserve unknown scope for reviews launched outside that path?
- Which batching/aggregation contract can process an entire frozen population **beyond** current interactive `ObjectiveTrends` limits without false denominators?
- What automatic analysis budget policy is suitable, and how will users inspect backlog, gaps, last overall report and reasons for deferral?

These questions refine mechanism, not the accepted goals of automation, exact attribution and overall evaluation. Do not turn them into a new batch of unrelated implementation PRs. Keep one owner for the integrated contract and verify reuse of the current foundation before adding state.

## Requirements alignment

The accepted concept is elaborated by the proposed [execution attribution requirement](requirements/learning-retrospectives/br-001-preserve-execution-attribution.md),
[whole-work learning requirement](requirements/learning-retrospectives/br-007-prioritize-whole-work-learning.md),
[actual review-admission contract](requirements/learning-retrospectives/oc-002-review-admission-and-evidence-basis.md),
and [derived-report authorization contract](requirements/learning-retrospectives/oc-003-protected-source-and-derived-report-access.md).
The requirements remain a draft pending independent assessment; acceptance of this architecture does not establish runtime support or grant operator authorization.

## References

- [Learning evidence and provisional experiments](learning-experiments.md)
- [Evidence pairing and capture recovery](evidence-reliability.md)
- [Progress and contextual questions](collaboration.md)
- [Original Session trace boundaries](retrospective-trace.md)
- [Native Evaluator qualification](native-evaluator-audit-qualification.md)
- [Host trust requirements](learning-host-trust-contract.md)
