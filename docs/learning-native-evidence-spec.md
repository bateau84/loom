---
type: API Reference
title: "Native execution and review evidence contracts"
description: "Implementation-facing identity, immutable mandate, evidence-basis and recipient-authorization contracts for the first AOS Learning engineering stage."
tags: [loom, learning, review, evidence, specification]
timestamp: 2026-11-12T00:00:00Z
---

# Native execution and review evidence contracts

**Status: implementation specification for PR #233; these interfaces are not yet production APIs.** The [qualification record](native-review-qualification.md) separately reports which native boundaries were executed. Source inspection, fixture consistency and a specification do not constitute host qualification or activation of automatic learning.

The observer and the review reader must agree on two things: who produced a fact, and what a particular review was actually asked and able to assess. A security review and a correctness review of the same artifact therefore have different immutable mandates. If a Reviewer receives only a manifest pointer, its plausible citations remain citations; they do not establish access to the source material. If the parent may read a source but the child may not receive it, preserve the requested subject privately and withhold its content.

This contract realizes the accepted architecture without creating another orchestrator, transcript store, source ACL policy or retrospective scheduler. It specifies logical records and operations; physical tables, migrations, richer capture policy and production review-admission wiring remain subsequent work.

## Derived from

- [Accepted evidence and review architecture](learning-evidence-and-review-scope.md).
- [BR-001: execution attribution](requirements/learning-retrospectives/br-001-preserve-execution-attribution.md), [BR-002: historical work scopes](requirements/learning-retrospectives/br-002-preserve-historical-work-scopes.md), and [QS-001: concurrent attribution](requirements/learning-retrospectives/qs-001-concurrent-execution-attribution.md).
- [BR-003: original review mandate](requirements/learning-retrospectives/br-003-preserve-review-requested-subjects.md), [BR-004: actual basis and verdict](requirements/learning-retrospectives/br-004-preserve-review-basis-and-verdict.md), and [BR-005: source material and gaps](requirements/learning-retrospectives/br-005-expose-source-evidence-and-gaps.md).
- [OC-001: host provenance](requirements/learning-retrospectives/oc-001-host-observation-and-dispatch-provenance.md), [OC-002: review admission and evidence](requirements/learning-retrospectives/oc-002-review-admission-and-evidence-basis.md), and [OC-003: protected-source and derived-report access](requirements/learning-retrospectives/oc-003-protected-source-and-derived-report-access.md).

The user accepted these as this stage's baseline. Their earlier document status labels are not runtime claims. **E11 remains the future assembled acceptance target**, including the 100-task population, actual native reviews, correction, automatic evaluation, recovery and authorized public readback.

## Existing seams and bounded realization

| Responsibility | Existing owner and required reuse |
| --- | --- |
| Native project and Session checks | [Plugin integration](../src/plugin.ts): validate native Session project, workspace and real location; obtain actors from native tool context, not tool input. Project membership alone is not source-read or disclosure authority. |
| Start/finish ownership | [Observer](../src/context.ts) and [Store](../src/store.ts): retain start Focus, subject fingerprint, observer epoch, pairing exclusions and capture-off behavior. Current automatic starts do not save a complete WorkRef or its Action/Plan revision fields. Do not bypass these safeguards with a new correlation map. |
| Historical task definition | [Collaboration](../src/collaboration.ts): retain `WorkRef`, `checkedRef`, saved Action/Plan revisions and `workReference` verification. |
| Authored assessments | Existing assessment/QA/result records retain the reviewing `Actor`; new relationships must not repurpose `evidence_ids` to bypass existing Action/Session checks. |
| Authorized native history | [Session trace](../src/session-trace.ts): retain its source authorization and coverage limits. A full-content reader must not claim the current bounded trace projection returns omitted payloads. |
| Independent context | [Handoffs](handoffs.md) and review companions remain instruction/context mechanisms, not proof of independent reasoning or completed assessment. |

Two alternatives were considered at this boundary. Reconstructing review membership later from the selected Plan, parentage and citations is smaller to implement but cannot preserve the original question, historical population or actual access. Freezing the mandate at admission and appending qualified native observations satisfies those obligations using the existing source/history owners. This contract selects the latter. No new store or generalized execution controller is selected.

## 1. Vocabulary, identity and provenance

The types below are logical data contracts. `null` means a field is known to be unavailable or not applicable as specified; omitted required fields are invalid. Extension rules appear in section 9. Native identifiers are opaque strings validated against the qualified host schema. Do not coerce, lowercase, trim, shorten or generate replacements for missing native IDs. Loom-generated IDs use existing `uid` validation; they identify local records only.

