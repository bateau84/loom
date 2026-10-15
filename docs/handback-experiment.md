# Assignment-scoped handback experiment

This is a test-only candidate, not a production notification feature. No module
under `src/` imports the bridge and no normal Loom configuration enables it.
OpenCode 2.0.29 remains unmodified and owns the actual Session runs, native
subagent calls, permissions and model-request pipeline. A local scripted provider
supplies deterministic responses; no external provider or paid inference is used.

## Question being tested

Can a plugin return one explicitly completed assignment to its original primary
when the original foreground delegation has returned and a later answer resumes
the Worker outside that native job? Can it refrain from doing so when a newer
native delegation already owns that return?

`tests/handback/bridge.mjs` is deliberately a small experimental selector.
It keeps the exact assignment, primary, Worker and worked-against reference in a
separate fixture database. It does not infer an assignment from Session idleness.
A returned native call is not an explicit assignment completion. Unknown return
ownership suppresses the experimental nudge. Cancellation suppresses it too.
A newer native call for the exact Worker is observed in the registered before
hook and retains native ownership; unrelated background work is not a barrier.

## Installed-host cases

The Python driver starts real isolated CLI processes and makes only one initial
user prompt per case. The primary creates work through actual Loom tools, calls
the native Worker subagent in foreground mode, receives its question/yield result,
and launches Research in native background mode. Research's scripted response is
held at a test barrier until the driver observes the primary idle. Releasing that
barrier does not submit another prompt to any Session.

Research records a qualified answer through Loom. A test-only adapter resumes
the Worker with references, not a copy of the answer. Worker retrieves the full
thread, its next provider request is checked for the qualification, and Worker
explicitly records completion for its retained work reference.

- Baseline: answer continuation only. Worker finishes; no bridge handback occurs.
- Bridge: the late completion nudges the exact primary, which retrieves the
  authoritative completion and records its next coordinating action.
- Native-covered: a newer native background delegation to the same Worker owns
  completion. Loom must send zero nudges; native handback continues the primary.
- Cancelled: a deliberate assignment-cancellation fault is injected before the
  handback decision. The completion stays saved, but Loom must not wake primary.
- Lost receipt: host admission succeeds, then receipt loss is injected. The saved
  attempt remains uncertain unless actual primary consumption is observed. A
  duplicate offer cannot submit another message or wake.
- Restart: the installed host is stopped and reopened after the original
  delegation returned, before Research's answer is released. Meaningful saved
  question/assignment state is used, without a new user prompt.

Research remains active during the measured return so its unrelated native
completion cannot mask a missing Worker handback. This also tests that returning
one useful result does not wait for all background jobs.

## Evidence and limits

The pass endpoint is the primary's actual next Loom write following authoritative
completion retrieval, not a notice, wake receipt, idle label or native final text.
Provider requests, tool results, decisions and fixture state are retained with the
report. Both a missing result and an infrastructure failure are failures, never
skips or accepted negative controls. Inspect results for the exact committed head.

Unit tests exercise persisted identity, noncompletion/wrong-reference rejection,
known/unknown native ownership, cancellation before resume and before submission,
independent work, two SQLite connections, failed writes and immutable uncertain
attempts. They do not execute native agents.

The installed scenario has a scripted provider, not a live-model quality test.
Its cancellation is an explicit injected assignment event, not proof of complete
user-stop detection. Its ownership observer covers native calls passing through
this fixture; arbitrary external clients and native ownership changes racing after
submission remain unqualified. The SQLite claim does not lock OpenCode's job
registry or make host delivery and the ledger one transaction.

Uncertain attempts are preserved, not automatically resent. This avoids claiming
safe idempotent wakeup from message-ID deduplication alone, but does not implement
eventual recovery for every lost or refused send. Restart at other crash windows,
lease recovery, arbitrary repeated resumes and production routing remain separate
work. The experiment must not be advertised as an accepted production bridge.

Run `node --test tests/handback-experiment.test.mjs`, then the installed experiment
with an exact external 2.0.29 CLI and a new report directory. The CI job supplies
that isolated environment. Production tool count, schema, help and native
permissions are unchanged. Keep PR #180 draft and unmerged.
