# Assignment association and stored answer-delivery intent

This implements the **storage-only first slice** of the
[primary-first coordination candidate](coordination.md). It does not implement
native sending, automatic context presentation, retries, cancellation of future
continuation, or native re-delegation integration. No Session is woken by this code.
The reviewed `c2db6e7` experiment remains separate feasibility evidence.

## Register exact work, not a permanent native owner

The original primary calls the existing `loom_record` tool with `operation=assign`:

```json
{
  "operation": "assign",
  "assignment_id": "guide-worker-1",
  "worker_session_id": "WORKER_SESSION_ID",
  "question_id": "QUESTION_ID",
  "work_ref": {
    "action_id": "ACTION_ID",
    "node_id": "work",
    "action_revision": 1,
    "plan_revision": 1,
    "hash": "REPLACE_ENTIRE_WORK_REF_FROM_WORKED_CONTEXT"
  }
}
```

Replace the whole `work_ref` with the reference actually used for the work. This
is not a valid example hash. The primary is always the calling Session, never a
supplied label or the Action creator. The plugin checks that Worker is an existing
native child of that primary in the same project, directory and workspace. The
check is a current host lookup, not a lease preventing later deletion or movement,
and not proof that a particular native call performed this assignment.

`assignment_id` is a caller-chosen, project-unique stable handle, subject to Loom's
ordinary identifier limit. `result.id` is the assignment's separate ledger record
ID; `result.data.assignment_id` is the handle used on later operations. Retrying an
identical registration returns the original record. Changing the primary, Worker,
reference or initial question under the same handle fails without retargeting it.
A genuinely separate assignment needs another handle. No edit/reroute operation
is provided in this slice.

`question_id` is optional. It handles the common order where Worker asks before
its native delegation returns its Session ID to primary. It must identify an
unanswered question from that exact Worker, Action/node and original reference.
Registration adds the association without rewriting the question. A question can
have only one such link. If an answer committed first, registration fails clearly:
no retroactive delivery intent is manufactured. Identical retries of an already
saved registration remain possible after the question is answered, provided the
native child lookup still succeeds.

New registration validates the historical Action and Plan definition using the
same bounded work-reference verification as completion. Named reference fields
are compared without JSON property-order dependence. Original revisions remain
traceable. Unrelated replanning does not rewrite them. Removed work can retain or
receive a historical association while its required original definition exists.

This is optional coordination data, not a permission or attachment gate. Normal
unassigned work and all existing tools remain usable. No native-owner bit, run
state, cancellation inference or completed-to-parent cascade is added.

## Associate subsequent questions and completion

Worker may supply `assignment_id` on `ask` and `complete`. Only the registered
Worker Session can bind those records to that assignment. An assigned question
uses the assignment's original scope and reference without reading selection or
the latest Plan. Explicit Action/node inputs, if supplied, must agree.

```json
{"operation":"ask","assignment_id":"guide-worker-1","respondent":"research","statement":"Does the qualification apply to empty files?"}
```

Completion still requires the exact retained `work_ref` and a truthful statement;
it never borrows a newer reference. It records `assignment_id` but creates **no
completion notification**. Native delegation remains the candidate completion
return path. Assessment and QA remain separate from a performing agent's report.

A reused Worker Session, matching task ID or an expertise label never implicitly
selects an assignment. Questions without an assignment remain ordinary questions.
`respondent` still names intended expertise, not a running destination Session.

## Save the answer and its intent together

Research answers through the existing `answer` operation. It does not supply the
route or need a working selection. For an assigned question, the transaction
appends both the answer and a `delivery-intent` ledger record. A refused answer,
intent insert or pre-commit failure rolls back the pair. Concurrent association
and answer writes are serialized: there is no silent association-after-answer
backfill. Host I/O is not performed inside this transaction or afterward.

The answer result preserves the existing `result.id`, scope, author and data.
It additionally returns response-only `result.delivery`:

