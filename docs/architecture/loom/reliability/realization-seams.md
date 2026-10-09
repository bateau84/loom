---
type: architecture-spec
title: Continuity Realization Seams
description: Review-ready compiler, applicability, capability, provenance and transition contracts for continuity delivery planning.
tags: [loom, architecture, contracts, applicability, capabilities, provenance]
---

# Continuity realization seams

**Status:** review-ready owning correction, Architect attempt 1; not shipped APIs. Previous producer `d5f976e9`/acceptance `f54b563` remain historical. Specifies interoperable semantic inputs and transaction outcomes, not final table names or command syntax. [Accepted authority and correction scope](index.md) control observable meaning.

## Modules and trust boundaries

1. **Fact repository:** sole domain write boundary; transactional commands, immutable payload references, schema-independent historical envelopes. Reads never admit work.
2. **Compiler and applicability evaluator:** pure functions over identified facts; no host side effects. Compiler derives dependencies/gates from Plan and accepted assurance policies. Obligation owners resolve ambiguous semantic relevance; no model silently infers equivalence.
3. **Admission manager:** authority, resources, role capability, epoch/lease and applicability checks; produces exact typed capabilities. Control-plane tools, native hooks and publication adapters call this same module. Native hooks remain enforcement points, not eliminated permissions.
4. **Effect/mutation broker:** module of the trusted custodian; binds actual invocation and observed changes to admitted targets. Owns protected Change workspace/repository and invokes bounded file/Git/host adapters; records unknowns. Ordinary plugin scope cannot contain arbitrary shell effects.
5. **Standalone installation manager:** offline/live modes of the same custodian, generation activation, external isolation substrate/policy, fencing, protected snapshots and offline restore. Does not import product/plugin or depend on tool registration. Its stable journal owns active generation selection and ingress custody; plugin schema does not override it.
6. **Read projection:** status/dashboard/conversation returns immutable basis plus current action/wait. It cannot independently mark complete, own budgets or mint capabilities.

These are module/privilege boundaries, not six persistent services. One trusted custodian plus managed stock OpenCode child processes uses the [physical principal/handle/IPC contract](proof-and-recovery.md). The latter is not an optional hook convention. Availability of kernel confinement, delegated process control and stock-service participation is a delivery prerequisite to prove, not an assumed current capability.

## Common identities / results

Opaque identifiers are scoped by installation and project; reject wrong identity, rather than suffix/path-name matching. Immutable payload identity is digest plus size/encoding and recorded provenance. Contract identity is immutable Task meaning/assurance revision, not Task name or global Git HEAD. Original attempts retain their exact revision even after splitting a Task.

All mutating commands carry actor/session, `requestId`, exact target, expected current revision, generation/fencing token, and referenced authority. For the same request ID and identical normalized inputs, return the original durable command result without a second effect/charge. Same ID with different inputs is a conflict. Concurrent same-ID calls have one transactional winner; others read that winner or report still pending. Errors distinguish denied authority, changed input/revision, missing proof, missing capability/resource, uncertain effect and internal invariant defect. Defects are not disguised external waits.

Targets are a discriminated union:

- `work-transition(workId, expectedEpoch)`;
- `task-attempt(taskRevisionId, attemptId)`;
- `question-attempt(questionRevisionId, responderAttemptId)`;
- `review-subject(subjectDigest, reviewAttemptId)`;
- `candidate-assessment(subjectIds, assessmentContractId, assessmentAttemptId)`;
- `publication(contributionReceiptIds, repositoryIdentity, parentOid, candidateTreeOid, allowedDelta, transformPolicyDigest)`;
- `installation-transition(installationId, expectedGeneration)`.

An OQ responder can receive a bounded capability for its exact question attempt when its professional authority permits the operation; it does not need a fabricated Step. All targets use the same effect validation; no new role expansion is required. Unknown target discriminators/required versions fail closed. Unsupported readers can inspect immutable historical envelopes but cannot write/emit unsupported required meaning. There is no old/new concurrent-writer compatibility contract: controlled cutover fences old emitters.

