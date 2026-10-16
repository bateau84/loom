# Coordination direction: primary-first native re-delegation

Status: **selected next implementation candidate after review of `c2db6e7`**.
The experiment has independent feasibility acceptance, as reported by the user.
The storage-only assignment contract is implemented at `3f08da9`; see
[assignment association and stored delivery intent](assignment-delivery.md).
Independent review of that storage slice remains pending. Sending, recovery and
cancellation are not implemented; normal Loom does not yet continue agents.
The end-to-end sequence below remains the target, not current runtime behavior.

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

Automatic mode intentionally requests execution and may spend tokens. Native
execution ownership does not mean a blanket ban on Loom requesting continuation.
The primary decides whether and how to continue work; an answer does not authorize
unrelated work or override native permissions. No new respondent is created just
because a question names an expertise label.

The native return alone is not assignment completion. A Worker may yield again,
fail or be interrupted. The primary must inspect the explicit report and its
worked-against reference. Completion remains separate from Assessment, QA,
acceptance, resolved uncertainty and completion of the parent Action. No global
question-reconciliation barrier or wait for all background jobs is introduced.

## Durable assignment identity and routing — target contract

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
Only an explicitly registered coordinator is a fallback; label that delivery as
fallback, not proof the original primary or respondent received it. Reassignment
or rerouting must be explicit and preserve prior delivery identities and attempts.

The implemented [storage-only contract](assignment-delivery.md) defines
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
Assigned answers and their primary-addressed intents commit together and report
`stored-for-session` / `not-attempted`. Destination liveness is not checked at
answer time. All stored associations and intents set `automatic_continuation:false`.

These are implemented storage rules, not independently accepted delivery behavior.
Automatic assignment capture, route changes/fallback, sending, admission recovery
and cancellation remain future work. No current child/location check proves a
particular native generation or future delivery eligibility. Do not add a
compulsory planning, attachment or permission ceremony for ordinary work.

## Answer delivery and uncertain admission — target contract

Save the answer and its delivery intent in one database transaction. Send only
after commit. A transport failure must return the saved answer/question IDs and a
separate delivery outcome, not encourage creation of the same answer again.

One delivery ID binds an assignment, source answer, destination Session and exact
payload. Retrying preserves all of them. A changed route or payload creates a new,
linked delivery; it cannot withdraw a message already or possibly admitted.
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

Retry opportunities are post-save, a bounded startup batch and an explicit retry
operation. Coordinate concurrent claims without holding a database transaction
across host I/O. Define recovery for interrupted claims before enabling it. No
polling loop is required, and pending work does not promise timely delivery when
no eligible retry opportunity occurs.

**Unknown is not unsent.** Do not blindly retry an uncertain send with `resume:true`.
A stable message ID is not sufficient evidence of duplicate-free continuation.
The implementation must establish what the pinned host can verify about admission
and processing, and which retries are safe. An unresolved outcome stays visible
for intervention rather than silently replaying work or claiming delivery.
Read-before-send alone is not an atomic claim over host execution.

Cancellation and native permission denials are not transient transport failures
to retry away. Failed/uncertain delivery recovery, including the crash after
admission but before receipt storage, remains an implementation and test obligation.
The experiment's successful managed restart is not proof of that crash window.

## Cancellation and concurrent work — target contract

Record explicit withdrawal of an assignment's automatic continuation. Idle alone
cannot distinguish waiting from deliberate stopping. Recheck before delivery,
before primary re-delegation and during recovery. Cancelling continuation does not
delete a question, answer or completion; nor does it claim that native execution
was interrupted. Native interruption and permissions remain with OpenCode.

A delivered notice may already be queued or executing when cancellation arrives.
Do not promise atomic cancellation across Loom and the host. Define the observable
user-stop signal, pending-input treatment, and race boundaries before shipping
automatic mode. Recovery must not deliberately revive withdrawn work, while normal
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
Automatic context presentation, missing-route attention and transport status beyond
stored/not-attempted remain future work.

Keep five tools. Any future association, delivery status, cancellation or retry
operations must appear directly in the help returned by tool search, with inputs,
side effects, failure meanings and examples. Do not publish working-looking calls
or configuration settings before the corresponding implementation exists. Choosing
automatic mode should not require a new approval ritual for every answer; it also
must not bypass native permissions or silently enable execution on upgrade.

## Bounded implementation sequence and acceptance

1. Independently review the implemented `3f08da9` assignment association and the
   supplied author probes: exact primary/child checks, reused Worker/reference
   pairs, explicit handles, conflicts, historical work and attachment races.
2. Independently verify atomic answer/intent persistence, actual commit failure,
   selection-independent discovery and stored `automatic_continuation:false`.
   Storage implementation and author-reported tests are not an independent PASS.
   Preservation of this opt-out across future upgrades belongs in sender tests.
3. Establish supported admission reconciliation, concurrent claims and bounded
   retry recovery together with cancellation. Test before-send, after-admission
   and before-receipt crashes, failed sends, actual user stop, and overlapping
   native activity. Do not add a sender before the storage review is complete.
4. Connect the primary notice to native re-delegation and publish tool-search help.
   Reuse the existing whole-chain tests, with requests observed before script guards.

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

This work does not close E, the context-read/selection-save defect, manual
backup/restore, migration or overall alpha readiness. Scheduling, dashboards,
universal grants/gates, automatic parent completion and a second agent runner
remain outside this scope. Keep PR #180 draft and unmerged.