```ts
type SourceNamespace = {
  project_id: string | null
  workspace_id: string | null
  directory: string | null // canonical native location when established
  store_id: string  // local source-store identity; not a host-issued identity
}

type NativeAdmissionKey = {
  namespace: SourceNamespace
  session_id: string
  message_id: string // native input/inbox ID, not an assistant tool message
}

type NativeToolKey = {
  namespace: SourceNamespace
  session_id: string
  message_id: string // native assistant message containing the tool call
  call_id: string
  tool: string
}

type ObservationRef = {
  record_id: string
  observer_epoch: string
  sequence: number // positive safe integer; order within this observer only
}

type NativeBinding<T> =
  | { status: "established"; value: T; observations: ObservationRef[] }
  | { status: "unknown"; reason: GapReason; observations: ObservationRef[] }
  | { status: "ambiguous"; candidates: T[]; observations: ObservationRef[] }

type GapReason =
  | "not-observed" | "unsupported-host-boundary" | "missing-native-field"
  | "opaque-inner-call" | "capture-disabled" | "capture-failed"
  | "observer-discontinuity" | "history-unavailable" | "compacted"
  | "redacted" | "not-authorized" | "source-missing" | "source-changed"
  | "unsupported-version" | "processing-limit"
```

`store_id` scopes records to the local authoritative source-store instance; restoring that store preserves it, while importing another host's records must preserve a distinct source namespace. This is a logical namespace requirement, not a new global host identity or configuration format. If historical records cannot establish their namespace, their cross-store relationships remain unknown. Matching native strings across stores cannot merge identities.

An `established` binding requires at least one observation that contains the relevant native fields or a qualified chain of such observations. The chain must establish the relationship, not merely contain both endpoints. Missing namespace fields disallow cross-store establishment. `ambiguous.candidates` lists only distinct known native values; it may be empty when the missing discriminator prevents enumeration, with the conflicting observation references retained. Locally numbered candidates are never invented native values. The [qualification record](native-review-qualification.md) is the allowed-mechanism inventory for the inspected host. Unsupported mechanisms cannot produce established bindings even if an adapter can generate a plausible identifier.

Authored relationships use a separate record `{ author: Actor, statement, source_refs, recorded_at }`; they are never another constructor of `NativeBinding`. A dispatch token, title, input hash, nearest timestamp, agent name, FIFO order or parent Session alone cannot upgrade an authored relationship. Fixture-provider observations must carry `source_kind: "scripted-provider"`; host observations carry their actual hook/event kind. A fixture conclusion is not an observation.

### Identity rules

1. A native **Session** is a container that can receive many inputs. It is neither a dispatch nor one enduring Reviewer invocation.
2. A native **dispatch** is a parent tool invocation identified by `NativeToolKey` only to the extent that key is unique on the observed path. Two calls targeting one child retain separate parent keys.
3. A native **admission** is the child Session/input-message pair. A pre-admission hook is an observation opportunity; durable native enqueue/readback confirms admission. Delivery into Session history is a separate observation.
4. An **attempt** is a locally recorded effort against a frozen work scope. Its ID may reuse the saved start record ID. An attempt references, rather than manufactures, native dispatch/admission bindings. A corrective retry is a separate attempt even when the work and child Session are unchanged.
5. An **event** retains its own producer Session, agent and native fields. A review finding belongs to the Reviewer; `concerns` links to earlier producing attempts without transferring authorship.
6. Top-level work with a positively established lack of parent dispatch is `unscoped-to-dispatch`. An unavailable parent relationship is `unknown`, never automatically top-level. Unassigned Loom work and missing historical scope are likewise distinct.

### Duplicate and collision handling

The raw hook tuple is a correlation group until the actual host path establishes uniqueness. Preserve separate starts when the host repeats it; never deduplicate starts because input bytes match. Reuse current Store pairing rules: exactly one eligible saved start, no earlier successful pairing, matching actor/input metadata, compatible observer epoch and no relevant capture gap. Input digests reject mismatches; they do not select a start among candidates.

When a host exposes a durable event ID, `(source namespace, native event ID)` identifies replay of that *event*. The same ID and identical payload may reference the existing observation; the same ID with different payload is a conflict retained as a gap and cannot overwrite the original. Repeated before/after hooks without a durable event ID remain distinct local observations, not assumed transport replay.