## Single Plan compiler

`compile(planRevision, assurancePolicyVersion, availableRolePaths, executionSettingsRefs)` returns deterministic graph nodes containing **references** to semantic Tasks, prerequisite use tuples, gate subjects and actual execution settings. It must not accept a second Task contract. Wire snapshots for child sessions are read-only serialization of those references and original content; rejecting a tampered snapshot compares to canonical identity, not a second maintained definition.

Planner authors meaning once. Settings owner supplies only executable targets/skills/limits; conflicts with Plan constraints reject settings. Independent review records exact Plan scope/compiler/policy identity. New semantic revision requires applicable independent review for changed meaning; unchanged review scope may remain usable only when the subject/assurance tuple is unchanged. Cross-role identity alone is not a substitute for identifying what assurance is required. Preserve accepted independent review obligations; compiler does not abolish gates to save dispatches.

Task split creates new current contracts referring to original outcomes as candidate inputs. Original completed contracts remain history. Changed labels/grouping do not enter fulfillment identity unless actually consequential; retained current context still exposes holistic goal/obligations. Unknown semantic relationship is unproven for the affected use and names its professional resolver.

## One applicability function

`evaluateUse(tuple)` has three outcomes: `applicable`, `inapplicable`, `unproven`, with machine-readable dimension reasons and stable basis references. Tuple contains:

- original result/attempt and original consumed contract;
- intended consumer meaning plus assurance demand;
- explicit relevant authority revisions, artifact digests/versions, dependency result identities and consumer answer-treatment identities;
- available original observations/claims and independent review subjects/verdicts/corrections;
- evaluator version and any attributed relevance/equivalence resolution.

Consumed inputs are captured before invocation and output commit; discovery of another consequential input appends it to that attempt context before claiming fulfillment. File dependencies default to actual consumed file bytes; a narrower region is permitted only with an explicit justified dependency boundary. Whole-HEAD is provenance, not general validity. A shared file with unknown contributors is unproven for ownership-dependent use even if its content matches.

The same immutable **fulfillment-use** tuple yields identical result/reasons at preservation-as-usable, attachment-as-fulfilled-input, dispatch-consuming-fulfilled-prerequisite and completion. Verdict cache is keyed by the entire tuple and evaluator version, read-only and disposable. An attributable bug correction changes evaluator/correction input; no silent changing verdict for an identical tuple. Historical retention and authorized inspection do not call the evaluator to assert usability. `applicable` is a component of **fulfilled-prerequisite** admission, not complete permission: role, resources, current epoch and actual effects remain distinct checks with separate reasons.

### Candidate inspection / assessment is not fulfillment

Operation purpose is required: `inspect`, `assess` (including relevance resolution, answer treatment and independent review), or `consume-as-fulfilled`. Candidate references have no satisfied-prerequisite bit. Authorized `inspect` retrieves attributable original bytes/proof whether applicable, inapplicable or unproven; ordinary read authorization and information scope still apply. `assess` grants the exact subject, professional role, writable judgment/evidence outputs and bounded effects needed for the assessment. Its **real** prerequisites are assessment authority, independent role where required, identified accessible subject and resources/capabilities—not the verdict/treatment it is meant to produce. Its completion records the actual assessment result against that subject; it may record failed/unproven rather than PASS. No assessment grant authorizes consuming the candidate as fulfilled production work.

Finite legal sequence: read unproven result R -> attach/dispatch an independent assessment A of R -> produce observation/treatment/verdict V -> evaluate consumer C's current fulfillment tuple (R,C,inputs,V) -> admit C's fulfilled use -> completion rechecks that tuple. Changing/removing V changes the tuple. Trying to dispatch C before required V exists returns unproven; trying to require V for dispatching its own assessor A is an internal dependency defect. Review subject identity must be fixed before admission; A's producer/repair contributors cannot become its independent reviewer. This clarifies existing normative permission to access/treat candidate information; it does not create a second applicability algorithm or an exception upgrading an identical tuple.

