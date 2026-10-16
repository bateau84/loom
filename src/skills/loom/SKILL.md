# Loom usage guide

Use this guide when coordinating or resuming work through the Loom plugin. It
teaches Loom, not general coding, Git, testing or agent design. Load applicable
external engineering skills separately, using OpenCode's native skill tool.

## Keep Loom optional

A conversation needs no Action. An Action needs no Plan. Use the smallest amount
of structure that helps another agent or a later Session recover useful work.
OpenCode owns Sessions, execution, native delegation, skill loading, models and
permissions. Loom records intent, context and history; it is not a scheduler or
an execution/permission gate. Do not invent mandatory stages or legacy tools.

## Find the right tool

| Tool | Purpose and boundary |
| --- | --- |
| `loom_agents` | Discover existing agent IDs, configured roles and diagnostics. It does not create agents or grant permissions. |
| `loom_action` | List, create or update a goal. Creation selects it for this Session. State labels do not interrupt Sessions or certify success. |
| `loom_plan` | Read or replace an optional flat list of nodes. Saving does not dispatch work or load the listed skills. |
| `loom_context` | Read selected work, or explicitly select an Action/task and retrieve context. A fresh Session starts unselected. |
| `loom_record` | Store or query claims, results, Assessment/QA, completion/reopening, questions, answers and assignment/delivery records. Stored records are not proof of delivery or acceptance. |

Use tool search for the installed tool's complete schema, operation help and
examples. Treat those live descriptions as the input reference, not remembered
syntax from older Loom versions. The plugin still has exactly these five tools.
Tool responses contain JSON with `result` and sometimes `config_errors`. Check
outcomes before using IDs or claiming success. Await writes before using returned
IDs or ending Code Mode. Sequence dependent calls; for independent concurrent
calls, use Promise.allSettled and inspect every outcome.

## Start or resume work

First use `loom_agents` with `{}` to discover the real roster. Role names such as
Research, Worker, Reviewer or Critic are responsibilities, not guaranteed agent
IDs. Select agents from the returned roster and load their applicable external
skills through native OpenCode mechanisms.

For existing work, recover its actual Action ID from the handoff or `loom_action`
list. Do not create a duplicate merely because this Session has no selection.
For new work worth retaining, create a goal:

```json
{"operation":"create","title":"Explain a setting","goal":"Produce a source-backed explanation with its limitations."}
```

Keep the returned `result.id`. In the following examples replace `ACTION_ID`
with that real ID. Other placeholders must also come from actual tool results.

Read the current optional Plan before changing it:

```json
{"operation":"read","action_id":"ACTION_ID"}
```

A Plan is the intended work, not an activity log. Nodes have `id`, `kind` and
`title`; optional fields are `outcome`, `criteria`, `context`, `depends_on`,
`parent`, `agent`, `roles` and `skills`. Kinds are phase, wave, task and subtask.
Use hierarchy only when helpful. Siblings do not implicitly depend on each other.
`depends_on` also helps select relevant context; it does not enforce execution.

Save the complete node list using the returned Plan revision as
`expected_revision`. Preserve unchanged IDs. Revision 0 is only for an unsaved
Plan. Action updates require the Action's separate current revision. On a
conflict, reread and reconcile; do not blindly overwrite or borrow a revision.

Explicitly select the work before performing it:

```json
{"action_id":"ACTION_ID","node_id":"TASK_ID"}
```

Retain the returned `work_ref`: it identifies the definition actually worked
against. Give native delegates the Action/task IDs, goal, constraints, relevant
record IDs and original work reference. A child must select its own work; do not
assume it inherits its parent's selection. Keep handoffs short and retrieve the
full referenced records instead of copying entire conversations.

## Read evidence before using conclusions

Context is bounded and may contain excerpts. Read full material records before
using their conclusions, especially their conditions, uncertainty and failures.
To retrieve a dependency record, name the Action without a node filter:

```json
{"operation":"query","action_id":"ACTION_ID","record_id":"RECORD_ID"}
```

A record ID alone may inherit the selected task filter and return no match.
Empty filtered results do not prove the record never existed. Follow ledger
`next_after` as `after`, stopping at null. Action lists use `next_offset`.
Use exact record reads for full statements within the tool's read limits.
`contract_match` is about the saved work definition, not code freshness;
`contract_match:null` means unknown, not success.

Record useful findings with `loom_record` operation `add`: `result` describes
work performed; `claim` states a conclusion with its support and uncertainty.
State what was actually checked, what was found, relevant artifact references
and what remains untested. Do not log every thought or repeat the Plan.
`evidence_ids` must be real host observation IDs from the same Action, not invented
IDs or other conclusion records. Omit unavailable evidence and explain the gap.
Artifact references are pointers, not proof that Loom read or verified them.

Host start/finish observations contain identity references and digests, not raw
arguments/output. Missing or unpaired observations prove neither success nor
failure. For unpaired Session history without changing selection, query with
`session_only:true`; this query option cannot be combined with work IDs.
Never put credentials or other secrets in records or artifact references:
explicitly recorded text is not redacted.