Store writes establish local ingestion order. Source clocks establish only the order the host actually promises. Native durable event envelopes retain their original event ID and `(aggregateID, seq, version)` when provided; the sequence is per aggregate, not global. Hook observations have no invented native event envelope. Observer sequence, host event order and wall-clock timestamps must remain separate; no cross-observer causal order follows from their numerical proximity.

## 2. Historical work and artifact references

Reuse the exact current type and validation:

```ts
type WorkRef = {
  action_id: string
  node_id: string
  action_revision: number
  plan_revision: number
  hash: string
}
```

Revisions are positive safe integers, the hash is the existing lowercase SHA-256 work fingerprint, and IDs obey `checkedRef`. Resolve the original Action definition and saved Plan, then recompute `workReference` against those revisions. Do not call the current-selection reader as a substitute. The hash verifies that definition; the authorized historical definition itself must be retrievable or explicitly unavailable. Preserve current dependency/group semantics: a group WorkRef includes its relevant descendants and dependency contracts, and contextual ancestors are not independently requested review subjects merely because they affect the fingerprint.

Under this proposed contract, an attempt freezes its original WorkRef before native work begins when Loom can observe that boundary. A start with no selected work stores `work_scope: { status: "unscoped" }`; a missed or unresolved scope uses `unknown` with a reason. A late result copies the established start association, never the currently selected Action/node. A scope change creates a separately attributed change/new attempt; it does not mutate an earlier WorkRef.

**Current implementation limit:** `Store.startObservation` saves the selected Focus and `subject(...)` fingerprint atomically with the start; `finishObservation` preserves those fields when pairing succeeds. That fingerprint is not a complete WorkRef and does not by itself identify the saved Action/Plan revisions needed for full historical reconstruction. The separate public `loom_record complete` path already validates and saves an explicitly supplied historical WorkRef. Qualification Q7 exercises that completion path and the outer call's original Focus/fingerprint; it does not prove automatic WorkRef capture for arbitrary native child dispatches. Persisting the full start/attempt WorkRef and reconstructible source relationship remains downstream implementation work.

Artifact references use exact, separately retrievable versions:

```ts
type ArtifactRef = {
  locator: string // source URI/path, not proof of version or access
  version:
    | { kind: "git"; repository: string; object_id: string; path: string | null }
    | { kind: "sha256"; value: string }
  content_ref: string | null // authorized source/snapshot lookup, not raw content
}
```

`git.object_id` is the full immutable object ID in the stated repository, with its algorithm established by that repository; `path` selects bytes within that immutable object when applicable. A branch, tag, PR number or worktree directory alone is invalid as an exact version. Dirty work requires a separately identified snapshot/digest of the actual reviewed bytes; a clean commit does not cover uncommitted content. A SHA-256 is 64 lowercase hexadecimal characters over the exact original bytes. A digest with no retrievable bytes has `content_ref: null` and a source gap, not complete material availability. Existing author-written `artifact_refs: string[]` remain historical hints until their versions are established; this contract does not silently upgrade them.

## 3. Immutable review request and frozen membership

The review-admission owner obtains the requester `Actor` from a checked native caller and constructs this logical request **before** issuing native review work:

```ts
type ReviewRequestV1 = {
  format: "loom-review-request/v1"
  request_id: string
  requester: Actor
  mandate: {
    question: string
    dimensions: string[]
    criteria: Array<{ text: string; source_ref: string | null }>
    mode: string
    inclusions: string[]
    exclusions: string[]
  }
  intended_recipient: { agent: string; session_id: string | null }
  work_revision_policy: "frozen-historical" | "current-at-issue-claim"
  members: ReviewMember[] // logical complete sequence; may be stored/read in pages
  rechecks: Array<{ request_id: string; finding_ids: string[] }>
  extensions?: Record<string, unknown> // optional non-authoritative JSON data only
}

type ReviewMember = {
  member_id: string
  work_ref: WorkRef | null
  producing_attempt_refs: string[]
  artifact_refs: ArtifactRef[]
  prior_review_request_id: string | null
  membership_source_refs: string[]
  gaps: Array<{ reason: GapReason; source_ref: string | null }>
}
```

`question` and `mode` are nonempty original authored text. Every mandate field is required; an empty array means the requester explicitly supplied no entries, not that the observer failed to capture them. Criteria preserve their original text; a source reference is additive provenance, not replacement text. Do not normalize questions, modes, criteria or exclusions into a later Reviewer's wording. Existing processing limits apply to each admitted record; oversized input returns `processing-limit` without saving a truncated request or dispatching it.