After attachment, completion recomputes the **current** consumer tuple in a transaction and compares the attached context. Changed dimensions trigger narrow reassessment, not overwriting original inputs. Dependency propagation walks explicit relevant edges, not every ancestor/group/commit. Stronger proof can require new review/verification while preserving original execution. Missing proof is unproven, never a synthetic failed/passed observation.

## Effective capabilities and actual hooks

`assessOperation(proposal, currentFacts)` returns either an owned wait/denial or a **preflight certificate** over exact inputs. `admitOperation` revalidates and atomically reserves one operation ID, consumes applicable grant/limit and binds its epoch/lease. Preview is not invocation permission. The executing native hook checks the same certificate/inputs, obtains the same admit result, and supplies broker invocation identity; a changed target produces a changed-input outcome, not a mysterious stricter interpretation.

Proposal contains purpose, effect kind, canonical targets, actor authority, read/write extent, expected base identity, contribution/ownership references, limits and outcome-reconciliation strategy. Assessment output is an assessment target, not fulfilled use of the assessed candidate. Directory scope is a typed subtree rooted at a canonical project identity; exact file is exact. Glob is explicit, not guessed from trailing slash. Symlink/rename traversal is resolved and revalidated by the adapter; path-only checks do not prove access containment. Hard-boundary user authorization remains exact and one-use.

Native role policy, scope membership, professional authority, authorship and effect containment remain separate predicates **inside the shared evaluator**. No broad `committableAuthority: Yes` claim is emitted when only scope membership is known. Return per-operation status, basis revision and the actual missing predicate. Reviewer acceptance bookkeeping is a typed operation constrained to allowed status-only fields on the exact reviewed artifacts; it cannot change content meaning or authorize implementation repair. Reviewer repair uses a different explicit capability; that repairer is ineligible for independent approval of the changed subject.

Known bounded operations use adapters, not lexical shell names as security authority. A shell frontend parses command AST/arguments into the same typed Git/file proposal; unsupported syntax is identified before promising capability. Explicit file operands and `--` in hookless commit are part of Git publication contract. Broad add/filename-free commit are not required escape paths. General commands require an enforced effect envelope and observable descendant behavior; absent enforcement means a real capability wait, not a blanket command-name ban or permission to run uncontained.

## Contribution custody and publication

Choose persistent Change-owned **custodian-private repository and workspace**, not a linked worktree sharing user refs. A contributor gets a serialized bounded mutation operation, with original attempt identity and base; arbitrary product processes receive only read-only sealed workspace materialization plus isolated native-tool scratch. The custodian applies accepted deltas to its protected continuing candidate and owns their integration receipts. Additional contributor scratch is temporary operation isolation, not mandatory whole-repository per-attempt lifecycle. [Alternatives and cost](fact-model-and-continuity.md) compare this with per-attempt repositories. Existing foreign staged/dirty user content stays untouched and is captured as legacy history where required, never imported as this actor's authored output.

A mutation receipt is produced by the **actual successful native mutation observer plus custodian capture**, not scope elevation or a product report. It binds capability, actor/attempt, canonical file identity, base digest/mode, output digest/mode and observed delta. Native tool edits occur only in the assigned scratch; custodian freezes/revokes all scratch writers before independently reading and sealing output, validates permitted delta against the protected base, durably commits payload/receipt, then acknowledges contribution. Tool return alone does not release custody or prove descendant quiescence. A cancelled/expired lease cannot seal new current output; late scratch remains original-attempt history. Crash between mutation and receipt keeps scratch/base/invocation evidence and marks outcome uncertain; reconcile actual retained evidence before recording an observation. Without it, history is unproven, never blanket ownership recovery. Sequential edits form one chain; no second session ownership table claims the same change.

