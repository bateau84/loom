# Loom usage guide

Use for Loom coordination/resumption. Load engineering skills separately.

## Keep Loom optional

A conversation needs no Action. An Action needs no Plan. Use only structure
that helps recover useful work. OpenCode owns Sessions, execution, delegation,
skills, models and permissions. Loom records intent, context and history; it is
not a scheduler. Do not invent mandatory stages or legacy tools. Role checks
restrict only the companion loaders, not native execution.

## Find the right tool

| Tool | Purpose and boundary |
| --- | --- |
| `loom_agents` | Native IDs, roles and diagnostics; no permission grants. |
| `loom_action` | Goals and read-only Session inventory. Creation selects; state labels do not stop execution or certify success. |
| `loom_plan` | Read/replace optional nodes; no dispatch or skill loading. |
| `loom_context` | Read/select work. Fresh Sessions start unselected. |
| `loom_record` | Store/query concerns, claims, results, reviews, progress, questions and history. |
| `loom_assessment` | Load ASSESSMENT.md; requires configured assessment role. |
| `loom_qa` | Load QA.md; requires configured qa role. |

Tool search supplies schemas/help. Tools return JSON with `result` and optional
`config_errors`. Await writes before using IDs or ending Code Mode. Sequence
dependent calls; use Promise.allSettled for independent calls and inspect outcomes.

## Start or resume work

Use `loom_agents {}`: match `agents[].roles` to `role_descriptions`.
Check `available`/`enabled`; delegate natively.

For existing work, recover its Action ID from the handoff or `loom_action`
list; an unselected Session is not a reason to duplicate it.
For new work worth retaining, create a goal:

```json
{"operation":"create","title":"Explain a setting","goal":"Produce a source-backed explanation with its limitations."}
```

Replace placeholders with returned IDs; `result.id` is the Action ID.
Use `loom_action` operation `sessions` for local Sessions, optionally filtered
by `action_id`. Follow `next_cursor`. Archive state is read-only;
no execution or delivery is proven.

Read the current optional Plan before changing it:

```json
{"operation":"read","action_id":"ACTION_ID"}
```

A Plan is intended work, not an activity log. Nodes have `id`, `kind` and `title`;
optional fields are `outcome`, `criteria`, `context`, `depends_on`, `parent`,
`agent`, `roles` and `skills`. Kinds are phase, wave, task and subtask.
Hierarchy is optional. Siblings do not implicitly depend on each other.
`depends_on` helps select relevant context; it does not enforce execution.

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

A record ID may inherit a task filter; empty results prove no absence.
Follow ledger `next_after` as `after` until null; Action lists use `next_offset`.
Read exact records for full statements. `contract_match:null` means unknown;
matching work definitions do not prove code correctness.

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

## Preserve and route concerns

Every agent records its own task-related concerns with `add`, `kind:concern`,
`statement`, not only handoffs. Existing scope/evidence rules apply; no task or
verdict required. Distinguish suspected from confirmed; state support or unknowns.
Documented, outside-task or handed-off is not resolved.

General routes blockers natively; critic consolidates patterns. These are duties,
not native IDs: use the roster (coordination/qa guidance respectively).
Cite sources in later result/claim/assessment text: `Suspected: Action ACTION_ID
record CONCERN_ID; confirmed: Action ACTION_ID record OTHER_ID; not resolved.`
Retrieve each with explicit `action_id` plus `record_id`, no `node_id`, as above.
Concern IDs are not observation `evidence_ids`. Append commentary; originals and
origin stay unchanged. Context is sampled, full history paged. No lifecycle,
structured links, automatic escalation or gates.

## Complete, review and reopen honestly

Report completion with `loom_record complete`, the original `work_ref`, and the
actual outcome. Do not fetch a newer reference to make old work look current.
A `result` alone is not completion. Query `view:progress` for reported progress
and contract matching. Changed contracts may need fresh work or reconfirmation;
unrelated replanning does not erase history.

Completion does not complete parents or the Action and does not establish
independent acceptance. Assessment/QA verdicts are `pass`, `fail`, `inconclusive`.
Choose relevant skills independently of the producer's list. Call
`loom_assessment {"skill":"SKILL_ID"}` for ASSESSMENT.md or `loom_qa` for QA.md.
The enabled caller needs the corresponding configured role and native skill
permission; no Action, Plan or prior load receipt is required. Load practitioner
guidance natively when useful. Missing companions return `available:false`, not
SKILL.md. Loading a lens or storing PASS does not prove independent review or
Action-wide success. Record actual findings separately with `loom_record`.

`reopen` appends a reason without erasing history or undoing native side effects.
Update Action state separately; paused/cancelled labels do not stop execution.

## Questions and manual native handling

Ask with `question`, `to_agent`, explicit Boolean `blocking`; optional `context`,
`context_attachments` (references), `reference:{action_id,kind:action|phase|wave|task|subtask,id}`.
Association defaults to selection, otherwise asking Session only; no Action/Plan
required. Invalid explicit references never fall back: Action/node IDs and kind
must match.

```json
{"operation":"ask","question":"Which limit applies here?","to_agent":"research","blocking":false,"context_attachments":["SOURCE_REFERENCE"]}
```

On pinned OpenCode 2.1.1 the question is saved, but the recipient is NOT contacted.
Inspect `dispatch:{status:not-attempted,reason:policy-capability-unavailable}`.
Arrange manual handling outside ask; a blocking asker may yield after it is
arranged. Blocking is intent, not a wait, approval or gate; nonblocking work continues.

Answer with `question_id`, `answer`, optional `context_attachments`. Caller supplies
actual author/Session. Original nullable association survives node removal without
selecting asker's work. Conflicting answers remain. `attachments` is never an alias;
old statement/respondent/background/artifact_refs are not ask/answer inputs.

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

Assignment/delivery operations AND views are retired. Historical records stay
readable/inert, not current consent. No startup sender or retry engine exists.

## Complete stored history

```json
{"operation":"query","view":"full_thread","action_id":"ACTION_ID","node_id":"TASK_ID","limit":20}
```

Alternatively use explicit `session_id`, never with Action/node. No inherited
selection. Reads current authorized Loom Store only, not native Session bodies or
cross-project databases. Membership follows authorship/direct question-answer
relations (including later answers), not notices, admission, assignments or agent
names. Fail-closed ask does not invent receipt.

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