Every member has at least one of `work_ref`, nonempty `producing_attempt_refs`, nonempty `artifact_refs`, or `prior_review_request_id`. Empty producing-attempt references mean none was established/selected, not that all attempts are included; retain a gap if a requested attempt's source could not be resolved. `membership_source_refs` identify the authorized request/resolution source. `gaps` records source-availability limitations without substituting guessed membership; unresolved selection membership prevents authoritative frozen admission. Later availability changes append observations without editing these original limitations. `member_id` is unique within the request. Reject duplicate member IDs and exact duplicate subject selections: the subject-selection identity consists of all WorkRef fields, the set of producing-attempt references, the set of exact artifact references and the prior review request ID. Source-provenance references do not make repeated subjects independent. Different attempts or artifact versions may form distinct members even with the same WorkRef. Member order is frozen, with no ordering inference about execution.

Resolve group selections to the exact requested constituents before freezing. Preserve the selection expression as optional authored context if useful, but readers enumerate the frozen members rather than rerunning the selection. A mutable query is not a manifest. All member pages and the mandate must become durably visible as one frozen request before dispatch is permitted. Readers must never observe a published header claiming a complete population while its pages are missing.

`work_revision_policy` is explicit and immutable; it is never inferred from a later active selection. `frozen-historical` permits the exact requested WorkRefs even after a Plan changes. `current-at-issue-claim` adds a precondition to the local atomic issue claim: every member WorkRef's Action and Plan revision must still equal that Action's saved current revisions, and its hash must verify against them. A mismatch rejects that attempt with reason `stale-scope` before any native issue; unavailable/denied verification rejects with its corresponding reason. Read and claim share the existing transaction, so a concurrent local edit is ordered before or after that check. A later edit does not invalidate the already frozen review or imply that the WorkRef remained current throughout execution. This policy concerns saved Loom work revisions only; artifact references always name exact immutable versions and do not assert that a branch/worktree stayed current. A request without work references satisfies the work-revision check vacuously.

Pagination uses this logical contract: `read(request_id, after_member_id | null, limit)` returns the frozen request identity, member slots in frozen order, `next_member_id | null`, and complete-population metadata only when its disclosure is permitted. Limits remain 1–50 per page. The continuation identifies the last returned member and is exclusive; it is null only after the final member. An invalid/deleted/nonmember cursor is an error, not an empty final page. Authorization applies on every page. A slot contains authorized member data or an explicit withheld-content gap when that member's existence may be disclosed. If its identifier/existence is also protected, deny that view without revealing protected pagination/population metadata; do not silently remove the slot and present a smaller complete manifest. A page limit never changes original membership or implies complete review coverage.

### Request identity and concurrent callers

`freeze(request_id, body)` does not execute native work. A write transaction publishes either the entire immutable request or nothing. It returns `created`, `existing`, `conflict`, or a typed validation/storage/access error. A repeated request ID returns `existing` only when every immutable submitted field agrees: strings compare exactly without trimming or case folding, arrays compare in order, records compare by field names irrespective of JSON key order, and missing versus `null` is not equivalent. These rules recurse through extension JSON as well. The generated recording timestamp is not part of submitted-body equality. Resolved WorkRef/version fields are part of equality; retry does not silently resolve newer revisions.

For simultaneous identical requests, exactly one contender returns `created`; others return `existing` with that same frozen request. For conflicting bodies, one can create and every conflicting contender returns `conflict`; none may change the winner or initiate another dispatch as a side effect of this operation. A request ID is never derived only from subjects/artifacts: R1 security-only and R2 correctness/reliability must remain distinct. A later change of any mandate/member/version requires a new request ID linked through `rechecks` where appropriate.

If a write fails before its durable commit, the request is absent. If acknowledgement is lost after commit, an identical retry returns `existing`. These rules make local request admission idempotent; they do not confer native exactly-once execution.

## 4. Native dispatch and review admission

Keep request identity and each dispatch attempt separate. Before issuing native work, append an attempt referencing the frozen request and its intended recipient. The attempt's local ID is not a native invocation ID. Its issue projection uses `prepared`, `claimed`, `issued`, `rejected`, or `unknown`; its dispatch/admission bindings and native return are separate fields, not success implied by that status. `prepared` means durable request/attempt exist with no issue claim. In one transaction, check the request's work-revision policy and atomically change `prepared` to `claimed` with one issuing-owner ID, or to `rejected` with the failed precondition. Simultaneous callers receive the stored owner/status and do not issue another native call. Only that successful claimant may issue. Observed native issue changes it to `issued`; a proven pre-admission rejection changes it to `rejected`; a crash or lost acknowledgement with no decisive receipt changes it to `unknown`. A return is recorded independently and cannot by itself repair a missing dispatch/admission edge. A caller cannot reacquire a claim merely because a timer elapsed or the original process disappeared.

