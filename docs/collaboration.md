---
type: Architecture
title: "Reported progress and contextual questions"
description: "Explains reported progress, contextual questions and their execution boundaries."
tags: [loom, coordination, questions]
timestamp: 2026-10-24T00:00:00Z
---

# Reported progress and contextual questions

The Plan describes intent. The ledger stores completion reports, reopen events,
questions and answers. The five tool names remain unchanged. The current production
implementation has no scheduler, approval grant or automatic parent completion.
Blocking is stored collaboration intent, not a workflow gate or forced wait.

## Current collaboration boundary

Questions and answers are durable and attributed to the actual calling agent and
Session. No Action, Plan or assignment is required. Legacy `to_agent` dispatch
is fail-closed; new typed recipients on OpenCode 2.3.0 request native delivery.
Native permission remains authoritative. Installed-host boot evidence is separate
from installed-question qualification.
Only the first committed answer to a new-format blocking question qualifies for
one best-effort exact-asker resume. General assignment/delivery/authorization/retry
operations AND views are retired; their history remains readable and inert.
Earlier [comparison](handback-comparison.md) results do not qualify this replacement.

## Completing the work actually performed

Before working, read/select the node through `loom_context` and retain its exact
`result.work_ref`. It includes Action ID, node ID, Action revision, Plan revision
and a `loom-work/v1` definition hash. It is a reference, not execution authority
or proof that an agent actually performed the work.

When done, call `loom_record` with `operation: "complete"`, that **retained object**
as `work_ref`, and a truthful `statement`. Optional `artifact_refs` are unverified
references. All four node kinds use this operation. It does not read or change the
caller's selection. Optional explicit Action/node IDs must match the reference.
Never fetch a new reference merely to label earlier work complete against changed
requirements. Missing, forged or unavailable references fail without writing a report.

The report stores the original reference and `work_goal`; historical Plan nodes
remain readable with `loom_plan` at `work_ref.plan_revision`. Action definitions
are archived transactionally before updates, so later goal changes cannot silently
replace the earlier definition. This additive `action_versions` table does not
backfill Action versions lost before this implementation. Missing history is an
error, not permission to substitute the latest version. Avoid mixed old/new writers.

Progress is derived from the latest explicit completion/reopen ledger event:

| State | Meaning |
| --- | --- |
| `open` | No completion report, or explicitly reopened |
| `reported-complete` | The report's definition matches the current work |
| `needs-reconfirmation` | Relevant intent changed, or the node is no longer current |
| `validity-unknown` | The bounded comparison could not establish a match |

Revisions provide traceability but are not the definition identity. Unrelated
Plan edits and Action state-label changes do not invalidate completion. The hash
includes the goal, node contracts, inherited parent contracts, relevant dependencies
and contained work. Descendants count for the selected group and dependency groups,
not for ancestors used only as context. Adding a child therefore reconfirms its group
without invalidating unrelated sibling tasks. Equivalent ordering of nodes,
dependencies, roles and skills does not change identity. Other contract-field changes
are treated conservatively as changed intent, not semantically interpreted by a model.

A completion of historical work is retained even when already outdated. No child,
parent, dependent node or Action is changed automatically. A failed QA verdict or
open question does not prevent reporting completion; reported completion is not
independent acceptance, test success, artifact freshness or resolved uncertainty.

To reopen, use `operation: "reopen"`, explicit `action_id`/`node_id` or a selected
node, and a `statement` explaining why. This appends history without erasing earlier
reports or findings. It can reopen removed work with existing progress history;
it does not restore the node to the Plan. Concurrent reports are ordered by ledger
sequence: the latest explicit report is the current report, not an approval decision.

## Asking and answering without selecting another Session's work

`loom_record` supports:

- `ask`: required `question`, explicit Boolean `blocking` and exactly one of
  `recipient:{kind,id?}` (agent/role requires id, dispatcher/user no id), legacy
  `to_agent`, or an explicit destination `session_id`. Optional `action_id`
  associates the question with another existing Action rather than the selected one;
  it cannot be combined with `reference`. Optional `context`, `context_attachments`,
  `reference:{action_id,kind,id}`, `answer_type` and `choices`. Reference kinds are action, phase, wave, task,
  subtask. The returned record ID is the question ID.
- `answer`: required `question_id` and a text answer, choice selection or cannot-select
  response as described below; optional `context_attachments`.
  The original question supplies its nullable Action/node association.
