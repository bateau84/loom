# Alpha operating policy: useful context, honest history

Status: **scope revised after `504584b`; E remains partially open**.
This revision supersedes the earlier capacity-limited-alpha proposal. It changes
release priorities, not runtime behavior. Loom is a work-context helper, not a
database platform. Keep implemented safeguards; do not add storage machinery
merely to turn every limitation into a closed finding.

## Required for the alpha

| Requirement | Acceptance evidence still needed |
| --- | --- |
| Do not delete or silently replace history | Existing regressions remain; failures must not create an apparently successful empty replacement |
| Keep successfully retrieved context when saving selection fails | Return the read and a separate failed selection outcome; test a fresh Session and an existing selection |
| Explain failures truthfully | Distinguish unreadable context, failed selection/clear, failed capture and invalid configuration; never report a skipped write as successful |
| One straightforward manual backup/restore procedure | Test restoration of meaningful records to a separate location without overwriting the source or claiming live invocation continuity |

**The context/selection failure fix is not implemented by this document.** At the
reviewed runtime, `loom_context` can still throw after a successful read if its
selection save fails. That small correction remains required. On a failed save,
report whether the actual saved reference could be read; do not invent it when
storage is unavailable. A failed clear must not claim that selection was cleared.
Subsequent automatic context follows persisted selection, not the requested but
unsaved reference. Keep invalid input, missing tasks and storage errors distinct.
No second persistence store, automatic reassignment or endless retry is needed.

**Manual backup/restore is also still unimplemented and untested.** Its alpha
scope is one operator-initiated procedure with stopped writers, explicit source
and destination, preserved originals and verification of restored Action IDs,
Plan revisions, results, claims/reviews and interrupted/ambiguous observations.
It need not include scheduling, an archive service, online restoration, rotation
or automatic corruption repair. Restoring data does not replay missing events or
certify an unfinished invocation. The legacy configuration exporter and the
empty-ledger boot probe are not state backup/restore evidence.

## Deferred storage guarantees, not alpha prerequisites

Automatic recovery, capacity/maintenance modes, automatic index preparation
policies, strict WAL-growth or disk quotas, retention automation and large-history
qualification are deferred. They must not displace tool guidance and the real
Research-to-Worker trial. Ordinary errors still require clear reporting; deferral
does not license silent data loss, fabricated evidence or a known correctness bug.

The former **100,000-row, 256 MiB database, 64 MiB WAL and 80% warning** numbers
are withdrawn from the alpha acceptance checklist. They were neither qualified
nor enforced and are not supported-capacity claims. No storage threshold is
enabled. Index creation still runs synchronously in Store setup; startup costs,
disk growth and larger-history behavior are not guaranteed. No automatic expiry,
pruning, rotation, destructive compaction or history replacement is introduced.
**Preserved history may still exceed the normal per-record read limits.** Do not
claim unlimited readable history, fixed startup time or whole-process protection.

## Existing configuration admission stays in place

`loadConfig()` admits one active load and at most eight FIFO waiters in the host
JavaScript realm, shared across plugin instances and module replacements. A slot
covers all layers, parsing, validation and cleanup. Each admitted caller performs
fresh reads; no successful result is cached or shared. Direct internal reader
calls are not the production admission entrypoint.

Success and failure release the slot when the actual operation settles. A
pre-cancelled caller takes no slot; a cancelled waiter is removed with its listener.
Active cancellation settles the caller but retains the slot until I/O and cleanup
settle, so abandoned I/O cannot bypass the limit. Late errors are consumed; further
reader/layer/decoder steps check cancellation where supported.

Overflow (`LOOM_CONFIG_LOAD_OVERFLOW`) and cancellation
(`LOOM_CONFIG_LOAD_CANCELLED`) return disabled injection/new-capture settings,
not stale successful roles. The context hook removes stale Loom blocks and a
skipped start preserves conservative evidence handling. Tool calls supply their
abort signal. Pinned context and before/after hooks lack per-caller signals and
use plugin-lifetime cancellation instead; Session interruption is not claimed to
cancel those queued hooks. Disposal aborts its own loads without resetting the
shared queue or authorizing callbacks to use a closed Store.

`loom_agents` exposes `config_loads`, but is itself a configuration consumer.
**Queue length is bounded; waiting time is not.** Slow filesystem I/O can retain
the active slot. There is no cross-process/worker limit, synchronous-parser
preemption, I/O deadline or hostile same-process containment. On the first upgrade
from code without admission tracking, drain old loads or restart the host;
replacement cannot retrospectively count work that was never registered.

## Next work and proof

1. Use the [five-tool guide](tools.md) to improve the actual tool descriptions and
   role-injected help where a real agent encounters uncertainty. This document
   does not change that injected help.
2. Fix the successful-read/failed-selection outcome and test the manual backup/
   restore procedure. Keep both independent of capacity-management features.
3. Run the installed Research -> Worker -> task removal -> explicit recovery ->
   fresh-session scenario with real persisted records and independent review.

The existing boot test proves loading and equivalent intact empty-ledger checks,
not that scenario. A written example or simulated hooks are not live acceptance.
**E stays partial** for unimplemented startup/storage guarantees; independent
review of the implemented bounds remains separate. Do not reopen a large storage
program merely to call E fully closed. Keep PR #180 draft pending narrow alpha
acceptance. No scheduling, dashboard or expanded orchestration is added.

Related: [read consistency](read-consistency.md), [evidence](evidence-reliability.md),
[processing](processing-limits.md), [retrieval](retrieval-limits.md),
[parser](configuration-parser.md), [file reads](configuration-limits.md),
[installed-host proof](installed-host-validation.md).