| Observation/transition | What may be recorded | What must remain unclaimed |
| --- | --- | --- |
| Frozen request, no native issue | Original mandate and membership; local attempt is prepared. | Child creation, native admission, evidence delivery. |
| Native call issued, before completion | Parent tool key and known original work scope. | Successful child prompt admission or review completion. |
| Native child progress/result | Child Session binding if the native event/result supplies it under a qualified unique parent key. Verify native parentage/location. | That this child belongs exclusively to this dispatch, or that its entire history is the review. |
| Child prompt hook | Candidate `NativeAdmissionKey`, prompt observed at this named hook. | Committed admission, final effective prompt, provider receipt. |
| Native inbox enqueue/readback | Committed native input identified by Session and input message ID. | Native parent-call-to-input link if the host does not expose it. |
| Native inbox delivered | Delivery into the native Session history at that input ID. | Model comprehension, exact response ownership, or final provider exposure. |
| Native parent return | Native result/status under the parent key; child metadata if present. | Acceptance of reviewed work, per-input response attribution when a child job was shared. |

A review execution record contains separate `NativeBinding` values for parent dispatch, child admission and their relationship. Do not collapse these into a single `verified: true`. The original mandate remains available even if the native binding fails.

After a crash between native issue and observed admission/return, record `unknown` and reconcile only through qualified native receipts. Do not dispatch again automatically. An explicitly authorized retry uses a new local attempt identity; it preserves the request and unresolved prior attempt. Definitive rejection before native admission prevents a successful admitted-review supply/retrieval claim. Preserve actual earlier named-boundary observations, including source bytes exposed at a prompt hook before later prompt preparation failed; record the rejected/unconfirmed admission and do not promote that observation into successful admitted-review supply. A timeout or missing return is not definitive rejection. Cancellation likewise does not retract already observed admission, transfer or access; record any late native return against its original proven key, leaving its completeness and unknown links unchanged.

### OpenCode 2.2.6 binding boundary

At inspected revision `dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06`, native `subagent` progress/result carries the child Session; its call to `sessions.prompt` supplies child Session/text but no parent tool-call identity. The prompt hook exposes the child input ID, while `model.request`/context hooks expose Session identity without a distinct dispatch/admission ID. A Loom token may aid diagnostics, but is a Loom-authored correlation and cannot become a native edge.

Continuing a child is supported by native `input.sessionID` and a parentage check. A running child receives another input, and native jobs may join by child Session ID. A returned child output therefore must not be treated as the unique result of whichever dispatch finished first. Native lifecycle events scoped only to a Session cannot repair this missing invocation edge. The qualification matrix determines which narrower mechanics were executed; generalized exact dispatch-to-input-to-response attribution remains unavailable until an appropriate host guarantee is qualified.

An external review outside Loom admission has no fabricated `ReviewRequestV1`. Preserve available original native prompt/source observations with `request_provenance: external` and explicit `unknown`, `partial`, or `unverified` mandate/membership. A later authored interpretation may reference it but cannot backdate a frozen mandate. Loom-mediated requests apply the explicit `work_revision_policy`; a native external review cannot retrospectively acquire that precondition or a falsely confirmed successful admission.

## 5. Effective evidence basis

These are independent relationships, not automatic states in a progression:

| Relationship | Required source observation | Meaning and prohibited inference |
| --- | --- | --- |
| `requested` | Frozen mandate/member or qualified original external request. | The source is in the asked-for scope. No transfer/access follows. |
| `supplied` | Actual material bytes observed at a named native input boundary, tied to the same receiving admission/execution to the extent established; the observation may retain only an exact permitted content reference/digest. | The identified bytes crossed that boundary. A pointer supplies only the pointer. Early prompt observation is not final provider exposure. |
| `retrieved` | Successful authorized source-return observation under the receiving native tool key, with exact source/version and returned coverage. | The tool returned that material in that execution. A requested path or completed tool with only metadata does not prove underlying content returned. |
| `cited` | Reviewer-authored citation in an attributed result. | The Reviewer named the source. Existence, retrieval and correctness remain separate. |
| `claimed-inspected` | Reviewer-authored statement in an attributed result. | The Reviewer asserts inspection. No comprehension or coverage attestation follows. |

