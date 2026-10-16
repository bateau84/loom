# Coordination direction: primary-first native re-delegation

Status: **bounded opt-in sender implemented; default coordination remains off**.
The experiment has independent feasibility acceptance, as reported by the user.
The storage-only assignment contract is implemented at `3f08da9`; see
[assignment association and stored delivery intent](assignment-delivery.md).
The user accepted the storage slice independently. The current sender adds only
prospective exact-primary authorization, fenced sending, positive admission
reconciliation and irreversible explicit withdrawal. The default-off sender has
accepted bounded evidence; it is not default enablement or overall production
coordination readiness. See
[the implemented operations and uncertainty limits](assignment-delivery.md).

## Decision and evidence

Prefer **answer -> original primary -> native re-delegation to the same Worker**
over extending Loom's experimental completion-return selector. OpenCode owns
the new native call and its return. Loom must not also resume Worker directly or
send a competing completion nudge for that same continuation.

The [comparison at `c2db6e7`](handback-comparison.md) exercised this path on the
installed OpenCode 2.0.29 host using a local scripted provider. The user reports
independent Reviewer verification of 29/29 focused tests, all 12 host scenarios,
and byte-for-byte matching of all 100 supplied CI artifact files. Review accepted
that declared scope, not production readiness or live-model usefulness. This
architecture reconciliation does not claim another independent review or rerun.

The experiment retained the same Worker Session and original `work_ref`, checked
actual answer/completion retrieval, and ended with a primary coordinating ledger
write. A second foreground generation yielding before the answer stranded the
unchanged bridge but not fresh native re-delegation. Duplicate counterchecks
detected extra provider requests; they did not prevent duplicate execution.

Keep the direct bridge and its known defects as test-only comparison controls.
Do not import `tests/handback/bridge.mjs` into production. The alternative avoids
its ownership/resume decisions; it does not repair them. Nine primary requests
versus seven for the direct bridge is a reported cost of this scripted case,
not a token, elapsed-time or quality benchmark.

