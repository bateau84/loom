# Recovering a selected task after replanning

A selected task can disappear from the current Plan. Loom must make that visible
without changing the agent's selection, rewriting evidence, or blocking native
OpenCode execution. This is a recovery aid, not a new lifecycle gate.

## Behavior

The existing `loom_context` tool and automatic context injection use the same
recovery-aware reader. When a successfully read Plan does not contain the requested
node, they return a compact notice with:

- Action ID, missing node ID, and the Plan revision seen by that read;
- `task: null`, `selection_unchanged: true`, and recovery code
  `task-not-in-current-plan`;
- usable `loom_plan` and `loom_record` inputs for the current Plan and that node's
  historical records;
- explicit choices to select a current task, use Action-only context, or clear
  selection through `loom_context`.

The notice says "not in the current plan", not "was deleted": a mistyped or
never-existing ID has not necessarily been removed. Missing-task reads do not
create a Plan, choose a similar-looking replacement, adopt the parent Action,
clear selection, or migrate historical records. Explicit invalid selection
attempts leave the caller's previous selection untouched, including in a new
Session with no selection.

The next context hook replaces the previous Loom context block with the notice.
Repeated hooks keep one block. Explicit reselection restores normal context;
explicit clearing removes the context block on the next hook. Existing role and
injection opt-outs still apply. An unconfigured agent receives no automatic Loom
context; the explicit context tool remains available under native permissions.

## Existing tools, not a new protocol

For example, a missing task notice provides exact inputs equivalent to:

```json
{"tool":"loom_plan","input":{"operation":"read","action_id":"ACTION-ID"}}
{"tool":"loom_record","input":{"operation":"query","action_id":"ACTION-ID","node_id":"OLD-TASK-ID"}}
```

Use `loom_context` with the Action ID and a chosen current node ID to select new
work. Call it with just the Action ID to choose Action-only context, or with
`{"clear":true}` to stop selecting work. These choices are never executed merely
because they appear in the notice. No approval, dispatch grant or extra tool is
introduced. Record IDs still support full-source retrieval. Excerpts can omit
qualifications: read the complete source before consequential decisions.

## Evidence and consistency

Existing selection and history are preserved. While the missing task remains
selected, the existing observer may record its historical origin without a
current task-contract fingerprint. The notice explains that historical selection
is not a current contract. Clearing or selecting new work affects later calls,
not the origin of calls already started. Existing ambiguous-call and restart
rules are unchanged; saved starts do not automatically replay missing completions.

The missing-node check and reported Plan revision use the existing read snapshot.
The typed internal error releases that transaction before the model-facing notice
is built. There is no second Plan read that can substitute a newer revision into
the notice. Another process may change the Plan after the snapshot ends; the
notice is a read-time observation, not a promise that a task remains absent.

Only that typed missing-node condition becomes a recovery notice. Invalid IDs,
invalid budgets, unknown Actions and storage errors remain errors. The explicit
tool reports those errors; the automatic hook retains its existing warning/non-
blocking behavior. General storage-failure diagnostics are not solved by this
patch.

## Bounds and tests

Recovery IDs use the existing 1-120-character identifier rules. The fixed notice
fits the minimum 2,000-character JSON payload budget, including maximum-length
IDs. It does not copy arbitrary task or Action prose into the notice. Existing
context sampling and excerpt behavior is unchanged. This small notice bound is
not a bound on Plan input size, parsing, fingerprinting, database setup, or total
processing time; finding E remains open.

`tests/selection-recovery.test.mjs` covers missing/unknown nodes, every hierarchy
level, unchanged selection/history, current Plan/history queries, explicit
reselection/clearing, opt-in Action-only work, bounded notice size, invalid inputs,
non-misclassified storage failures, transaction release, concurrent replanning,
and database reopen. Against `c43b18c`, 17 of its 20 probes failed; after repair,
20/20 passed locally with Node 22.16 SQLite and strict core TypeScript 5.8.3.

The added test in `tests/native.test.ts` exercises the registered plugin with real
Bun storage and a simulated host: the old task block becomes a notice, hooks stay
idempotent, opt-outs work, new Sessions do not acquire invalid selections, restart
preserves the missing selection, and a late pre-restart completion does not borrow
new task attribution. This is not an installed OpenCode smoke test.

Independent review and the live-host parallel-call / capture-toggle / interruption /
restart / fresh-session exercise are still required before acceptance. Keep the
PR draft. The unused broad recent-record reader was subsequently removed; context
uses the scoped snapshot reader. See [current evidence boundaries](operating-policy.md)
for the later bounded native removal/fresh-Session trial; it does not prove all
parallel-call, capture-toggle, interruption or restart cases listed above.