Every supply/access row references: the source identity/version; observation IDs; receiving Session and known native admission/tool fields; review-attempt relationship and its qualification; boundary kind; actual content coverage; and authorization decision reference when protected material is involved. Its `review_binding` must remain unknown/ambiguous when same-execution binding cannot be proven. Observing bytes in a child Session can support a Session-scoped supply fact while **not** satisfying the admitted-review same-execution claim.

Boundary kinds are `prompt-hook`, `native-inbox`, `session-context`, `provider-request`, and `tool-return`. A later boundary requires its own receipt; rows must not be relabelled. Content coverage is `full`, `excerpt`, `redacted`, `reference-only`, or `unknown`. `full` refers only to the exact identified source/version, not all requested subjects. Excerpts record exact source ranges or a separately identified excerpt snapshot; redaction records what policy-approved detail may be retained. Do not use substring occurrence as proof that a large source was completely supplied.

A scripted provider-call observation at the fixture's AI SDK `doStream(input)` boundary can show the actual input supplied to that local provider implementation, with the native Session header where present. The current fixture is in-process: this is not an HTTP transport receipt and does not prove later wire serialization. It does not invent an admission/dispatch ID absent from the call, prove behavior of another provider, or establish real model reasoning. Changes by later prompt/context hooks, provider serialization, compaction or truncation require new boundary evidence or leave final exposure unverified.

The native tool key identifies a source-return producer only under its qualified uniqueness conditions. Opaque Code Mode inner operations sharing the outer context remain ambiguous. Provider-executed tools are provider-reported unless a separate qualified native observation exists. Direct calls to a tool implementation that bypass native runtime hooks must not claim a newly observed native invocation.

A finding stores the Reviewer's producing observation/result reference separately from `concerns` references to member IDs, producing attempts, artifact versions and earlier findings. Its declared verdict scope is compared against the **original** mandate and actual evidence coverage. A security-only PASS answers that mandate only. Unknown/inaccessible members remain gaps; neither a broad verdict label nor 100 requested members certifies 100 assessed members.

## 6. Recipient authorization and transfer ordering

Four checks are separate and must be separately attributable:

1. **Request/name authority:** may this requester establish these requested subjects and reveal their identifiers in the chosen manifest view?
2. **Source-read authority:** may the current source reader retrieve this exact content now?
3. **Recipient-transfer authority:** may this exact receiving execution receive this source/version for this purpose, or is there an independently authorized disclosure permitting it?
4. **Later disclosure authority:** may the later reader receive this source-derived finding/report, including identifiers, citations, previews and aggregate metadata?

The decision record for a protected transfer contains the source/version and coverage, actual recipient namespace/Session and established invocation scope, purpose, effective policy/authorization reference, decision (`allow`, `deny`, `unknown`), and applicable validity/revocation conditions supplied by that authority. It must not invent a universal TTL, implicit child inheritance or a retention duration. A bare permission success without the required source/recipient scope is insufficient.

**Check before source bytes enter the recipient's native prompt, attachment or tool return.** If the recipient cannot yet be identified within the authority's permitted scope, do not include protected material. A later hook that removes content already submitted to child-native processing is not proof that no transfer occurred. A successful read by parent A cannot be reused as permission to embed B in child C's prompt.

The source owner must enforce allow against the concrete recipient and actual material at transfer time. An authorization check followed by an uncontrolled recipient, source-version or policy change is not a valid transfer fence. If authority is revoked or cannot be revalidated before the transfer, deny/withhold and record the gap. A prepared request stays frozen; it does not become empty, disappear or acquire a false supply receipt. A retrieval denial similarly records `not-authorized`, never successful retrieval of an empty source.

Native OpenCode source inspection does not establish a per-Session source ACL or general incoming-content disclosure gate. Its subagent permission check governs calling that agent. Children inherit parent Session-specific rules and also use the receiving agent's rules; agent name alone cannot establish effective recipient policy. A source tool may explicitly enforce recipient-specific permission on its own read path, but that cannot stop a previously authorized parent from inlining the same source. [Qualification](native-review-qualification.md) must keep those two cases separate. This specification mandates the future checks; it does not claim an unimplemented Loom policy service, native ACL or successful protected review.

The request/manifest itself may expose protected task descriptions or identifiers. Preserve complete membership in its permitted store, but apply the same access checks to its metadata and every read page. On denied public read, reveal only policy-approved status. Broader redacted/declassified reports require a separate authorized release; source-reader authority and a model-generated summary do not supply that release.

Existing `ledger.capture: automatic` retains its current metadata/digest meaning. These contracts do not authorize raw prompt/tool-result storage. Richer content retention, eligible sources/readers, deletion, expiry and backups remain operator decisions. Until authorized, reference permitted original content or retain an explicit gap; do not copy protected payloads into ledger data to make a test pass.

