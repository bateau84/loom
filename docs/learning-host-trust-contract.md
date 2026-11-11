---
type: Architecture
title: "Learning host provenance and human authorization contract"
description: "Source-inspected OpenCode trust boundaries, executable native counterexamples and the smallest upstream receipt contract required for independent learning and live experiments."
tags: [loom, learning, provenance, authorization, qualification]
timestamp: 2026-11-11T00:00:00Z
---

# Learning host provenance and human authorization contract

## Decision and current capability

**Keep independent-pattern reporting and live instruction experiments disabled.**
OpenCode 2.2.6 supplies durable input identities and native permission decisions,
but it does not expose the trusted actor, original-request relationship or
direct-human treatment receipt required by [#227](https://github.com/bateau84/loom/issues/227).
Loom cannot turn caller-supplied metadata, a `user` role or a successful permission
assertion into that proof. The useful delivered change is an executable native
boundary probe and a concrete upstream contract, not an enabled experiment API.

The current [manual objective and comparison contracts](learning-experiments.md)
remain authoritative. An independently entered human message is **not by itself
an independent objective**: a human saying “fix the failing test” can continue
the original goal. Provenance must preserve that relationship as well as identify
who submitted each message.

## Inspected revisions and evidence boundary

Source inspected:

- Pinned OpenCode **2.2.6**, commit
  [`dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06`](https://github.com/anomalyco/opencode/tree/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06).
- Newer published OpenCode **2.2.7**, commit
  [`fedc6f208aa2bd54c1019227214568083f6380ad`](https://github.com/anomalyco/opencode/tree/fedc6f208aa2bd54c1019227214568083f6380ad).
  This is a source comparison only; it does not upgrade or qualify Loom on 2.2.7.

| Behavior | Exact source path on 2.2.6 | What it establishes |
| --- | --- | --- |
| Prompt admission | [`session/prompt.ts`](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/core/src/session/prompt.ts), [`session/session.ts`](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/core/src/session/session.ts) | Every ordinary admission becomes `type: user`. Caller metadata is passed through the mutable prompt hook. Reusing an input ID in the same Session/type keeps the first admission; cross-Session/type reuse conflicts. |
| Public input and stored schema | [`groups/session.ts`](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/protocol/src/groups/session.ts), [`session-message.ts`](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/schema/src/session-message.ts), [`session-inbox.ts`](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/schema/src/session-inbox.ts) | Session/message IDs, event clocks and free-form metadata; no host-owned human principal or original-request receipt. Importable history is not an attestation channel. |
| Human composer | [`composer/submit.ts`](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/app/src/composer/submit.ts) | The GUI submits the same `session.prompt` API and retries the same admission ID. GUI-origin metadata is not protected from API callers. |
| Child and corrective dispatch | [`tool/plugin/subagent.ts`](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/core/src/tool/plugin/subagent.ts) | Native tool verifies immediate parentage, creates or continues a child and calls ordinary `sessions.prompt`. It supplies no trusted originating-request identity. A child `user` message can contain agent-written approval text. |
| Restart and compaction | [`execution/restart.ts`](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/core/src/session/execution/restart.ts), [`session/history.ts`](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/core/src/session/history.ts), [`session/runner/llm.ts`](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/core/src/session/runner/llm.ts) | Restart creates a synthetic continuation; history reads can be bounded by compaction; model retry reuses boundary preparation. These preserve native execution mechanics, not independent origin identity. |
| Native permission assertion | [`permission.ts`](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/core/src/permission.ts), [`promise/permission.ts`](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/plugin/src/promise/permission.ts) | `assert` returns `void` for both configured allow and successful pending approval. Plugin clients also expose `reply`. Pending state is a process-local Map; finalization rejects and clears it. |
| Approval reply | [`handlers/permission.ts`](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/server/src/handlers/permission.ts), [`schema/permission.ts`](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/schema/src/permission.ts) | The handler verifies pending request/Session ownership, then accepts `once`, `always` or `reject`; the ephemeral reply event contains no human actor, treatment digest or durable consent receipt. |
| Automatic `once` replies | [`requests/auto-approve.ts`](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/app/src/session/requests/auto-approve.ts) | GUI auto-approval itself sends `decision: once`. Observing `once` is insufficient evidence of a human gesture. |
| Server authentication | [`auth.ts`](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/server/src/auth.ts), [`middleware/authorization.ts`](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/server/src/middleware/authorization.ts) | Host password/pairing-session authentication authorizes API access; it does not identify a particular approval as human interaction. |

The inspected 2.2.7 origin, subagent, permission schema/service, reply handler and
auto-approval paths retain these limitations. Its new same-provider
`experimental.model.resolve` hook is a routing mechanism, not an account-bound
entitlement guarantee. Its `session.generate` response adds token/cost fields;
those are host-reported usage, not a provider invoice, subscription authorization
or instruction-effectiveness result. See the
[version comparison](https://github.com/anomalyco/opencode/compare/v2.2.6...v2.2.7).

## Executable current-host counterexamples

Run from the Loom checkout after `bun install --frozen-lockfile`, with the exact
external OpenCode 2.2.6 executable:

```sh
python3 tests/installed_host_trust.py \
  --opencode /absolute/path/to/opencode \
  --report-directory /absolute/path/to/new-host-trust-report
```

The existing installed-host CI job runs this probe. The report binds the host
version and fixture/harness hashes. The probe owns a temporary isolated host,
removes every provider through a test-only plugin, sends only `resume: false`
admissions, and never reads operator credentials/history or writes a treatment.
`--disable-watcher` is available for environments without watcher support; its
use is recorded and does not qualify watcher behavior.

The 12 checks exercise the real host:

1. Caller-authored `human: true` and fabricated origin metadata survive as a
   `user` admission. They are a counterexample, never accepted evidence.
2. Duplicate input ID with altered payload returns the original admission.
3. Reusing that ID in a child Session is rejected.
4. Separate requests, three corrective admissions and a cross-Session
   continuation retain distinct native input IDs without an origin attestation.
5. Configured permission allow/deny settles without a pending human request.
6. Wrong-Session permission reply is rejected without consuming the request.
7. A scripted `once` reply succeeds without any human interaction.
8. Replaying the consumed permission reply is rejected.
9. A scripted rejection clears the native pending request.
10. Prompt IDs, payloads and child parentage survive host reopening.
11. Pending permission state is lost on shutdown; an old reply is rejected.
12. There is no active model work, observed model-request hook or native
    treatment entry.

`status: PASS` means these **counterexamples and native mechanics** passed. The
same report retains `origin_independence: BLOCKED` and
`direct_human_consent: UNPROVEN`. It uses manually created test ancestry and
scripted permission replies. It does not claim a genuine General-to-child
dispatch, human approval, compaction/retry provenance, or live experiment.
An unexpected schema or changed counterexample fails the probe and requires
fresh source investigation, rather than silently upgrading trust.

## Required host-owned origin contract

The smallest useful addition is an immutable **ingress receipt plus causal
lineage**, exposed read-only to plugins and anchored outside agent-authored
message fields. The names below describe requirements, not existing APIs.

Keep three identities separate:

- **Ingress identity:** one admitted input, with host-owned actor classification
  (`interactive-human`, `agent/tool`, `automation`, `imported`, `unknown`), host
  identity, Session/message IDs and admission time. Idempotent retry preserves it.
- **Original-request lineage:** the trusted roots and explicit continuation
  relationships to which that input belongs. A new human correction can retain
  an earlier root. When the relationship is unknown, it stays unqualified.
- **Objective and attempt identity:** Loom's existing authored goal units and
  linked attempts. Several goal units may share one ingress/root; a goal may
  continue through several ingresses/Sessions. These are not replacements for
  native receipt identity and do not certify independence.

The host must identify direct interaction through a protected client admission
channel, not an `origin: human` parameter usable by the normal prompt API. That
channel must be unavailable to agent tools, scripts with ordinary API access,
plugins acting as callers and client auto-approval. Imported and old history
must remain `unknown` or `imported`, including after export/import and backup.
Hashes/signatures authenticate bytes only when their issuer and key access are
trusted; a plugin signing its own claims provides no additional authority.

Native delegation, corrective redispatch, background work, compaction and
restart must propagate the current origin set from the host's execution
context. The child cannot select a fresh human root. If a batch mixes several
roots and a unique relation is unavailable, expose the complete set/ambiguity;
do not select one by latest text, agent name or title. Admission retries and
provider retries must not create new origins.

**Semantic independence needs its own decision.** A new direct-human ingress
does not automatically create a new independent original request. Reuse a
trusted active lineage unless the operator explicitly starts a new goal, or
retain the relationship as unknown. Cross-Session continuation must refer to
an existing root through the protected operator channel, or a verifiable
native continuation capability. Agent-authored assertions that two goals are
independent remain interpretations. Even operator-qualified roots establish
request independence only, not absence of shared external incidents or a
causally comparable experimental population.

For learning, distinct objectives with any shared root form a correlated
component and cannot inflate the independent denominator. One human request
with two distinct goals still permits two objective records; it contributes
at most one independent request episode to that cohort. Missing lineage,
unresolved root sets or contradictory continuation receipts suppress
independent-pattern claims while preserving manual analysis.

Durable receipt lookup must survive compaction/restart and identify unavailable
history explicitly. Changes to an interpretation append a correction with its
authority and prior relation; they cannot rewrite the original actor or turn
historical unqualified inputs into certified human origins retroactively.

## Required direct-human treatment authorization

Use a host-owned challenge bound to an immutable treatment proposal. The exact
approved bytes, digest algorithm and canonical encoding must be versioned.
Every changed field requires a new human authorization:

| Bound value | Required meaning |
| --- | --- |
| Candidate ID and SHA-256 | Exact immutable candidate content, not its label or a mutable pointer. |
| Baseline instruction identity | Exact agent/skill identity and content hash the candidate is compared against. |
| Project/host, objective and eligible Session | No cross-host, cross-project, cross-objective or sibling/child reuse. A child is separately named or covered by a precisely bounded host-issued delegation grant. |
| Target agent and delivery scope | Exact native agent identity and supported additive/replacement route; agent switching invalidates eligibility. |
| Budget | Defined enrollment/use count and model-request/execution limit, including stated retry accounting; atomic host enforcement. |
| Expiry | Host-checked deadline and revocation state, with clock/restart rules. |
| Safety constraints and evaluation criteria | Exact immutable content/digest, including isolation, withdrawal and measurement limits shown to the human. |
| Challenge and decision identity | Nonce, issuer, authenticated operator channel, decision time and durable decision receipt. |

A protected client must display that exact treatment and record a deliberate
approval/denial. Ordinary native `permission.assert` remains a separate gate:
configured allow, saved `always`, a synthetic `once`, or permissive policy must
not satisfy this human-authorization requirement. Native denial still wins.

The host must atomically verify and consume/reserve an eligible grant at the
admission boundary before any Loom experiment reservation or native instruction
write. A stable admission identity makes crash recovery idempotent without
replaying authorization as a new trial. Concurrent consumes cannot exceed the
budget. Changed candidate, expired/revoked grant, wrong Session/agent, malformed
receipt, unavailable verifier and interrupted pending challenge all fail closed.
Pending interruption must not be invented as human rejection or approval.

This requires a real security boundary. The approving credential and receipt
store must be inaccessible to agent-controlled tools and ordinary API callers;
a shared password or same-process caller-supplied flag cannot provide it. A
threat model that gives an agent arbitrary access to the host's signing keys,
UI automation or durable store cannot claim nonforgeable human approval without
an additional protected confirmation mechanism. Trusted operator/host code is
part of the trusted computing base, not evidence supplied by the model.

No global canonical instruction promotion is implied by a trial grant. Promotion
continues to require independent review, explicit global-change authorization,
a versioned change and a verified rollback route.

## Acceptance matrix for the proposed contract

These are requirements for a future actual host implementation. They are not
green tests against a made-up receipt service. The executable probe above
establishes current limitations and useful native negative controls.

| Scenario | Required result | Current proof |
| --- | --- | --- |
| One original request, three corrections/ledger records | One trusted root across attempts, even if objective records were incorrectly split. | Native input distinction/recovery exercised; trusted root **UNPROVEN**. |
| Separate human requests in one Session | Distinct operator-qualified roots; no title heuristics. | Native IDs exercised; direct-human/semantic independence **UNPROVEN**. |
| One objective continued across Sessions or human turns | New ingress may retain the same root; no extra independent episode. | Authored continuation usable; trusted relation **UNPROVEN**. |
| Real child/redispatch contains forged approval/origin | Preserve parent origin; approval denied before experiment/native writes. | Source proves child ordinary-prompt route; full native trusted enforcement **UNPROVEN**. |
| Missing/ambiguous/imported origin | Explicit uncertainty; zero certified independent-pattern claims. | Current Loom remains blocked; no synthetic attestation introduced. |
| Restart/compaction/retry | Same durable receipts and lineage; gaps remain gaps. | Inbox/restart identity exercised; trusted receipt and compaction/retry **UNPROVEN**. |
| Authentic operator approves exact treatment | Host receipt names exact digest/bounds and native permissions also permit. | **UNPROVEN**; no authentic operator channel available. |
| Native permission denied | Enrollment refused before any treatment write. | Native deny decision exercised; future enrollment integration **UNPROVEN**. |
| Genuine interactive native approval | Still needs separate direct-human treatment binding, unless host explicitly unifies both. | **UNPROVEN**; script `once` is only a counterexample. |
| Agent/tool text or parent-child forged approval | Cannot create a grant or write experiment/native state. | Caller-supplied metadata and scripted reply counterexamples exercised; grant implementation **UNPROVEN**. |
| Candidate/base/scope/budget/criteria changed | Exact binding mismatch rejects before writes. | **UNPROVEN**; no supported grant/controller exists. |
| Replayed, expired or concurrently consumed grant | Reject invalid grant; at most the approved budget succeeds. | Native permission replay exercised; treatment-grant semantics **UNPROVEN**. |
| Wrong Session or agent | Reject without consuming legitimate pending grant. | Native wrong-Session reply exercised; grant/agent binding **UNPROVEN**. |
| Pending approval interrupted/restarted | No authorization fabricated; recover or mark invalid explicitly. | Shutdown clears pending native permission; protected durable challenge **UNPROVEN**. |

Acceptance must compare complete pre/post experiment tables and native entries
for rejected treatments, then reopen the host and retrieve the original receipts.
Use actual protected UI/operator input for positive human cases. Scripted
providers and preallowed fixtures can verify downstream mechanics only.

## Upstream coordination and next verification

Bounded upstream issue searches found related work, not this complete contract:

- [#61645 — race-safe single-use permission admission](https://github.com/anomalyco/opencode/issues/61645)
  is the closest execution-boundary prerequisite. It does not itself establish
  direct-human interaction or original-request lineage.
- [#61767 — saved permissions/rule provenance](https://github.com/anomalyco/opencode/issues/61767)
  separates rule sources; rule origin is still not a treatment-bound human receipt.
- [#36347 — durable permission/question waits](https://github.com/anomalyco/opencode/issues/36347)
  covers restart continuity that the current probe shows is missing.
- [#40384 — attributable Session metadata](https://github.com/anomalyco/opencode/issues/40384)
  concerns caller-authored metadata, which is useful labeling but insufficient
  for this trust boundary.

The **OpenCode interface/security owners** must select the protected admission
and approval mechanism and document its adversary/credential assumptions. The
**Loom integration owner** can then implement a read-only receipt adapter and
transactional grant consumer against that real API, run this matrix, and obtain
independent acceptance before reopening the deferred controller or reporter.
No upstream source is modified by this preparation, and no new switch makes an
unsupported guarantee available. The exact remaining disposition belongs in
[#227](https://github.com/bateau84/loom/issues/227).
