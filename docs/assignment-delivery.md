# Assignment association and opt-in answer-to-primary delivery

The accepted `3f08da9` storage slice is retained, with a bounded **explicitly
opt-in sender**. Default coordination remains off. Historical intents remain
stored-only forever, including after upgrade or later authorization. Native
execution and completion return belong to OpenCode, not a Loom Worker runner.
The reviewed `c2db6e7` experiment remains separate feasibility evidence; current
qualification uses the production sender, not its test bridge.

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
backfill. Host I/O is not performed inside this transaction. Only a newly
authorized intent receives a post-commit sending opportunity.

The answer result preserves the existing `result.id`, scope, author and data.
It additionally returns response-only `result.delivery`:

| Field | Meaning in this slice |
| --- | --- |
| `state: stored-for-session` | The intent is durably available to the named primary |
| `intent_id` | Exact delivery-intent ledger record ID |
| `destination_session_id` | Primary retained by the assignment |
| `transport: not-attempted` | No native send was made |
| `reason: automatic-continuation-not-authorized` | Default stored-only save, not consent or a failed answer save |

An unassigned question returns `state: not-requested` and
`reason: question-not-assigned`, also with `transport: not-attempted`.
The response-only delivery object is not written into the authoritative answer.

Every intent binds its ID to one source answer, question, assignment, destination
and complete structured payload. The payload carries IDs, the retained reference,
Worker Session and exact thread query, not a shortened answer. Read the original
thread for sources, qualifications and conflicting answers. A removed/offline
primary does not prevent storing the answer; this slice does not test destination
liveness or guess a replacement. Recorded intents remain available in history.

`stored-for-session` is not native admission, presentation, understanding,
resolution or completion. Assignment records retain `automatic_continuation:false`.
Only future intents produced after an explicit supported authorization set it to
true, with that authorization ID and `sender_policy:loom-primary-native-sender/v1`.
Missing/false bits, unknown versions and inconsistent links never authorize I/O.
Historical raw intent bytes are never changed into consent.

Separate `answer` calls still create separate answer records and intents. This
slice does not add answer-request idempotency. Do not repeat an answer to try to
send it. Use the existing intent ID to inspect/reconcile sending instead.

## Prospective authorization and irreversible withdrawal

Only the exact saved primary Session may call these selection-independent operations:

```json
{"operation":"authorize-continuation","assignment_id":"guide-worker-1","continuation":"primary-native/v1"}
{"operation":"withdraw-continuation","assignment_id":"guide-worker-1","statement":"Do not automatically continue this assignment."}
```

The literal `continuation` is required. Authorization is one immutable prospective
record per assignment, not a per-answer approval gate. Identical retries return
the original record. It sends no old intent. Configuration, roles, skill changes,
and upgrade are never authorization. IDs use the existing simple 1–120 character
syntax; withdrawal statement is nonblank, at most 16,000 characters. Irrelevant
fields fail rather than silently changing the operation's meaning.

Withdrawal records an irreversible tombstone, even before authorization. The first
reason is retained. There is no re-enable operation; genuinely new work needs a
new assignment handle. `continuation` in write/assignment-read responses reports
off/authorized/withdrawn plus authorization/mode/withdrawal IDs when present.
Withdrawal also reports delivery disposition counts: admitted, possibly_admitted,
suppressed_before_send. Questions, answers, attempts and explicit completion remain.

If withdrawal commits before send-started, no native call is permitted. After
that marker, input may still be admitted: the final check is best-effort, not an
atomic transaction with the host. Withdrawal does **not** retract queued input,
stop native work, or undo a Worker call. Native Stop, Action labels and disconnect
are not assignment withdrawal. A native cancellation observation suppresses that
input locally without pretending it is a payload-validated receipt.

## One native call, positive-only recovery

Before I/O, Loom binds one immutable envelope to the intent and exact primary. It
contains the structured thread reference, not answer excerpts. The deterministic
native ID and full request are saved in a `delivery-event` bound record. Later
attempts reuse those bytes, including after renderer changes. No fallback or route
edit is supported. Loom preflights the exact primary's project/directory/workspace;
missing, moved, deleted or mismatched destinations require attention, never guessing.