## 7. Minimum persistence-facing relationships

Downstream persistence must retain these logical relationships without requiring one table or new database per concept:

| Relationship | Minimum durable meaning |
| --- | --- |
| Observation → source | Original producer fields, actual boundary, source namespace, observer epoch/order, native fields or explicit absence, source-version/content reference and coverage. |
| Attempt → historical work | Frozen verified WorkRef or unscoped/unknown state; original start record; separate native bindings. |
| Review request → mandate/members | Immutable original question, dimensions, criteria, mode, exclusions, full frozen membership and artifact versions; requester and creation provenance. |
| Review attempt → request/native work | One immutable request, local attempt identity, issue/admission/return observations and separately qualified native edges. |
| Evidence basis → source/recipient | Requested/supplied/retrieved/cited/claimed-inspected relationship, exact source revision/coverage, actual recipient binding, observations and transfer authority when applicable. |
| Finding → producer/subjects | Reviewer's source ownership, affected subjects/attempts, actual checked coverage, mandate-relative verdict and limitations. |
| Correction → prior record | New attributed correction and explicit superseded relationship or disputed interpretation; original facts remain readable. |

Local record IDs, observer receipts and timestamps must not be accepted as host-issued authentication. Native imports preserve their declared source; editable exported JSON cannot bootstrap attestation. Missing source content invalidates current availability/completeness without rewriting a historical fact that bytes were observed at a boundary.

Atomic request publication and unique attempt issue claims use the existing transactional owner. A failed write must not publish a successful receipt. Observation recording failures do not cancel unrelated healthy engineering tools or weaken routing guards; they produce visible coverage degradation under the current observer rules. This stage does not implement those new durable records, migrations, scheduling, retention or report publication.

## 8. Failure and lifecycle contract

| Condition | Required result and safe downstream inference |
| --- | --- |
| Missing native field/hook | Preserve the known Session/observation; binding unknown with explicit reason. Do not invent the absent ID. |
| Multiple starts share a native group | Keep all starts; finishes stay ambiguous without a host discriminator. Matching arguments or reverse completion order cannot resolve them. |
| Native prompt rejected or cancelled | Preserve original request and every actual earlier named-boundary observation, including pre-admission exposure. No later transfer/access or successful admitted-review supply is inferred; rejection/cancellation cannot erase an already observed transfer or access. |
| Provider or source tool unavailable | Keep requested membership and exact source gap. A returned error/status is not evidence of source access. |
| Host/process interruption | Preserve completed durable observations; active joins remain incomplete. New observer epochs do not inherit lost pre-hook continuity. |
| Late return after changed selection | Use the original unique start binding; otherwise store an unpaired return without assigning current work. |
| Child reused/steered while running | Preserve separate dispatch/admission observations and known child identity. Shared output cannot become one independently completed result per dispatch. |
| Compaction/deletion | Preserve permitted original references and observed facts; unavailable original content remains a gap. A summary is not substituted for complete original bytes. |
| Scope/artifact changed | Old request retains old versions. `frozen-historical` permits the requested revisions; `current-at-issue-claim` rejects changed current work revisions atomically at the issue claim. Neither policy rewrites artifact versions or implies the branch/worktree remains unchanged. |
| Authorization denied/revoked/unknown | Withhold protected content before transfer/readback. Keep policy-permitted membership and denial facts; do not turn a lack of visible content into an empty successful review. |
| Retried local request/unknown native attempt | Return the existing immutable request/attempt state. Do not create new native work unless a separately authorized new attempt is recorded. |
| Storage/processing bound | Fail the affected operation explicitly, without partial manifest publication, silently omitted members, or a successful receipt. |

## 9. Versioning and historical compatibility

`loom-review-request/v1` is a proposed logical record version, not an already accepted external tool schema. New producers emit only v1 while this contract is the supported contract. An added optional `extensions` mapping may contain non-authoritative presentation data; readers can ignore unknown extension keys. Required identity, authority, lifecycle or coverage semantics must never be hidden there.

Unknown fields outside an explicitly declared extension mapping, unknown discriminators, unsupported versions and malformed required fields are rejected for new writes. A reader encountering unsupported required meaning returns `unsupported-version` and withholds qualified claims dependent on it; it must not reinterpret an unfamiliar value as success, empty membership or default authority. Preserve the original record for a compatible reader, subject to existing retention rules.