Implementation/run evidence: [CI 38859306107](https://github.com/bateau84/loom/actions/runs/38859306107)
and [comparison report](https://github.com/bateau84/loom/pull/180#issuecomment-6209302262).
Independent-review details above come from the user's subsequent review report;
they are not inferred from green CI or asserted as a newly recovered transcript.

## End-to-end responsibility

```text
Primary delegates an assignment through native OpenCode
-> Worker keeps its original work_ref, asks a question and yields
-> Original native call returns; Primary is idle
-> Research saves a qualified answer
-> Loom notifies the exact primary and requests native continuation
-> Primary reads the authoritative thread and checks the assignment
-> Primary re-delegates the same assignment to the same Worker Session
-> Worker reads the thread and explicitly reports completion
-> Native delegation returns to Primary
-> Primary reads that completion and performs its next coordinating action
```

Explicit opt-in intentionally requests execution and may spend tokens. Native
execution ownership does not mean a blanket ban on Loom requesting continuation.
The primary decides whether and how to continue work; an answer does not authorize
unrelated work or override native permissions. No new respondent is created just
because a question names an expertise label.

The native return alone is not assignment completion. A Worker may yield again,
fail or be interrupted. The primary must inspect the explicit report and its
worked-against reference. Completion remains separate from Assessment, QA,
acceptance, resolved uncertainty and completion of the parent Action. No global
question-reconciliation barrier or wait for all background jobs is introduced.

## Durable assignment identity and routing

The durable unit is a delegated assignment, not a native call's lifetime or the
current Session selection. Retain a stable assignment ID, project/Action/node,
original `work_ref`, exact Worker Session and exact coordinating primary Session.
Keep the reference's revisions for traceability; compare its named fields without
JSON property-order dependence. Unrelated replanning must not silently replace the
reference or invalidate otherwise matching work. Meaningful changes must remain
visible for reconciliation, never relabel old work with the newest definition.

A native call/generation is a trace of one attempt within the assignment, not a
permanent ownership bit. Do not reuse the experimental sticky native-owner flag.
Likewise, one Session can host more than one assignment over time. A later run,
completion or new primary must not be associated solely because a Session ID
matches. Bind report/question IDs to the actual assignment and worked-against
reference; preserve removed work and previous associations.

Expertise (`respondent`), respondent Session, asking Worker Session and primary
Session are separate facts. Do not infer the primary from the newest Session,
Action creator, selected Action or role name. An unresolved/deleted destination
must preserve the saved exchange and expose an actionable routing problem.
This bounded version has **no fallback, reassignment or rerouting operation**.
Never guess another Session. Preserve the saved route and expose the failure.

The implemented [assignment contract](assignment-delivery.md) defines
`loom_record operation=assign`: the calling primary registers a project-unique
`assignment_id`, its checked native child Worker and the original `work_ref`.
Identical registrations reuse the original record; conflicting bindings fail
without retargeting. Two assignments sharing both Worker and `work_ref` remain
distinct by `assignment_id`. Worker supplies that handle explicitly on assigned
`ask` and `complete` operations; no association is inferred from selection.

At initial registration, optional `question_id` can link a matching unanswered,
unbound question without rewriting it. First-time attachment after an answer is
rejected; identical saved registrations remain retryable subject to the native
child lookup. Changing the initial question on an existing assignment is a
conflict, not a later attachment operation. Unassigned answers remain saved and report
`not-requested` / `question-not-assigned`, without a guessed route or intent.
Assigned answers and primary-addressed intents commit together. Destination
liveness is not required for saving. Without earlier explicit authorization,
intents remain `automatic_continuation:false`, `stored-for-session/not-attempted`.
Only future intents after `authorize-continuation` carry true consent and the
authorization/policy IDs. An upgrade, setting, role or skill never authorizes
historical intents. Sending occurs separately after commit and returns its own
status; failed transport never asks Research to save the answer again.

Automatic assignment capture and route changes/fallback remain outside this slice.
No current child/location check proves a
particular native generation or future delivery eligibility. Do not add a
compulsory planning, attachment or permission ceremony for ordinary work.

## Answer delivery and uncertain admission

Save the answer and its delivery intent in one database transaction. Send only
after commit. A transport failure must return the saved answer/question IDs and a
separate delivery outcome, not encourage creation of the same answer again.

One delivery ID binds an assignment, source answer, destination Session and exact
payload. Retrying preserves all of them. This version does not edit routes or
payloads or replace an uncertain intent with a new one.
Notifications identify the authoritative thread rather than replacing it with an
unqualified summary. Primary must retrieve the source before re-delegating.

Use narrow outcome labels, with immutable attempt history:

| Outcome | What it establishes |
| --- | --- |
| Stored for Session | Loom durably saved a notice for that Session |
| Pending attempt | A saved, routed intent is awaiting an eligible attempt |
| Admission uncertain | A send may have been accepted; its result is unknown |
| Admitted to native inbox | The host acknowledged admission, not reading, re-delegation or completion |
| Presented in context | A passive notice was included in prepared context, not necessarily a successful model request |
| Needs attention / cancelled | Intervention is required, or automatic continuation has been withdrawn; history remains |

Never mark Worker "resumed" before admission. In this path Loom does not directly
resume Worker at all. Even primary admission does not prove that native
re-delegation occurred. Observe that separately; never manufacture success from
an attempted call, idle state or prepared context.

Opportunities are post-save for a newly authorized intent, one startup batch of
at most 20 indexed distinct intents, and explicit `retry-delivery`. PREPARING
recovery can supersede tokens; the old owner must lose its send-started CAS.
No transaction crosses I/O, timer polls history or loop drains pages to exhaustion.
Pending work does not promise timely delivery without an opportunity.

**Unknown is not unsent.** Do not blindly retry an uncertain send with `resume:true`.
A stable message ID is not sufficient evidence of duplicate-free continuation.
The pinned plugin API supports positive ACK, live-enqueued and context-promoted
evidence. Live event item identity comes from the event's sessionID/inboxID, not
from nonexistent item.id/sessionID fields. Context is latest-compaction bounded;
absence/error proves nothing about admission. After send-started there is at most
ONE synthetic call, with no lease takeover/replay. A marker-before-call crash can
remain uncertain forever. An unresolved outcome stays visible
for intervention rather than silently replaying work or claiming delivery.
Read-before-send alone is not an atomic claim over host execution.

Cancellation and native permission denials are not transient transport failures
to retry away. Failed/uncertain delivery recovery, including the crash after
admission but before receipt storage, remains an implementation and test obligation.
The old experiment's successful managed restart is not proof of that crash window.
Current qualification additionally injects ACK/receipt failures through production
sender I/O and tests actual public ctx reconciliation without another synthetic.

## Withdrawal and concurrent work

Record explicit withdrawal of an assignment's automatic continuation. Idle alone
cannot distinguish waiting from deliberate stopping. Recheck before delivery,
before primary re-delegation and during recovery. Cancelling continuation does not
delete a question, answer or completion; nor does it claim that native execution
was interrupted. Native interruption and permissions remain with OpenCode.

A delivered notice may already be queued or executing when cancellation arrives.
Do not promise atomic cancellation across Loom and the host. Define the observable
explicit tombstone and race boundary: before send-started it fences I/O; afterward
withdrawal may return possibly-admitted/admitted. No native-stop inference or
pending-input retraction is implemented. Recovery must not deliberately revive withdrawn work, while normal
native work and authoritative reads remain available. Assignment cancellation is
not silently inferred from a current Action label or a lost client connection.

Do not re-delegate the same assignment into overlapping Worker executions merely
because another answer or retry arrives. Do not wait for unrelated background
work. The current evidence does not establish behavior with an already-running
Worker, multiple concurrent answers, another primary/client, background-generation
replay or all restart windows. Resolve those cases explicitly; do not add a
competing Loom handback as an untested fallback when native coverage is unknown.

## Passive mode and agent-facing access

Passive notices remain a separate optional candidate: persist a Session-addressed
notice and expose it only during already-requested context preparation or an
explicit read. Never submit execution input in passive mode. Durable availability
is not timely presentation; an idle Session may never encounter it. This cannot
replace the automatic coordination endpoint above.

For either mode, discovery must be Session-wide, independent of selected Action,
selected task, absent selection or an unreadable selection. Use bounded previews,
explicit omissions/paging and exact full-thread/report retrieval without changing
selection. Missing routing and uncertain attempts must not be buried by observations.
The storage slice implements explicit `query view=assignments` and
`view=deliveries` reads independently of selection; see the
[implemented access contract](assignment-delivery.md#selection-independent-discovery).
Automatic passive context presentation remains outside this slice. Explicit reads
now expose continuation/withdrawal, needs-attention/uncertain transport and paged
attempt history; they never send.

Keep five tools. Authorization, delivery status, withdrawal and retry
operations appear directly in the help returned by tool search, with inputs,
side effects, failure meanings and examples. Do not publish working-looking calls
or configuration settings before the corresponding implementation exists. Choosing
automatic mode should not require a new approval ritual for every answer; it also
must not bypass native permissions or silently enable execution on upgrade.

## Qualification and acceptance boundaries

The storage slice has the user's independent acceptance. Sender qualification is
separate. `tests/primary-sender-native.test.ts` covers transactional identity,
authorization/withdrawal, failures, competing real connections and local crash
boundaries. `tests/installed_sender_qualification.py` exercises production sender
composition on isolated OpenCode 2.0.29 with local scripted inference. Test-only
wrappers fail real public I/O boundaries; they do not manufacture receipts or send
the notice. Request ENTRY is observed before script guards, alongside actual
native inputs, Worker operations, completion reads and coordinating writes.
See the [test commands](sender-qualification.md) and retained run evidence.

Independent sender review/acceptance is recorded within its bounded scope; default
coordination is not enabled by passing these checks. Explicit withdrawal is
qualified, not automatic native Stop
propagation, arbitrary overlapping/burst-answer scheduling or live-model usefulness.

The pass endpoint remains: after original delegation returns and Primary is idle,
an answer leads to Worker completion and Primary's next coordinating action,
without another user prompt. Check exact primary/Worker/assignment identity,
original `work_ref`, authoritative reads, zero direct Worker synthetic resumes,
and zero Loom completion nudges. Test replay for both extra model requests and
repeated work, not just unchanged ledger-write counts.

The reviewed comparison's endpoint is a coordinating ledger write, not an actual
product deliverable or live-model quality result. Extend that acceptance separately
when evaluating practical usefulness. Retain its negative controls and all six
original scenarios; do not turn their expected failures into successful recovery.
Broader background/replay cases remain unproven until separately exercised.

The separate context-read/selection-save correction and stopped-writers manual
backup/restore are now reviewed/tested. The real native trial and independent
fresh-Session recovery also passed their bounded scope without authorizing or
sending automatic continuation; see [current evidence and limits](operating-policy.md).
Neither that trial nor sender acceptance closes E, universal migration or overall
alpha readiness. Scheduling, dashboards,
universal grants/gates, automatic parent completion and a second agent runner
remain outside this scope. Keep PR #180 draft and unmerged.
