# Implementation boundaries

## Product and ownership

A Session hosts conversation/execution. An Action is a retained goal and may have
an optional Plan with phase/wave/task/subtask nodes. Levels can be skipped;
siblings do not implicitly depend on each other. An Action can span Sessions and
a Session can contribute to several Actions. Ordinary conversation creates none.

| Owner | Responsibility |
| --- | --- |
| User / external configuration | Agent definitions, professional skills, models, native permissions |
| Agent | Professional judgment, native delegation, useful findings and honest completion reports |
| Loom | Action/Plan/context, observations and attributed history, questions/answers, bundled usage guide |
| OpenCode | Sessions, execution, native delegation/return, skills and authority |

There are five tools, no scheduler, workflow gate, dashboard, custom permission
parser or mandatory review pipeline. `.loom.yaml` maps native IDs to roles and
optional coordination descriptions; transient guidance does not rewrite agents
or grant permissions. General skills remain external; do not restore removed
workflow-specific skills. The bundled native `loom` guide is loaded on demand;
registered live help is syntax authority.

## Collaboration and history

`concern` is an ordinary append-only record kind under existing Action/selection,
attribution and validation rules. It carries statement, same-Action observation
evidence IDs and unverified artifact pointers; no task or verdict is mandatory.
It is eligible for bounded context, exact ledger reads and Action/Session full
history. No historical rewrite or new schema/lifecycle/link operation is needed.
Later consolidation cites source Action and concern IDs in statement text and
does not mutate provenance or imply resolution. A concern ID is not observation
evidence. See [concern requirements](requirements/concern-records/index.md).

Every agent captures its own concerns, distinguishing suspected from confirmed.
General routing maps to configured coordination guidance; critic consolidation
maps to qa guidance, using actual native roster IDs. These are guidance duties,
not provisioned agents or automated escalation, dispatch, gates or risk workflow.
Documented/outside-task/handed-off is not resolved.

[Questions](collaboration.md) require question/to_agent/explicit blocking; answer
requires question_id/answer. Optional `context_attachments` is canonical on both,
never an `attachments` alias. Actual author/Session come from the caller. Explicit
references validate Action/node identity and kind; invalid references never fall
back. Without reference/selection, questions belong only to the asking Session.
Answers inherit original nullable association without selecting another's work.

On the supported OpenCode 2.0.32 host, question dispatch is
fail-closed: stored, recipient NOT contacted,
`not-attempted / policy-capability-unavailable`; manual native handling required.
Blocking is intent, not a forced wait. After manual handling is arranged, the
asker may naturally yield. No host upgrade or alternate dispatch topology is
prescribed to remove this accepted limitation.

Only the first committed answer to a new-format blocking question qualifies for
one immediate postcommit best-effort exact-asking-Session resume. Any prior answer
counts. Later/nonblocking/legacy answers submit no asker input. No retries,
eligibility transfer, recovery replay or startup/read reconstruction exists;
crash can permanently lose liveness. Native target agent/model/permissions stay
unchanged. Missing/moved/inaccessible targets fail visibly without retargeting.
Target checks are not leases; timeout bounds waiting, not cancellation of started
I/O. Admission is not processing, consumption or completion. Durable answer and
separate SYSTEM outcome annotation are independent; annotation failure is visible.

General assignment/delivery/authorization/retry operations AND views are retired.
Legacy tables and raw records remain inert/readable, not current consent or newly
blocking questions. Earlier [comparison](handback-comparison.md)/sender evidence
is historical, not proof of this replacement.

`full_thread` is an existing record query with explicit Action/node OR Session
scope, default limit 20/max 50. Local authorized Loom Store only; no native
Session body or cross-project reads. Membership is authored/direct question-answer
relations including later answers, not notices, admission, assignments or same
agent name. Output is sequence-ordered/deduplicated escaped Markdown with full
stored content, attribution, IDs/links/verdicts/metadata and historical qualifiers.
No recursive expansion or raw-body invention. Labelled parts/next_cursor expose
incompleteness; records advance only at final part. Scope/location/version cursors
are not perpetual or concurrent snapshots. Existing read guards still apply.

## Data, completion and limits

The Action database remains separate from the old workflow database. SQLite
transactions and optimistic revision checks prevent stale plan replacement;
Plan revisions and ledger history are retained. Completion/reopen keep the
original worked-against `work_ref`, goal and qualifications. Changed relevant
contracts may require reconfirmation; unrelated replanning does not erase history.
A completion does not complete parents/Action or prove independent acceptance;
an answer is response, not resolution/approval/permission. Assessment and QA
remain separate review records, not manufactured independence or final PASS.

Selection is attribution, not authority. A successful context read survives failed
selection-save with separate status/persisted diagnostics; failed clear still
throws. Automatic injection follows saved selection, not an unsaved request.
Observation starts retain original work association; missing/ambiguous capture
never borrows a newer selection. See [evidence reliability](evidence-reliability.md)
and [read consistency](read-consistency.md). A snapshot is not a lease.

Capture errors warn rather than blocking native work; explicit storage failures
remain errors. Same-user evaluated code is not an adversarial security boundary.
Preserve bounded [processing](processing-limits.md), [retrieval](retrieval-limits.md)
and configuration admission. None guarantees whole-process resources, startup
cost, disk/WAL quota or unlimited readable history. No automatic retention,
destructive repair or storage automation is introduced. Use the tested
[manual stopped-writers procedure](manual-backup-restore.md), preserving originals.

## Evidence and release boundary

Registered callback/SQLite tests exercise real product code with a simulated
native boundary; Code Mode search tests exercise pinned discovery. Neither is
installed-host native authority or live-model usefulness evidence. Historical
native trials keep their scope and counts, not current acceptance. The replacement
requires independent validation of the exact assembled candidate and real installed
tool/persistence/resume/history paths; missing variants must remain UNPROVEN.
See [installed validation](installed-host-validation.md) and
[operating policy](operating-policy.md). OpenCode 2.0.32 is the sole supported
host and SDK target. Historical 2.0.29 work is not a compatibility profile.
Installed-host boot and installed-question qualification are separate evidence.

Scheduling, dashboards, automatic parent completion, legacy import, retention and
elaborate maintenance are deferred, not prerequisites. E remains partial. Draft
status and separate integration/activation authority remain; docs/tests do not
authorize watched-checkout/config changes, restart, paid inference or publication.