- `bind-respondent`: `question_id` and `respondent_session_id`. After native
  specialist delegation, only the dispatching Session can bind one matching
  native child. Only that child may answer; siblings cannot.

Dispatcher-addressed questions notify the parent with direct-answer instructions.
The dispatcher may consult a specialist, but remains the expected respondent and
must not bind that child. Binding applies only to forwarded specialist questions;
user-addressed questions retain their user-relay path.

Both canonical attachment fields are arrays of at most 50 string references,
each at most 2,000 characters. They are pointers, not verified content.
`attachments` is not an alias, alone or alongside `context_attachments`.
Old statement/respondent/background/artifact_refs are not ask/answer inputs.
Question/answer text is nonempty, at most 16,000 characters; optional context is
nonempty, at most 8,000; `to_agent` is nonempty, at most 100. Text is trimmed.

Without explicit reference, saved selection supplies association. With neither,
the question belongs only to its asking Session; no Action or selection is created.
Action references require `id=action_id`; node references require matching ID and
kind in that Action. Invalid explicit reference never silently falls back.

Legacy `to_agent` remains an intended label, not a dispatch command or answer
authority. Its answers can come from any calling agent for historical compatibility.
Typed direct agent/role OQs persist the verified native child Session ID as
an append-only SYSTEM binding before prompt admission. Both the exact
Session and agent must match to record an answer. If binding fails, no prompt
is sent. Forwarded specialist OQs require the dispatcher's explicit `bind-respondent`
selection of a verified native child after delegation. Answers require that
exact Session plus matching agent and parent. Another sibling cannot answer. This checks identity, not the validity of the decision or whether an
agent genuinely consulted the user. A parent/General relaying a user decision
must cite the actual user response. Removed Plan nodes retain question threads.

An explicit `session_id` addresses an existing native Session, not an agent name.
The actual calling Session remains the ledger author; it cannot be overridden.
The target is verified in the same project/workspace/canonical directory before
storage and again before dispatch, and becomes the exact authorized respondent.
Live delivery additionally requires native `loom.question.deliver` permission
for resource `session:<destination ID>`, evaluated for the actual calling Session
and agent. OpenCode 2.2.6's stock agent policy contains a wildcard allow, so an
unconfigured host permits peer delivery without prompting. Configure a dedicated
native ASK or DENY rule when that broader grant is unsuitable. Effective native
denial or rejection stores no question and sends no notice. Loom does not offer
a persistent permission grant or imply target-owner consent.
Location, Action association and answer ownership do not grant delivery authority.
The existing model/configuration guard still withholds delivery without requesting
permission and may preserve the exact-addressed question for inbox discovery.
See [delivery authorization](cross-session-delivery-authorization.md) for the
policy, return-notice invitation and native permission configuration.
Unrelated General Sessions may exchange questions without creating a subagent;
the recipient receives a qualified native notice with retrieval instructions,
not an injected answer. The destination may answer even without selecting the
other Action. `action_id` (when supplied) is validated against the shared local
Action store but does not change either Session's selection. Omission retains the
existing focus/reference behavior. Missing, foreign or conflicting destinations
fail before writing; lost native notice admission remains recorded as uncertain,
never as a completed answer.

`loom_record operation=query view=inbox` returns a paginated, Session-bound
list of questions addressed to the actual calling Session across Actions and
Session-only records; `question_state` defaults to `open`, with `answered` and
`all` supported. It does not accept a caller-supplied destination or select
work. This is durable recovery/discovery, not a delivery retry, permission to
read private native Session context or evidence that the Session consumed a
notice. The original `query view=thread` remains authoritative.
The inbox uses an additive partial destination/sequence index and the existing
Action/question answer index. Startup adds the inbox index without converting
tables, rewriting records or changing the database version. Existing historical
schema and row-preservation checks cover this explicit addition.

