---
type: Playbook
title: "Bounded live instruction experiments (exact OpenCode 2.2.6)"
description: "Explicit, per-Session additive instruction trials with durable uncertain exposure; not production skill substitution."
tags: [loom, learning, instructions, experiments, opencode]
timestamp: 2026-11-10T00:00:00Z
---

# Opt-in additive Session instruction trials

**Default: inactive.** The actual production controller has now passed
[12 exact-host checks](https://github.com/bateau84/loom/actions/runs/42905765436)
at Loom code commit `de895ca131cd51cb132bdf9ce542277f99074a01`
against an unmodified OpenCode 2.2.6 host and a local scripted provider.
**This remains a draft awaiting independent review**, not permission to activate
experiments globally or claim real-work effectiveness. There is no automatic
allocation, skill rewrite or promotion.

## The qualified boundary

[Host qualification #221](https://github.com/bateau84/loom/pull/221)
at `11f1feabd62f56fa142acbce6689f5b1a5a43064` passed its
[installed 2.2.6 suite](https://github.com/bateau84/loom/actions/runs/42887389298).
The actual delivery is a keyed, **additive** native Session entry using
`ctx.session.instructions.entry.put/list/remove`. It does not replace a
native agent's system prompt or a loaded skill. Compaction and future context
may retain previously delivered content after removal. The fixture used a
scripted local provider with tool use disabled; it says nothing about model
reasoning quality or live provider billing.

The controller's installed qualification uses the actual packed Loom plugin,
native source-linked objectives, user approval messages, original native
Session IDs and an external scripted provider observing final SDK input.
The narrower Bun registration tests use real SQLite but a simulated host;
**they are not installed-host evidence**.

OpenCode 2.2.6 can deliver newly added instructions as a generated **user-role
context delta** in a Session that already has history. A missing entry in the
earlier context hook is recorded as `context-stage-unobserved` rather than a
false denial. The native model-request hook verifies source/entry freshness
but remains pre-provider. The installed provider oracle independently verifies
exact entry readback, absence of marker text in original native user messages,
and uncontaminated concurrent control and sibling Sessions. Model-delivery
receipts are **external qualification evidence**, not host-certified receipts
from the Loom tool, and do not establish actual instruction effectiveness.

Unsupported and excluded: native skill loading, attachments, direct file
reads, model-issued tools, reviewer/critic/evaluator Sessions, direct native
agent-definition changes, native error retries, arbitrary child dispatch,
HTTP/WebSocket-specific transports, any host other than exact OpenCode
`@opencode/cli@2.2.6` / `@opencode/plugin@2.2.6`.
Do not claim that this overlay tests a revised `SKILL.md` verbatim.

## Authorization and assignment

A human or appropriately authorized controller must first identify a
repeated, source-backed engineering problem and specify independently checked
evaluation criteria. A proposal alone does not grant delivery authority.

1. Create an exact source-linked `loom_objective` with `native-context`
   verification for **this Session**. Other Sessions, including children,
   require their **own** explicit objective links. Parentage or the selected
   Action is not a treatment grant.
2. Use `loom_tweak propose` with `target_kind: "agent"` and the native
   registered agent's full `system` SHA-256 as `base_sha256`. The immutable
   candidate bytes are delivered additively under
   `loom.live-instruction.v1`. Changing bytes requires a **new proposal
   identity**, not an in-place update.
3. The exact Session must contain a **native user message** with its real
   message ID and an isolated line:
   `LOOM-TRIAL-APPROVE candidate=CANDIDATE_ID objective=OBJECTIVE_ID budget=N`
   (substitute the actual IDs and 1–8 budget). An agent assertion or arbitrary
   URL is not sufficient authority. The user message is rechecked after native
   permission approval, before reserving a trial.
4. Use `loom_tweak` with `operation: "live-start"`,
   `candidate_id`, `objective_id`, `authorize:true`,
   `authorization_ref` set to that exact user message ID,
   `eligibility`, `evaluation_criteria`, `preserved_guarantees`,
   `budget_requests:1..8`, and `expires_at` within one hour.
   Native OpenCode permission `loom-live-instruction-experiment` is required
   and may deny. No broader global enable switch exists.
5. A durable reservation precedes the Session-entry PUT. Readback only
   proves a native assignment. The first qualified primary preflight checks
   host, Session, agent, candidate, source hash, entry readback, deadline and
   budget. It does **not** prove the provider received the candidate.

In the unmodified control or unrelated Sessions, Loom writes no entry.
Automatic child enrollment is forbidden, even when the native parent was
enrolled. No request may be silently reallocated to a different variant.
The trial caps pre-transport primary requests at the authorized budget
(`1..8`). This is a **count of requests seen at the hook**, not a count of
provider completions or independent objectives.

## Observation, interruption, stop and retirement

`loom_tweak live-read` reports the current Session's assignment state,
candidate and original objective IDs, authorization, context-stage and
pretransport events, bounded history, and the material qualification
`observed_provider_receipts: 0`. It never calculates causal outcome or
labels a treatment successful from a pre-provider hook or matching source hash.

`loom_tweak live-stop` marks withdrawal **before** native I/O, preventing
new eligible preflights, removes only its own exact key, and reads back
absence. An already admitted request may still be in flight. Previous
model history is **not erased**. The same Session is never eligible for
another trial or as an unexposed control.

Failed PUT/readback or uncertain withdrawal is durable
`recovery-required`/`stop-uncertain`; do not call it
`not-exercised`. After restart, inspect with `live-read`, then attempt an
explicit `live-stop` against the native entry. If a foreign value appears
under the key, stop **refuses to overwrite/delete** it; isolate and manually
repair the Session. Retiring a candidate with an active or uncertain trial is
rejected; stop/reconcile first. Retired candidates never become a new trial.
Use `loom_tweak trial` only for a separately attributed **agent report**,
not a host-certified exposure or clean experimental comparison.

Local SQLite stores at most one trial for each enrolled native Session, at
most 64 audit events per trial, and returns at most 20 recent events per read.
Preserve `learning.sqlite` and its WAL/SHM files with stopped writers; the
Action-only ledger backup is not a complete learning recovery. There is no
global automatic garbage collector; the project-local history grows with
explicit trials, not automatically with native requests from unrelated
Sessions.

## Operational boundaries and failure behavior

The plugin registers enforcement at the native tool pre-execute,
pre-provider context and model-request stages, independent of normal ledger
capture. During active treatment, unsupported tools are denied, including
native `skill` and file `read`; only `loom_tweak live-read` and
`loom_tweak live-stop` are exempt. A blocked tool, missing native instruction
entry, unknown host, source drift, denied permission, budget exhaustion and
deadline expiry do not confer treatment success. With no trial, unrelated
Sessions keep native OpenCode behavior unchanged.

A host restart may resume an unchanged assigned trial within its remaining
deadline and budget; it **does not reset** assignment, native source identity
or earlier possible exposure. State loss while an entry remains injected
requires explicit recovery; new transport is denied rather than pretending
treatment was absent.

Keep the native model-selection and included-only billing guards intact.
The experiment does not select a provider, change permissions, alter routing
or enable paid overage.

## Acceptance and evaluation

The actual controller was run at `de895ca131cd51cb132bdf9ce542277f99074a01`
with the unmodified `@opencode/cli@2.2.6` and packed candidate. The
[installed qualification report](https://github.com/bateau84/loom/actions/runs/42905765436)
contains 12 passing checks: native approval and assignment, simultaneous
control/treatment isolation, stable continuation, tool-denial evidence,
restart, withdrawal, unchanged registries, user-authored marker rejection,
explicit eligible child versus unassigned sibling, interruption, child
withdrawal, and **real native-entry drift rejection before provider input**.
The wrong-host version gate and source-fingerprint guard are also exercised
by component tests; no claim is made for a second live host version.
Preserve exact-head CI evidence, and obtain independent review before use.
A passing scripted-host test does not qualify arbitrary skills, tool routes,
real model reasoning or live provider/billing behavior.

A genuine live engineering pilot also needs an authorized comparable
objective population, explicit baseline, independent outcome checks and
source evidence; none is supplied by this draft. The first real trial must
not be called effective merely because a candidate was delivered. Preserve
good and bad outcomes, corrections and human intervention, and keep global
promotion as a separate authorized change.