A contributor handoff names original receipts, incoming base, exact accepted delta and receiving owner. Receiver acknowledges custody; integration actor owns integration changes, not relabelled original authorship. Concurrent mixed modifications in the same physical file without receipts/isolation remain unproven. Preserve all bytes; choose isolation or establish real handoff, not adoption based on scope or exact-path commit.

### Exact candidate and actual path-commit atomicity

Publication candidate is `(repositoryIdentity, parent P, tree T, allowed path delta D, contribution chain C, transform policy F)`. P is an exact commit OID, not a moving branch name. D enumerates path additions/modifications/deletions and file modes; T is the complete intended Git tree, including unchanged paths from P. C explains each changed path/base→output contribution and integration; captured unknown legacy authorship is labelled as such, not converted to C. F fixes relevant Git configuration/attributes/object format and any authorized clean/filter transformations. Default controlled repo uses identity transformations, no executable filters/hooks or ambient config. Submodules/links/modes are explicit delta entries; unsupported transformations or escaping links reject before promising publication. Git blob/mode identity is compared after F, separately from raw captured-byte digests.

1. Custodian transactionally reserves publication operation ID and candidate P/T/D/C/F and acquires the Change-exclusive byte/repository gate. Broker is sole writer of this repo/workspace/config/HEAD/index; product clients have **no writable handle or mount** to them. Gate is held through actual commit and durable outcome recording; another admitted mutation waits. Manager crash closes admission until recovery reconciles prior operation; lock acquisition alone is not evidence it never committed.
2. Under that custody, check detached HEAD=P; prepare current named working-tree contents/modes from sealed candidate, compute full T and D using F; require exact equality with reserved candidate. Stage **explicit paths**, then hookless commit with those **explicit paths**, optionally `--`. A path-specific Git commit uses current named worktree contents, not simply staged snapshot. No process can change them or F between validation and commit: the executor is the trusted custodian's bounded Git child, no hooks/filter programs/general writable child. Check deletion semantics and unchanged tree paths. Unrelated user index is never touched.
3. Record actual commit OID K, parent list exactly `[P]`, tree exactly T, and published delta exactly D. Any discrepancy is invariant failure, preserves repo/evidence and forbids integration; not success with a post-hoc excuse. Detached K stays local protected publication, not a shared destination ref update. Pin K through custodian-owned object retention before acknowledgement. No linked-worktree ref isolation is assumed.
4. **Destination integration is a different operation:** reserve exact destination repo/ref expected-old Pdest and candidate integration commit/tree/authorized delta. The user repository is not mounted writable into product processes. For a custodian-managed destination, all admitted ref/config/index writers use the same physical gate. Install commit objects without modifying destination index/worktree; atomically compare-and-update selected ref from expected Pdest using Git's expected-old update primitive. A changed ref yields conflict and new inspection/integration assessment, never overwrite/retry against a new base. Updating any destination worktree/index is separately authorized with its own byte custody; no covert checkout over user changes. An unmanaged destination must first be put under supported exclusive custody/handoff, or integration remains an owned wait—not protection asserted from an advisory Loom lock. External human administrators remain outside hostile-process threat model; their concurrent ref change is still caught by expected-old CAS.
5. A lost response after commit/ref update retains operation ID and reserved P/T/D/K/ref expected-old/new. Reconcile actual detached commit/object pin or destination ref with that identity. Match proves that exact observed operation, a different ref value is conflict/possibly later movement requiring retained receipt history, and insufficient evidence remains unknown. Never blindly repeat publication, fabricate 'not committed', or equate a remote push result with local commit. Remote update uses independently observed ref/provider reconciliation, not local CAS as universal exactly-once proof.

The shell parser/control-plane/native hook all normalize into this same candidate target and explicit operand set. Only changed inputs or different operation purpose may change admission. A foreign replacement of receipt-bound bytes is denied before actual publication custody, not merely noticed after it. Named-file commits prove neither per-actor authorship nor independent approval by themselves.