For new agent/role recipients, exactly one enabled, visible, available,
subagent-capable target must match. Loom invokes OpenCode 2.3.0's native
subagent tool, which enforces its effective depth and permission rules and
selects the specialist or asking Session model. A scoped prompt hook checks
parent and agent and binds the native child before input admission.
With `subagent_depth=0`, OpenCode refuses delegation without creating a child.
On the pinned 2.3.0 host, direct typed OQs return a running child handle for
both blocking and nonblocking requests. Child execution and answer persistence
happen later. The host enqueues a native subagent-completion notice to the
parent, which may trigger another parent model request. Loom does not send a
second answer notice for direct typed OQs. `dispatch.native_status` describes
the native job admission/status, not proof the OQ has been answered.
When the asker is a child, Loom notifies the parent, which answers directly when
the recipient is the dispatcher—even if it consults a specialist. Forwarded
agent/role recipients require the parent to delegate natively and bind the
verified specialist child, respecting OpenCode's depth and permission checks.
Dispatcher targets use that parent; user targets also notify the parent,
which asks the user and cites their actual decision, or require native user
interaction in a primary Session. A failed/missing/ambiguous
target stays recorded without invented receipt. The dispatch result is
a separate SYSTEM record. Native policy failures cannot claim successful
contact. The stored question remains available. Native completion may
wake the parent for either blocking or nonblocking direct OQs, without an
additional Loom-authored answer notification.
Native pre-creation depth/permission denials report `not-attempted` with a
bounded diagnostic; unknown partial results retain `outcome-unknown`.

**Answered means an authorized response was stored (or, for legacy questions,
any response).** It does not mean resolved, approved, independently verified
or permitted to proceed. `dispatch.status:admission-observed` means a native
prompt/notice was durably admitted, not run or consumed. Unknown results are
not retried; partial native side effects cannot be assumed absent.
Blocking is collaboration intent, never a forced wait or execution gate.

## Structured answer formats

Omitted `answer_type` or `text` preserves free-text answers. `multi-choice` stores
2–20 immutable `{id,answer}` choices, requires a typed `recipient` or verified
destination `session_id` (never `to_agent`),
and accepts one `choice_id`, optionally with
`reason`, or `status:"cannot-select"` with a required reason. The original label
is resolved by Loom, not supplied by the respondent. Text and choice forms cannot
be mixed. See [the complete contract](structured-questions.md) for limits and
compatibility. Format never changes recipient routing or decision authority.

A cannot-select response counts as answered, not resolved, and follows the same
first-answer-only continuation. Later conflicting selections remain distinct;
none silently overwrites an earlier reply. Read the full thread before acting.

## One-shot first-answer resume

In one `BEGIN IMMEDIATE` transaction, answer checks for ANY previous answer
and commits the response. Direct typed OQs never submit an additional Loom
answer notice. On OpenCode 2.3.0, native direct subagent execution can return
a running child handle and later deliver a host-owned completion notice that
wakes the parent. `blocking` is stored intent, not a forced wait.
A blocking answer may expose `continuation.owner:native-subagent-execution`,
identifying the native owner, not an extra action.

Only the FIRST committed answer to a blocking legacy v1, forwarded typed v2 or
explicitly Session-addressed v2 question may attempt one best-effort Loom resume of the exact asker.
Later/nonblocking answers do not wake it; legacy delivery stays manual.
Neither native completion nor Loom admission proves answer consumption.
Storage failure sends nothing. No retry, eligibility transfer, recovery replay,
startup/read reconstruction or consumption guarantee exists; a crash after commit
can permanently lose liveness. Do not repeat an answer to try delivery.

The native notice contains IDs and retrieval guidance, not an injected answer
summary. Current target agent/model/permissions stay unchanged. Missing, moved,
inaccessible or unverifiable targets fail visibly without retargeting. The target
check is not an atomic lease. A 5000ms/caller/plugin wait boundary does not cancel
already-started native I/O; a late result cannot update the outcome or cause retry.
Admission is not processing, consumption, delegation or completion.

Eligible answer responses add `resume` containing question/answer/asking-Session
IDs, `status`, `reason`, `attempted`, `qualification`, and
`annotation:{status:"stored",id}` or `{status:"failed",error}`. Status is
`admission-observed`, `failed`, `outcome-unknown` or `not-attempted`. A separate
SYSTEM-attributed linked result stores the outcome where possible. Annotation
failure is response-visible and cannot erase the answer or undo native I/O.
Noneligible answers return the plain record, with no target lookup or annotation.

## Context and full retrieval

`loom_context` and its automatic injection expose `work_ref`, `progress` and
`questions`. Questions cover the Action, selected node, parents/dependencies and
questions addressed to the calling agent in this Action. Answer visibility begins
on the next context refresh or explicit read, not an unsolicited push.