## Complete, review and reopen honestly

Report task completion with `loom_record` operation `complete`, the original
`work_ref`, and a statement describing the actual outcome. Do not fetch a newer
reference just to make an old result look current. A `result` alone is not a
completion report. Read `query` with `view:progress` to inspect reported progress
and whether it still matches current work. Changed contracts may require fresh
work or reconfirmation; unrelated replanning must not be treated as lost history.

Completion does not complete parents or the Action and does not establish
independent acceptance. Assessment and QA are separate review records with
`pass`, `fail` or `inconclusive` verdicts. Use independent reviewers when required
by the task, and the relevant external ASSESSMENT.md or QA.md companions. Writing
a review record does not prove independence. Do not convert a stored PASS into
an Action-wide success claim or force every conversation through fixed gates.

Use `reopen` with a reason when work must be revisited. Preserve the earlier
records; do not erase evidence or claim that reopening undid native side effects.
Update the Action state separately and only when justified by the overall goal.
Paused/cancelled Action labels do not stop OpenCode execution.

## Questions, assignments and opt-in continuation

Use `ask` for a scoped question with enough background and an intended respondent;
use `answer` with the actual `question_id`. Retrieve the authoritative thread with
`query` and `view:thread`. An answer is a response, not resolution, approval or
permission. Check it against the question and its qualifications before continuing.

`assign` binds a stable
`assignment_id`, the calling primary, an existing native child Worker Session in
the same Loom location, and the original `work_ref`. Repeating identical
registration returns the same record; do not reuse a handle for different work.
An optional `question_id` can link a matching unanswered question; it cannot
retroactively create delivery intent for an already committed answer.

Assigned questions and completion may name `assignment_id`. Answering an assigned
question atomically saves the answer and primary-addressed intent. Default sends
none. Under user-authorized coordination only, the exact primary may opt in with
`{operation:"authorize-continuation",assignment_id,continuation:"primary-native/v1"}`.
One prospective authorization permits only FUTURE intents; historical false or
missing consent remains unsendable, including on upgrade/config/skill changes.
Authorization itself sends nothing. Historical storage-only intents remain
transport:not-attempted. No new tool or permission gate is added.

`withdraw-continuation` requires assignment_id and statement from that primary.
It is irreversible, including before authorization. It suppresses pending sends,
retains history and does not stop native work/retract input. Before send-started
it fences I/O; afterward input may still admit despite best-effort checking.
Native Stop/disconnect/Action labels are not this operation.

Save and transport outcomes are separate. Do not repeat an
answer to try delivery.
The primary uses `retry-delivery` with an EXISTING delivery_id. Preflight failure
can be explicitly retried after correcting the exact destination. Once marked
send-started, Loom never calls synthetic again: lost ACK/crash reconciliation
requires positive ACK/live-enqueued/context-promoted evidence. Missing/pending/
compacted context or read errors stay admission-uncertain. Even a crash between
marker and call may remain uncertain; no eventual-delivery promise is made.
Admission does not prove model processing, delegation or completion.

`query` views `assignments` and `deliveries` are selection-independent bounded
Session-wide reads, not sending. They expose continuation and delivery_status.
Exact delivery_id also returns attempt history with attempt_after/attempt_limit
(default 0/20, max 50), separate from base intent after/limit. Follow next_after.
Only a new authorized answer, one <=20-intent startup batch or explicit retry is
a sending/reconciliation opportunity; no timer or general notification engine.

A native primary notice identifies records, not an answer summary. Read the exact
association/delivery and FULL paginated question thread, including qualifications
and conflicts. Check withdrawal and whether work already runs/completed; recheck
withdrawal before native delegation to the SAME Worker Session/original work_ref.
Loom never sends directly to Worker or nudges completion. OpenCode owns that call's
execution/return; retrieve the exact explicit completion/results before the next
coordinating action. A native run ending is not assignment completion. Plan saves,
ordinary answers and completion reports do not inherently wake another agent.

## Recover without guessing

When a task is removed, inspect the returned recovery information, current Plan
and retained history. Explicitly select a current task, select Action-only context
or call `loom_context` with `{"clear":true}`. Do not infer a replacement task from
a similar title. `loom_context` with `{}` reads this Session's existing selection.

Successful context reads survive a selection-save failure: inspect the separate
`selection.status:"save-failed"` outcome. `persisted` is the saved reference,
null if absent, or "unknown" if readback failed; it is not the unsaved request.
Later automatic context follows persisted selection. Do not assume the
selection changed after an error, or that a failed clear succeeded: clear still
fails on a write error. Unreadable context still fails, not a missing-task notice.
Explicit Plan and ledger queries are alternative reads that do not save selection.
Role/context injection is optional `.loom.yaml` behavior; tools and this skill
remain usable without it. Respect native permission denials rather than bypassing
them. End handoffs with actual results, record IDs, remaining work and honest
verification limits, not unsupported claims of delivery or readiness.