Commit outcome, push outcome and independent review remain different facts. Lost Git/ref response is reconciled by observed exact tree/ref/operation identity before any potentially duplicating action. Named-file commit alone proves none of author attribution, reviewed content or remote publication.

## Work transitions and continuation

| Command / atomic boundary | Preconditions and result | Re-entry / concurrent behavior |
| --- | --- | --- |
| Amend unasked Plan decision | Planner revision and applicable review; replace/remove draft question | No answer manufactured. Concurrent revision loses expected-version comparison |
| Replace asked question / answer | Preserve presented question/answer, record replacement and affected consumers | Late answer belongs to original identity; material treatment reassessed per consumer, not blanket clearing |
| Abandon intent | Exact explicit abandonment; record unaccepted terminal intent | Old question cannot revive it. Factual aside does not mutate intent; new work obtains its own authority |
| Pause A | Transaction advances A epoch and closes new A admissions | Commit acknowledgement confirms admission pause, not operation termination. B may start after that exact acknowledgement; unsafe overlapping targets stay blocked |
| Cancel B / return A | Exact user cancellation fences B; restore access to retained A, check current A authority/tuples/resources | No B success prerequisite, no new Objective, no implicit A resume permission from selecting it |
| Resume A / owner takeover | Authorized lifecycle transition; CAS lease/epoch, current prerequisites and outstanding operation reconciliation | Old coordinator cannot reserve effects or satisfy current attempts. Expiry alone is not quiescence; old physical writers need broker enforcement |
| Complete attempt / accept use | Commit original output/evidence, then current-use validation with exact gates | Late output always stored under original attempt. Duplicate event ID adds no second outcome; cannot fulfill cancelled/new meaning automatically |
| Repair / independent re-review | Finding and exact subject retained; repair admitted to real author; new independent review | Repair self-verification contributes evidence only. Unaffected result/review uses remain valid |

Notifications are deduplicated wake hints after commit, not proof/authority. Direct stable reads retrieve question/answer/evidence regardless of delivery. `recordTreatment(consumerContract, answerRevision, inputTuple, disposition, rationale, authority)` records incorporation/unaffectedness/authorized deferral. Dispatch to perform treatment is permitted while it is pending. Another consumer's pending treatment cannot block a reconciled ready one. User-decision deferral requires actual authority.

Every unfinished projection returns a bounded action whose actual executor/capability is available, or a wait with owner, missing dimension and enabling condition, or actual user-authorized exit. Scheduling follows existing authorization without routine continue prompts; it does not invent spending. Detect prerequisite cycles including answer/authority/resource edges, not only compiled Task DAG; report internal deadlock as defect with a bounded owner correction path. Cancel is not that correction path for feasible work.

## Resource and capability preflight

Before execution commitment, compiler counts minimum remaining producer/reviewer/acceptance/treatment dispatches (shared admissions deduplicated), required role paths and mandatory proof capabilities across the finite Plan, including later Waves. Compare lower bound with actual authorized remaining limits; retain an identified optional retry estimate separately. Unknown billing is labelled unknown; dispatch availability is not a monetary ceiling. Insufficient capacity yields an authorized bounded alternative or actual user/resource wait before work starts. No retries/children are licensed by this architecture.

Admission reserves actual dispatch once; failed delivery must retain charge/invocation uncertainty according to observed host outcome, not silently reset history. Owner transfer/recompile retains allocations and consumption. Remedy updates only its actual authority/resource fact then resumes the original goal. Unexpected new work may require a new preflight/authorization; known minimum shortage must not be disguised as repeated surprises.

## Verification / limits

[P1–P8 and publication trace](proof-and-recovery.md) prove real compiled graph→control-plane→native-hook→effect→completion composition. This specification does not assert currently available native interception, process containment, digest observation or offline broker functionality. These are falsifiable early implementation prerequisites. Implementers may choose table layout and serialization but may not create another independently mutable contract/status/ownership copy or weaken failure distinctions.