Open questions have a separate bucket: up to six oldest open questions plus two
recently answered threads, ordered by answer time. They do not compete with routine
observations. Progress samples at most 16 nodes. Compact rendering can include fewer
items and source prefixes; `collaboration_has_more` and omission counters expose the
limitation. Removed-task notices retain recovery instructions and fit additional
thread/progress previews only where their budget permits.

Use `loom_record operation: "query"` with these views:

| View | Inputs and result |
| --- | --- |
| `ledger` (default) | Existing raw history, exact `record_id`, `after`/`next_after`; selected-task filtering is unchanged |
| `progress` | Action/node or selection; `offset`/`next_offset`; Action-wide pages cover current nodes, explicit node ID can inspect removed progress |
| `questions` | Explicit or selected Action; optional explicit `node_id`, `respondent`, `question_state: open/answered/all`; `after`/`next_after` |
| `inbox` | Actual calling Session only (no Action selection required); `question_state: open/answered/all`, `after`/`next_after`; includes Action and Session-only questions |
| `thread` | `question_id`; full question and answers; `after`/`next_after` pages answers; optional `action_id` must match |
| `full_thread` | Explicit `action_id` plus optional `node_id` OR `session_id`; optional `cursor`, `limit`; returns `format`, `scope`, escaped `markdown`, `next_cursor` |

New views default to 20 items and cap at 50. `questions` defaults to open and does
not inherit a selected-task filter. `session_only` remains a **ledger-only** option.
Thread queries need no selected work. Read full threads before decisions that depend
on qualifications or conflicting answers. Full records are subject to existing read
limits; failures preserve history, not necessarily its availability through these tools.

These combined views use one read snapshot, not a lease against future edits or a
snapshot across separate pages. Collaboration body transfers have a shared 4 MiB
allowance per view/context addition, in addition to the original context allowance;
fingerprinting has its own bounded shared allowance. Output remains within configured
context size. Questions may still require scanning answered question history; added
indexes, total storage growth and whole-process resource use are not capacity guarantees.

## Full stored relational history

`full_thread` is an existing record-query view, not a sixth tool. It never infers
scope from selection and rejects mixed scopes or ledger-only options. It reads
only the current authorized location's Loom Store, not native Session bodies or
cross-project databases. Session membership comes from authored records and
direct question/answer relationships, including later authors' answers. Notice
destinations, admission, assignments and agent-name equality do not establish
receipt or membership. A fail-closed ask never invents recipient receipt.

Output is `format:"loom-full-thread/v1"`, `scope`, `markdown`, `next_cursor`.
Records are deduplicated and sequence-ordered. Escaped JSON in Markdown carries
full stored content, actual authors/Sessions/times, IDs, links, verdicts,
attachment/evidence references, useful observation metadata and historical
Plan/work_ref qualifications. It does not recursively expand evidence or invent
unavailable raw observation bodies. Legacy records are labelled retired/inert.

Follow `next_cursor` as `cursor` with the same explicit scope until null. Default
limit 20, max 50. Labelled parts contain at most 8192 UTF-16 representation units
(without splitting surrogate pairs), repeat identity and only advance the record
on its final part. A partial record ends the page even below the record limit.
Concatenate representation parts, not repeated headings, for complete JSON.
Scope/location/version-bound cursors are opaque, not perpetual or a frozen
concurrent snapshot. Corrupt/unsupported data fails without advancing; existing
per-record/read/serialized-response limits remain. Smaller pages can help an
aggregate limit, not an individually inadmissible record. Preserve originals;
do not raise limits, delete history or perform destructive repair to fake completeness.

## Verification and remaining acceptance

Core tests exercise the agreed flow through real SQLite, including a reopened
connection and new Session. Registered-plugin tests exercise real callbacks and
context hooks using a simulated host. Existing pinned Code Mode tests verify that
search returns complete registered help and signatures, now including these operations.
The record manual has a 10,000-character metadata ceiling; other tools retain 3,600.

Historical native comparison/trial results in [operating policy](operating-policy.md)
retain their original scope. They do not prove the replacement's installed path.
Current acceptance must identify the assembled artifact and exercise real registered
tools, exact-asker native authority and populated historical traversal. Component
tests and simulated native boundaries are not installed acceptance. Wider E limits,
manual offline backup safety and draft status remain; no activation, paid inference,
dashboard or scheduling authority is implied.
