# Corrections from the independent review of `5f51baf`

The review reported two defects and three surviving mutations. These are different
claims: the defects occurred in unchanged code; the survivors showed missing
regression protection, not three more defects in that code. The original nine
mutation patches in the reviewer's local `/tmp/opencode` directory were not
available in this implementation environment. The counterchecks here reconstruct
the three reported changes; they are not an exhaustive score or a rerun of that
exact nine-patch set.

## P2: failed native calls need a failed finish record

Pinned OpenCode 2.0.18 sends `Tool.Error` class instances to `execute.after`.
Loom's ordinary canonical serializer intentionally refuses class graphs. The
native hook now projects an error into plain diagnostic data before passing the
finish to the Observer:

```json
{"format":"loom-tool-error/v1","message":"the SDK error message"}
```

`result_digest` hashes that complete projection, not the raw Error object. No raw
message is stored in the ledger. Stack traces, nested causes and optional metadata
are deliberately excluded: they may contain arbitrary classes, cycles or sensitive
values. This is a diagnostic-message digest, not a claim to hash every property of
an SDK failure. Original Session/message/call references remain the route to the
host's full failure. Successful results keep their original digest behavior.

The adapter does not mutate the host error, broaden generic serialization, stringify
an arbitrary class, or truncate an over-limit message. Existing processing limits
still apply; a refused digest or database write leaves the start available for a
later valid completion attempt. The stored status remains `error`, independently
of attribution. Capture-off still permits only the existing unambiguous in-flight
finish. Normalization belongs to the native adapter; direct low-level Observer
calls continue to require serializer-compatible data.

The native regressions instantiate the actual pinned SDK class, including nested
Error and metadata values, and execute the registered before/after callbacks with
real Bun SQLite. They check persisted phase, status, digest, original work scope,
no plaintext disclosure, capture-off completion and failed-write retry. The
registration host is simulated; these are not installed model-driven executions.

## P3: recovery must not depend on unrelated selection

Selection is now read only by operations that need it. Agent discovery, Action
list/create/update, explicit Plan operations, Session-only ledger queries and
selection clearing do not first deserialize the old reference. An explicit create
still intentionally selects its new Action. A successful clear stores null; neither
operation deletes prior history.

Selection-dependent calls still surface corruption. They do not turn an unreadable
reference into no selection, infer an Action, or fabricate a successful write.
Existing identity-based completion/answer/thread requests retain their independent
routing. Incompatible clear/Session-only arguments still fail visibly. Regressions
cover malformed stored selection, unaffected history, explicit scope recovery,
write failure and rollback, and absence of cross-Session history leakage.

This does **not** fix the separate known case where `loom_context` reads useful
context but then fails to save an explicitly requested selection. No general
backup/restore, storage management or notification feature is added.

## Missing regression protection

The new core cases directly check:

- Changing an ancestor's criteria invalidates the child's reported completion,
  while a task under a separate group stays current. The fixture really contains
  parent links, including an intermediate wave.
- Both paired and unpaired failed finishes persist `status: error`, not merely a
  plausible attribution. Their complete plain-error digest is also checked.
- A ctime-only metadata change fails configuration admission before decoding,
  while size and mtime remain equal. Real file operations are forwarded; only
  the second ctime observation is deliberately altered for deterministic coverage.

The older test that built only dependencies is renamed to describe dependencies
only. Its assertions are retained; the new test supplies the missing ancestor
coverage rather than preserving a misleading test title.

## Counterchecks and verification

Run the ordinary frozen install/typecheck/test commands. To verify sensitivity to
these exact regression mechanisms, run:

```sh
python3 tools/check-review-regressions.py --report-directory /tmp/loom-review-counterchecks
```

The command copies source/tests into isolated temporary directories and links the
already installed dependency tree. It does not edit the checkout, reinstall packages,
use a model, or run native agent work. Each changed variant must pass full TypeScript
checking and core compilation. A nonzero test exit alone is insufficient: the
expected named test must fail by assertion, not by missing dependencies or broken
compilation. Logs and a machine-readable report distinguish each outcome.

The three mutants omit ancestor requirements, force successful status for failed
finishes, and remove the ctime comparison. Two additional reverse-fix controls
restore raw SDK error hashing and eager selection reads. The unmodified focused
core/native suites must pass first. Main CI runs these counterchecks and retains
their logs for seven days. Changed mutation sites fail explicitly instead of
silently skipping the test.

Read CI results for the actual committed head; this guide is not itself a passing
run or an independent re-review. The separate Code Mode search harness and existing
installed-host boot probe keep their original meanings. The meaningful-record
Research -> Worker acceptance trial, independent acceptance of these corrections,
and manual backup/restore remain separate. Keep PR #180 draft and retain the five
tools and native execution/permission boundary.

Pinned source: [SDK failed-finish interface](https://github.com/anomalyco/opencode/blob/v2.0.18/packages/plugin/src/promise/tool.ts)
and [Tool.Error definition](https://github.com/anomalyco/opencode/blob/v2.0.18/packages/schema/src/tool.ts).