The saved envelope's self-digest alone is not authority. Before host lookup,
sending or admission reconciliation, Loom validates its destination, native ID,
bound-record scope/assignment/authorization, payload digest, metadata and versioned
notice against the authorized intent/question/answer/assignment chain. Intent
author identity must match its source answer. Digest-consistent but inconsistent
records fail closed without selecting another destination or rewriting the saved
envelope. Supported, valid frozen requests retain their original bytes on reload;
renderer upgrades do not change the host project's namespace or re-render old sends.

Short SQLite transactions coordinate PREPARING tokens. Explicit retry/startup may
supersede preparation; an older owner's send-started CAS must lose. No transaction
crosses native I/O. The send-started marker permits at most one synthetic call to
the primary (`resume:true`, `delivery:steer`). Once marked, no subsequent attempt
calls synthetic—even after timeout, lost ACK, crash, reload or elapsed time.
A crash **between marker and call** may remain uncertain forever. Safety takes
precedence over automatic liveness in that gap.

```json
{"operation":"retry-delivery","delivery_id":"DELIVERY_INTENT_ID"}
{"operation":"query","view":"deliveries","delivery_id":"DELIVERY_INTENT_ID","attempt_after":0,"attempt_limit":20}
```

Retry is exact-primary only and never appends another answer/intent. Preflight-only
failure may be retried after the exact route is corrected. Possibly-invoked calls
only reconcile: matching ACK, live enqueued event, or exact synthetic promoted in
actual `ctx.session.context` can persist a positive receipt. Live events are not
replayed; an observed event sequence does not expose a plugin log/inbox API.
Missing/unpromoted/compacted history or read failure never proves nonadmission and
never causes resend. A committed receipt is strongest even alongside withdrawal,
native cancellation or a late error. Receipt means admission, not processing,
comprehension, successful re-delegation or acceptance.

Delivery reads add response-only `delivery_status`: eligibility
eligible/stored-only/withdrawn/unsupported/native-cancelled/invalid; transport
not-attempted/preparing/needs-attention/admission-uncertain/admitted; reason and
latest attempt/event/receipt/withdrawal/native-cancellation IDs when available.
Exact delivery reads add separately paged `attempts.items/next_after`, ledger
sequence ascending. `attempt_after` defaults to 0, `attempt_limit` to 20 (1–50);
these cursors require `delivery_id`. Base after/limit still filter the intent.
Status, lifecycle history and base records share the existing 4 MiB reservation
and per-record budgets; a read-limit failure is not an eligibility decision.

Only a newly authorized answer, one startup batch (at most 20 indexed distinct
intents: 10 pending/preparing + 10 uncertain, unused slots transferable), or an
explicit retry creates an opportunity. No timer, all-history scan, false-history
backfill, or page-to-exhaustion maintenance loop exists. Reads and authorization
never dispatch. No timely/eventual delivery guarantee is made.

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
selection-independent access, search-visible help and default zero sends.

`tests/primary-sender-native.test.ts` exercises real local SQLite transactions,
competing connections, persistence failures, withdrawal, conservative uncertainty
and retry/startup bounds. `tests/installed_sender_qualification.py` runs isolated
OpenCode 2.0.29 with a local scripted provider and production Loom setup/sender.
Boundary wrappers inject lost ACK/receipt failures but call the actual public
plugin APIs; they never fabricate positive evidence or submit notices themselves.
The full chain includes original-call return/primary idle before Research answers,
full conflicting/qualified paginated thread reads, native same-Worker/original-ref
delegation, explicit completion retrieval and an actual coordinating operation.
Request entry is counted before provider guards; actual native inputs and writes
are checked separately. The older comparison controls remain test-only.

These scripts are author qualification tests, not by themselves independent
acceptance, live-model usefulness, arbitrary burst-answer scheduling or production
coordination readiness. The default-off sender separately has accepted bounded
evidence. Reviewed context/selection and tested manual backup/restore corrections,
plus the real native trial/fresh-Session evidence, are summarized in
[operating policy](operating-policy.md). That trial authorized/sent no automatic
continuation and is not sender-transport proof or whole-alpha acceptance.
See [migration](migration.md#state-and-rollback) for the supported empty predecessor
sender-table upgrade and explicit rejection of unsupported/nonempty shapes.
Keep PR #180 draft and unmerged.

The new operations are documented directly in registered tool-search help. The
record manual's metadata ceiling is now 10,000 characters; other manuals retain
3,600 and summaries 120. These are description conventions, not model-token or
whole-process budgets. The compact catalog still uses the short summary.
