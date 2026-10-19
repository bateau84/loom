# Reported progress and contextual questions

The Plan describes intent. The ledger stores completion reports, reopen events,
questions and answers. The five tool names remain unchanged. The current production
implementation has no scheduler, approval grant or automatic parent completion.
Blocking is stored collaboration intent, not a workflow gate or forced wait.

## Current collaboration boundary

Questions and answers are durable and attributed to the actual calling agent and
Session. No Action, Plan or assignment is required. Recipient dispatch is
fail-closed on the supported OpenCode 2.0.32 host; manual native handling is
required. Installed-host boot evidence is separate from installed-question
qualification.
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

- `ask`: required `question`, `to_agent`, explicit Boolean `blocking`; optional
  `context`, `context_attachments`, `reference:{action_id,kind,id}`. Reference kinds
  are action, phase, wave, task, subtask. The returned record ID is the question ID.
- `answer`: required `question_id`, `answer`; optional `context_attachments`.
  The original question supplies its nullable Action/node association.

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

`to_agent` is an intended native agent ID or user label, not a dispatch command
or an authority restriction. Answers record the actual calling agent and Session.
A different agent may respond without impersonating the intended respondent.
Research can answer a Worker's question without selecting the Worker's task, even
when Research has an unrelated or unreadable selection. Removed tasks retain their
threads and can receive answers. Sources, background and qualifications remain in
the full ledger records; multiple or conflicting responses are not overwritten.

**Answered means at least one response exists.** It does not mean resolved,
approved, independently verified or permitted to proceed. Use native delegation or
user interaction to bring a respondent in. Ask returns
`dispatch:{status:"not-attempted",reason:"policy-capability-unavailable"}`:
the recipient is NOT contacted. There is no permission prompt, child creation,
native executor or policy probe inside ask. If manual handling has been arranged,
a blocking asker may naturally yield; this does not force a wait.

## One-shot first-answer resume

In one `BEGIN IMMEDIATE` transaction, answer validates the question, checks for
ANY committed answer and appends/commits the response. Only the FIRST committed
answer to a new-format blocking question receives immediate in-memory eligibility
for one postcommit best-effort resume of the exact stored asking Session.
Later, nonblocking and legacy answers never submit input or wake the asker.
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
