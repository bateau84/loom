---
type: Playbook
title: "OpenCode 2.2.6 Session instruction-variant qualification"
description: "Exact-host, disposable, provider-observed plumbing trial for additive per-Session instruction entries; no live skill substitution."
tags: [loom, learning, instruction-variants, qualification, opencode]
timestamp: 2026-11-10T00:00:00Z
---

# Session-isolated instruction variants: host qualification

**Verdict: QUALIFIED_BOUNDED for additive native per-Session instruction
entries on exact OpenCode 2.2.6, with manual Session assignment and local
scripted-provider observation.** The [installed workflow run
42887016522](https://github.com/bateau84/loom/actions/runs/42887016522)
passed three independent disposable-host iterations at tested code revision
`30198149cd26a332011cf7d17c1c195858b561ad`. This is **not**
a general-purpose skill substitution or a production-enrollment approval.

The tagged host supports additive Session instructions, not session-scoped
replacement of arbitrary skills or agents. This PR adds a test-only marker and
provider-side evidence harness. It does **not** activate variants in Loom,
change shared skills, approve candidate effectiveness, register trial success
or authorize production routing.

## Exact scope

| Component | Source |
| --- | --- |
| Loom base | bateau84/loom `edab7a96e7c5a9172ceb98b8518c47c48a1d7c09` |
| OpenCode host and SDK | `@opencode/cli@2.2.6`, `@opencode/plugin@2.2.6` |
| Tagged upstream implementation | anomalyco/opencode `dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06` (`v2.2.6`) |
| Runtime environment | Independent disposable loopback host; locally scripted `variant-fixture/scripted` provider |
| Change type | Test fixture, qualification runner, fail-closed oracles and PR CI only |

Sources at that tag:
- [Session instruction entries](https://github.com/anomalyco/opencode/blob/v2.2.6/packages/core/src/session/instruction-entry.ts) persist by Session ID and key; put/list/remove are separate from skill/agent registry state.
- [Session context](https://github.com/anomalyco/opencode/blob/v2.2.6/packages/core/src/session/context.ts) composes `entries.load(sessionID)` with the built-in instruction sources, including skills and discovery.
- [Model request](https://github.com/anomalyco/opencode/blob/v2.2.6/packages/core/src/session/model-request.ts) renders those instructions into system parts, then calls the `context` hook for primary requests. Other request kinds use different hooks.
- [Instruction-entry API](https://github.com/anomalyco/opencode/blob/v2.2.6/packages/client/src/promise/generated/client.ts) and [host endpoints](https://github.com/anomalyco/opencode/blob/v2.2.6/packages/server/src/handlers/session.ts) expose GET/PUT/DELETE under `/api/experimental/session/:id/instructions/entries`.
- [Tagged upstream tests](https://github.com/anomalyco/opencode/blob/v2.2.6/packages/core/test/plugin/session-instructions.test.ts) check Promise-plugin put/list/remove and initial/change/removal deltas. Those tests alone do not prove provider input or cross-Session isolation in an installed CLI.

This API is explicitly **experimental** in the tagged host. Future host/SDK
versions must requalify it, not silently inherit a 2.2.6 result. No authorization
policy for accepting arbitrary user/agent-supplied Session IDs is claimed.

## Installed evidence and failure interpretation

At the tagged 2.2.6 provider boundary, each of the three successful,
independently initialized runs recorded **12 primary scenarios**, one explicit
native compaction model request and nine passed qualification checks.
Concurrent control and treatment Sessions shared a working location and
native agent definition. Every observed treatment attempt carried the exact
candidate SHA-256; unassigned controls and siblings did not. No agent/skill
registry or fixture skill-file digest changed.

A test-only Session reached the SDK provider with candidate content, but its
full receipt was deliberately suppressed. All three runs rejected that
partial exposure as `RECEIPT_GAP`; none credited it as a successful trial.
Interruption did not remove the assignment; restart restored it, and the
same Session continued to receive its candidate after native compaction.

**Withdrawal counterexample:** After native DELETE and an empty entry-list
readback, all three runs still observed the previously delivered marker in the
withdrawn Session's later model input. The existing Session must not be
treated as an uncontaminated baseline.

Earlier single-run revisions intermittently failed because the harness
assumed one SDK attempt per user prompt and identified compaction solely from
user text. The revised evidence collector separately tracks each
fixture-local SDK attempt, requires complete matching receipts, uses native
Session settlement and the native compaction request kind, and runs three
fresh-host repetitions. A retry is not an additional successful trial.
These results do **not** qualify native error-driven retries or provide a
host-certified global request/attempt identity; those remain explicitly
outside this contract.

## Supported *candidate* contract (subject to installed PASS)

The smallest defensible implementation would be **explicit, fixed, additive
Session context** under a dedicated namespaced entry key. It is not a modified
`SKILL.md` and is not a replacement for an agent's native `system` field.

1. A trusted controller verifies an **exact native Session ID**, workspace,
   project, and explicit work eligibility. Parentage and agent name alone grant
   nothing. It checks the immutable candidate and current base fingerprints
   *before* assignment. Assignment is durable state, not evidence of exposure.
2. On the exact pinned host, the controller writes one fixed, content-addressed
   entry to the eligible Session. It reads the native key/value back. A child
   must have its own explicit assignment; no implicit family inheritance.
3. The observer correlates actual native primary requests with the explicitly
   assigned Session and verifies the **local scripted provider's received system
   input**. It retains separate base-file, candidate and effective-system
   SHA-256 digests, native Session/parent IDs, provider/model, request kind,
   assignment and observation state. A context-hook hash is only *pre-provider*
   evidence; metadata from the hook is not a provider receipt.
4. The controller checks a concurrent unassigned control in the **same working
   location**. Any control marker, missing/mismatched treatment input, drift in
   the source/registry, wrong host version or missing receipt makes qualification
   fail. No blank observation is interpreted as baseline.
5. Withdrawal removes the active instruction entry. The host can emit a removal
   delta, but **previously supplied model inputs, persisted history and possibly
   later context are not erased**. A withdrawn Session must not be relabeled
   an unexposed control. Further experiment eligibility requires a fresh
   assessment, normally a fresh Session.

### Delivery-route inventory

| Route | Tagged 2.2.6 mechanism | Status for experiment |
| --- | --- | --- |
| Additive keyed Session instructions | Native `session.instructions.entry` storage and context loading | **Only route under installed qualification** |
| Existing native agent system instructions | Shared agent definitions, prepended to model request | Preserve; **no mutation/substitution** |
| Native `skill` tool loads | Location-scoped skill registry and skill-content tool result | **Not substituted**; experiment must exclude |
| Explicit native skill attachment | Session skill API/inbox, distinct delivery | **Not substituted**; exclude |
| Direct `read` of instruction files | Read actual workspace files via tool | **Not substituted**; exclude |
| Loom `loom_assessment` / `loom_qa` companions | Separate permission-checked file reads and tool output | **Not substituted**; exclude |
| Discovery/`AGENTS.md` and other instruction sources | Native instruction discovery, rendered independently | Preserve; **not substituted** |
| Review agents/child dispatch | New Session identity; no automatic candidate inheritance | Explicit enrollment only; actual subagent dispatch unqualified |
| Native compaction, generation and title | Separate request kinds/hooks; compaction has its own context | Report observed stages separately; never infer from primary hook |
| Manual continuation and restart | Per-Session instruction rows, read on later contexts | Under installed qualification |
| Native error-driven retry, prompt attachment, HTTP/WebSocket transport | Different lifecycle/delivery surfaces | **Not qualified**; exclude from production trial claims |

The scripted model produces plain text only and issues **no tool calls**. The
disposable agents are configured with denied tool permissions. Consequently
the installed experiment does not silently substitute skills through a
different path. Production trials would require an independently enforceable
eligibility gate that blocks or excludes unsupported routes, including
model-originated tool reads. This PR does not provide that gate.

## Reproduce

Requires Linux/POSIX, Python 3, Node/npm and the repository-pinned Bun. Use
an isolated runner, not an already running OpenCode instance or user profile.

```bash
git switch test/session-variant-host-qualification-20261110
bun install --frozen-lockfile
bun run typecheck
python3 -m unittest discover -s tests -p test_installed_instruction_variants.py -v

root=$(mktemp -d)
mkdir -p "$root/packed"
npm pack --json --pack-destination "$root/packed" > "$root/packed/pack.json"
tarball=$(find "$root/packed" -maxdepth 1 -name 'loom-plugin-*.tgz' -print -quit)
npm install --prefix "$root/loom" --no-audit --no-fund "$tarball"
npm install --prefix "$root/host" --no-audit --no-fund @opencode/cli@2.2.6
python3 tests/installed_instruction_variants.py \
  --opencode "$root/host/node_modules/.bin/opencode" \
  --repository . \
  --plugin "$root/loom/node_modules/loom-plugin" \
  --artifact "$tarball" \
  --expect-plugin-version "$(node -p 'require("./package.json").version')" \
  --report-directory "$root/variant-report"
cat "$root/variant-report/report.json"
```

The runner creates its own additional temporary HOME, XDG dirs, project, native
OpenCode database, Loom databases and local provider. It uses loopback Basic
Auth, an explicit local provider and no credentials or real-model requests.
It never writes to `~/.config/opencode` or a production workspace. The
`--report-directory` must not already exist. Review the **report from the
exact PR head**, not an earlier run or a source-unit pass.

The [installed CI workflow](../.github/workflows/installed-instruction-variants.yml)
packs the PR candidate separately from the pinned CLI, typechecks the fixture,
runs the strict negative oracle tests, executes **three independent** native-host
iterations and uploads each `iteration-N/report.json` even if one fails.

### Positive and negative controls

- Concurrent control/treatment model calls both reach the SDK provider while
  a bounded barrier holds them. Only the explicitly assigned Session may show
  the candidate and its exact SHA-256; no evidence is accepted merely from PUT.
- Repeated primary requests in the same Session, explicit assigned child versus
  unassigned sibling, native manual compaction, restart/readback and tombstone
  are exercised independently. Results must name the actual native request
  kinds; title/compaction are not counted as primary trial results.
- Fingerprints of the fixture skill source, OpenCode config, Loom config and
  native agent/skill registries are compared across the run. No active user
  skill/agent registry is written by the harness.
- Negative oracle controls reject wrong exact host, source/registry drift,
  missing or incomplete per-attempt provider receipts, candidate hash mismatch,
  divergent effective instructions between attempts, a marker inserted only
  in user text and contamination of an unassigned control.
  These are **oracle fault-injection tests**, not claims that each failure was
  independently injected into a running OpenCode process.
- An interrupt does not erase prior exposure; verify the Session's assignment
  and follow-up provider input separately. Error-driven provider retries and
  arbitrary request kinds remain outside the qualified subset.

## Interpreting the verdict

`QUALIFIED_BOUNDED` means the exact packed candidate and pinned real CLI
passed the listed native-input controls for **additive, manually assigned,
scripted-provider** instruction entries. It does not authorize production
injection or prove a user objective improved. Any missing check produces a
nonzero exit and `UNPROVEN` with its blocker in the report, not a false green.

A production implementation could rely only on the observed, version-pinned
subset once independently reviewed. Before any live enrollment it still needs
durable eligibility and authorization, a session/attempt identity, atomic
source/candidate validation, host-certified delivery receipts or a defensible
observation boundary, partial-exposure handling and safe exclusions for
unqualified routes. Until those are in place, **manual worktree/host isolation
remains the safe experiment method**.

See [learning evidence and experiments](learning-experiments.md). A
`loom_tweak trial` report is an agent-reported result, **not** proof of
assignment, exposure or causal improvement.