Old ledger/assessment records remain readable through their existing readers. They acquire no invented WorkRef, original mandate, admission edge or successful access state. Existing `artifact_refs` strings, legacy scope and historical missing native IDs remain qualified hints/gaps. Migration and rollback must not upgrade them through current selection or fill missing values with locally generated native-looking IDs.

An unknown/new OpenCode version or changed SDK shape requires fresh source inspection and affected installed-host qualification. Preserve supported facts at their existing granularity while required edges are `unsupported-version`. Do not globally disable healthy native work simply because optional learning qualification is missing. Exact-host CI green applies to its recorded revision/configuration only.

## 10. Conformance and remaining dependencies

The [native qualification harness](../tests/installed_native_review.py) is the current boundary probe, with results and limitations in [its qualification record](native-review-qualification.md). Its Q1–Q7 scenarios are supporting stage evidence. No source-inspected or unexecuted scenario is PASS, and a fixture/provider receipt proves only the actual measured boundary.

Before production admission/persistence can claim this specification, downstream tests must also demonstrate:

- Two identical-artifact reviews retain different original questions, dimensions, criteria, modes and exclusions after fresh reads; changed Reviewer assertions cannot rewrite either mandate.
- Same request ID with identical versus conflicting concurrent bodies produces the specified `created`/`existing`/`conflict` outcomes, including lost acknowledgements; competing issue callers cannot cause duplicate native dispatch.
- Frozen membership of 1, 10 and 100 subjects is fully reconstructible across pages and historical changes without substituting current WorkRefs or silently omitting protected members.
- The same historical WorkRef remains valid under `frozen-historical`, while `current-at-issue-claim` rejects it after a saved revision changes; concurrent change/claim ordering matches the transaction's actual outcome.
- Prompt preparation failing after a prompt-hook observation preserves that exposure fact while reporting no successful admitted-review supply; cancellation similarly retains actual earlier access.
- A manifest-only native prompt with plausible citations never yields full supplied/retrieved coverage; source-return receipts with a missing same-execution edge remain qualified.
- Requester A's permitted read of B cannot authorize transfer to C; denying C's read and preventing incoming inline disclosure are tested as distinct boundaries.
- Restart, late returns, opaque nested keys, cancelled admissions, missing native fields and unsupported record versions retain the specified unknown/ambiguous states through public readback.
- Source/derived-report denial and revocation remain effective across all reader paths and restore; legacy automatic capture retains no newly authorized raw payloads.

### Minimum upstream guarantees

For generalized exact review execution, the needed host addition is a **host-owned causal edge** from the native parent tool invocation to the exact child admitted input, and from admitted input(s) to subsequent model/tool/result execution. It must support a set of contributing inputs when steering joins work, retain explicit unknowns for historical/imported data, distinguish retries from new work, and survive restart/compaction through authorized receipt lookup. A caller-writable metadata field or plugin-signed token is insufficient.

For protected automatic transfer, a qualified boundary must identify the actual recipient before material crosses into its prompt/tool result, and permit source-specific read/transfer authorization to be enforced there. This may be an explicitly enforced source service combined with a suitable native pre-transfer hook; merely adding a recipient ID to a post-transfer event does not satisfy it. This contract does not choose a global ACL model or grant policy.

For exact final exposure, any receipt must identify the actual provider-bound payload, Session and relevant contributing execution/input identities, including transformations and truncation. Receipt absence leaves the earlier observed boundary useful but qualified. No receipt establishes model comprehension.

The next coherent stage is the smallest durable request/attempt/relationship implementation that preserves these unknowns and current safeguards, with its public reconstruction tests. It must not enable protected transfer or automatic evaluation on the strength of source inspection. Operator-owned retention/disclosure policy and unsupported native execution edges remain separate prerequisites for those affected capabilities.

## Implementation references

- [Pinned native subagent](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/core/src/tool/plugin/subagent.ts), [Session prompt implementation](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/core/src/session/session.ts), and [prompt preparation](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/core/src/session/prompt.ts).
- [Pinned Session plugin hooks](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/plugin/src/promise/session.ts), [tool hooks](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/plugin/src/promise/tool.ts), and [native Session events](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/schema/src/session-event.ts).
- [Pinned child job joining](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/core/src/job.ts), [Code Mode tool context](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/core/src/codemode/tool.ts), and [execution runner](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/core/src/session/runner/llm.ts).
- [Existing evidence pairing](evidence-reliability.md), [native request identity](native-request-identity.md), [host trust contract](learning-host-trust-contract.md), and [Evaluator observer limits](native-evaluator-audit-qualification.md).
