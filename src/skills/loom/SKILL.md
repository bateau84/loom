# Loom usage guide

Use this guide when coordinating or resuming work through Loom. It
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
| `loom_record` | Store or query claims, results, Assessment/QA, completion/reopening, questions, answers and full stored history. Stored records are not proof of delivery or acceptance. |

Use tool search for the installed tool's complete schema, operation help and
examples. Treat those live descriptions as the input reference, not remembered
syntax from older Loom versions. The plugin still has exactly these five tools.
Tool responses contain JSON with `result` and sometimes `config_errors`. Check
outcomes before using IDs or claiming success. Await writes before using returned
IDs or ending Code Mode. Sequence dependent calls; for independent concurrent
calls, use Promise.allSettled and inspect every outcome.

## Start or resume work

Use `loom_agents` with `{}` for the real roster, not assumed role-name IDs.
Load applicable external skills natively.

For existing work, recover its actual Action ID from the handoff or `loom_action`
list. Do not create a duplicate merely because this Session has no selection.
For new work worth retaining, create a goal:

```json
{"operation":"create","title":"Explain a setting","goal":"Produce a source-backed explanation with its limitations."}
```

Replace placeholders with actual returned IDs; `result.id` is the Action ID.

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

Retain `work_ref`, the definition actually worked against. Give native delegates
the Action/task IDs, goal, constraints, record IDs and original reference.
Each child selects its own work; selection is not inherited.

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

Use `add`: `result` describes actual work; `claim` states a supported conclusion
and uncertainty. Include checks, sources and untested limits, not activity logs.
`evidence_ids` must be real host observation IDs from the same Action, not invented
IDs or other conclusion records. Omit unavailable evidence and explain the gap.
Artifact references are pointers, not proof that Loom read or verified them.

Observations store identity/digests, not raw arguments/output. Missing/unpaired
observations prove neither success nor failure. `session_only:true` reads Session
ledger history without selection; it cannot combine with work IDs.
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
independent acceptance. Assessment/QA verdicts are `pass`, `fail`, `inconclusive`.
Use independent reviewers where required and external ASSESSMENT.md / QA.md
companions; a stored PASS does not prove independence or Action-wide success.

`reopen` appends a reason without erasing history or undoing native side effects.
Update Action state separately; paused/cancelled labels do not stop execution.

## Questions and manual native handling

Ask with `question`, `to_agent` and an explicit Boolean `blocking`. Optional
fields are `context`, `context_attachments` (string references) and
`reference:{action_id,kind:action|phase|wave|task|subtask,id}`. Without a reference,
selection supplies association; without either, the question belongs to the
asking Session only. No Action, Plan or assignment is required. Invalid explicit
references never fall back: Action IDs must match; node ID and kind must match.

```json
{"operation":"ask","question":"Which limit applies here?","to_agent":"research","blocking":false,"context_attachments":["SOURCE_REFERENCE"]}
```

The question is saved, but the recipient is NOT contacted on pinned OpenCode
2.0.29. Inspect `dispatch:{status:not-attempted,reason:policy-capability-unavailable}`.
Arrange manual native handling outside ask. If manual handling has been arranged,
a blocking asker may naturally yield. Blocking is collaboration intent, not an
enforced wait, approval grant or gate; nonblocking work can continue.

Answer with `question_id`, `answer` and optional `context_attachments`. Actual
author and Session derive from the caller. Answers inherit the question's original
nullable association, even after node removal, without selecting the asker's work.
Multiple/conflicting answers remain stored. `attachments` is not an alias, alone
or with the canonical field; old statement/respondent/background/artifact_refs
are not ask/answer inputs.

```json
{"operation":"answer","question_id":"QUESTION_ID","answer":"Read the source and its limitations.","context_attachments":["SOURCE_REFERENCE"]}
```

Only the FIRST committed answer to a new-format blocking question qualifies for
one immediate postcommit best-effort resume of the exact stored asking Session.
Later, nonblocking and legacy answers never submit asker input. Missing, moved or
inaccessible targets fail visibly without retargeting. Current native target
agent/model/permissions remain unchanged. Target validation is not an atomic lease.
The 5000ms deadline bounds waiting, not cancellation of already-started native I/O.
Admission is not processing, consumption or completion; timeout can leave an
unknown outcome. No retries, transfer, recovery replay or reconstruction on reads
or restart: a crash after answer commit may permanently lose resume. Do not repeat an
answer to try delivery.

The answer remains durable separately from transport. Eligible responses include
`resume` with source IDs, `status`, `reason`, `attempted`, `qualification` and
`annotation`. Status is `admission-observed`, `failed`, `outcome-unknown` or
`not-attempted`. A separate SYSTEM result annotation links the IDs and outcome;
annotation failure is visible and cannot erase the answer or undo native I/O.
Retrieve the authoritative paginated `view:thread` before using a notice. Answered
means response, not resolution, approval or permission.

General assignment/delivery operations AND views are retired. Historical records
remain readable and inert, not current consent. No startup sender or retry engine
exists. Completion/reopen semantics above are unchanged.

## Complete stored history

```json
{"operation":"query","view":"full_thread","action_id":"ACTION_ID","node_id":"TASK_ID","limit":20}
```

Alternatively supply explicit `session_id`, never combined with Action/node.
This view does not inherit selection. It reads only the current authorized Loom
Store, not native Session bodies or cross-project databases. Session membership
comes from authored records and direct question/answer relationships, including
later answers; notice destinations, admission, assignments and agent-name equality
do not create membership. Fail-closed ask does not invent recipient receipt.

The result contains `format:loom-full-thread/v1`, `scope`, `markdown`, `next_cursor`.
Follow `next_cursor` as `cursor` with the SAME explicit scope until null. Default
limit is 20, maximum 50. Stored records are deduplicated and ordered by sequence.
Escaped Markdown includes full stored content, actual authors/Sessions/times,
IDs, links, verdicts, observation metadata and historical Plan/work_ref information.
References are not recursively expanded; unavailable raw tool bodies are never
invented. Labelled oversized-record parts repeat identity and advance the record
only on its final part. A page below limit may still be incomplete. Cursors are
scope/location/version-bound, not a perpetual or concurrent-snapshot guarantee.
Corrupt/unsupported data fails without advancing; existing read limits still
apply. Smaller pages do not make an individually inadmissible record readable.

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
Role/context injection is optional; tools and this guide remain usable without
it. Respect native denials. Hand off results, IDs, remaining work and test limits,
not unsupported delivery/readiness claims.
