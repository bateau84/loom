---
type: Playbook
title: "Alpha operating policy: useful context, honest history"
description: Records current alpha operating policy and the bounded evidence and limitations that support it.
tags: [operating-policy, alpha, evidence]
timestamp: 2026-10-19T00:00:00Z
---

# Alpha operating policy: useful context, honest history

Status: **scope revised after `504584b`; E remains partially open**.
This revision supersedes the earlier capacity-limited-alpha proposal. It changes
release priorities, not runtime behavior. Loom is a work-context helper, not a
database platform. Keep implemented safeguards; do not add storage machinery
merely to turn every limitation into a closed finding.

## Required for the alpha

| Requirement | Current bounded evidence |
| --- | --- |
| Do not delete or silently replace history | Existing regressions remain; failures must not create an apparently successful empty replacement |
| Keep successfully retrieved context when saving selection fails | Implemented and independently reviewed; fresh and existing selection regressions |
| Explain failures truthfully | Distinguish unreadable context, failed selection/clear, failed capture and invalid configuration; never report a skipped write as successful |
| One straightforward manual backup/restore procedure | Tested separate-location restoration of meaningful records and relationships; originals retained, no native continuity claim |

**The context/selection correction is implemented.** A successful `loom_context`
read is returned even if saving explicit selection fails, alongside
`selection.status: "save-failed"`, diagnostics and `persisted`: the actual saved
reference, null if absent, or "unknown" if readback fails. Diagnostics may be
excerpted to fit the context budget. A failed clear still fails; it does not
claim that selection was cleared.
Subsequent automatic context follows persisted selection, not the requested but
unsaved reference. Keep invalid input, missing tasks and storage errors distinct.
No second persistence store, automatic reassignment or endless retry is needed.

**The [manual backup/restore procedure](manual-backup-restore.md) is tested.** Its
scope is one operator-initiated procedure with ALL writers and SQLite connections
closed, explicit source and separate destination, preserved originals/sidecars
and verification of restored Action IDs,
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

## Bounded evidence and remaining acceptance

The former default-off sender has historical bounded evidence and is now retired,
including its operations/views and startup/retry paths. Its acceptance does not
qualify the replacement. Historical consent never authorizes current I/O.
On the supported 2.0.32 host, questions are stored without contacting recipients;
manual native handling is required. Installed question behavior is qualified
separately from boot. Blocking
is intent, not a gate or forced wait.
Only the first committed new-format blocking answer qualifies for one immediate
best-effort exact-asker resume. No retries, transfer, replay or consumption
guarantee exists; crash after commit may permanently lose liveness. Current native
agent/model/permissions remain unchanged. Admission is not processing/completion;
timeout bounds waiting, not cancellation; target checks are not leases.
See [collaboration](collaboration.md) for durable answer/separate SYSTEM annotation
outcomes and complete escaped relational `full_thread` history. Cursors and labelled
parts expose incompleteness; they do not promise a concurrent snapshot, perpetual
validity, recursive expansion or unlimited readable history. New installed proof
must identify the exact assembled artifact; historical counts below are not reruns.
The context correction (`3c474c2`) and manual procedure (`51dc355`) have independent
review. The supplied composition evidence at `245f74a` reports 254 native tests,
370 core tests (five hard-coded external-scratch concurrency cases excluded),
typecheck and a private restore -> empty-legacy upgrade -> selection-failure seam.
The producer additionally reported 16 Python passes; these were not independently
rerun. These counts describe those runs, not a claim of a full unexcluded suite.

The real native trial Action `814363bc-7939-4995-a86d-deb16f74357c` is completed.
Its research result `d5207f13-1979-46d7-bcc3-df2ee3bc848c`, full thread
`04a2c707-f476-4de1-9bdd-5fa4c9176d32`, answer
`e4e0bef5-7077-4121-bea0-cd4b87b9f7a1`, coder result
`6af38b01-94f6-48e7-91e3-49462927ca12`, explicit completion
`091bad9d-6595-4aee-9e44-445ffb387dd6` and independent fresh-recovery PASS
`d398a7e4-ee81-40f6-ae0b-17e283161ab3` identify the retained evidence.
Native research/coder/follow-up, Plan 2 retaining completion, Plan 3 removing the
coder task, historical retrieval and fresh-Session recovery passed that bounded
scope. No automatic continuation was authorized or sent. Source freshness,
transport, restart and save-failure probes were outside this trial, not claims
that separate tests lack such evidence. Completion of this Action is not whole-alpha
acceptance, a universal usefulness claim or permission to merge/release.

The [five-tool guide](tools.md), registered search help and bundled `loom` skill
remain the usage references. Native agent mappings use current definitions;
removed external Loom skills stay removed. Actions and Plans remain optional.
The older boot test proves only its loading/empty-ledger scope; it is neither
the trial above nor proof of every later source revision.
**E stays partial** for unimplemented startup/storage guarantees; independent
review of the implemented bounds remains separate. Do not reopen a large storage
program merely to call E fully closed. Keep PR #180 draft pending narrow alpha
acceptance. No scheduling, dashboard or expanded orchestration is added.

Related: [read consistency](read-consistency.md), [evidence](evidence-reliability.md),
[processing](processing-limits.md), [retrieval](retrieval-limits.md),
[parser](configuration-parser.md), [file reads](configuration-limits.md),
[installed-host proof](installed-host-validation.md).