| Field | Meaning in this slice |
| --- | --- |
| `state: stored-for-session` | The intent is durably available to the named primary |
| `intent_id` | Exact delivery-intent ledger record ID |
| `destination_session_id` | Primary retained by the assignment |
| `transport: not-attempted` | No native send was made |
| `reason: transport-not-implemented` | Sending is unavailable, not a failed answer save |

An unassigned question returns `state: not-requested` and
`reason: question-not-assigned`, also with `transport: not-attempted`.
The response-only delivery object is not written into the authoritative answer.

Every intent binds its ID to one source answer, question, assignment, destination
and complete structured payload. The payload carries IDs, the retained reference,
Worker Session and exact thread query, not a shortened answer. Read the original
thread for sources, qualifications and conflicting answers. A removed/offline
primary does not prevent storing the answer; this slice does not test destination
liveness or guess a replacement. Recorded intents remain available in history.

There are no attempt records because there are no sends. `stored-for-session`
is not native admission, presentation, understanding, resolution or a continuation
receipt. All stored associations/intents set `automatic_continuation: false`.
A future sender must not treat these historical records as permission to wake
Sessions merely because the plugin was upgraded or a setting changed.

Separate `answer` calls still create separate answer records and intents. This
slice does not add answer-request idempotency. Do not repeat an answer to try to
send it. Uncertain native admission, safe retries and replay remain later work.

## Selection-independent discovery

```json
{"operation":"query","view":"assignments","limit":20}
```

Returns associations where the calling Session is primary or Worker. Supply
`assignment_id` for one exact handle. This includes historical assignments, not
an inferred active-work roster.

```json
{"operation":"query","view":"deliveries","limit":20}
```

Returns full stored intents addressed to the calling Session, across Actions.
Supply `delivery_id` for one exact intent. Both views return `items` and
`next_after`; pass it as `after` until null. The default limit is 20, maximum 50.
Do not supply Action/task filters or `session_only`; these views are Session-wide
by definition. Neither view consults or changes selection, including absent,
unrelated or corrupt selection and unreadable current Action/Plan data.

These are explicit tool reads, **not automatic presentation in `loom_context`**.
Full ledger history remains available by explicit Action and record ID to a fresh
Session, within normal read limits. Session filtering is navigation, not a privacy
boundary against other same-project or same-user access.

Five additive partial indexes support unique handles/question bindings and ordered
primary/Worker/destination reads. Queries select bounded metadata before loading
record bodies under the existing 4 MiB and per-record allowances. Snapshot reads
are not leases across separate pages. Index construction, total history growth and
whole-process resources remain unqualified; E is not closed. No table is dropped,
record rewritten, history deleted or ledger automatically rotated.

Do not mix older plugin writers with these assigned records: older versions do
not know they must append an intent with an assigned answer. Drain/restart all
instances using this project database when adopting the feature. This is not an
old-writer compatibility or retroactive history-repair guarantee.

## Verification boundary

Core tests cover historical identity, field order, two primaries/reused Workers,
pre-existing questions, unique bindings, failed inserts/commit, concurrent SQLite
connections, unchanged source records, bounded paging and reopening persisted
state. Plugin tests check native child/location validation, cancelled lookup,
selection-independent access, search-visible help and the absence of send APIs.

Those tests are not acceptance of a native sender, unknown-admission recovery,
real user-stop handling, automatic question delivery, repeated background runs or
live-model usefulness. The existing host comparison still uses its test adapter;
it does not become a production-routing test by running on this newer commit.
The successful-context/failed-selection correction, manual backup/restore and
overall alpha readiness remain separate. Keep PR #180 draft and unmerged.

The new operations are documented directly in registered tool-search help. The
record manual's metadata ceiling is now 8,000 characters; other manuals retain
3,600 and summaries 120. These are description conventions, not model-token or
whole-process budgets. The compact catalog still uses the short summary.
