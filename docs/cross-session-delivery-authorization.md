---
type: Architecture
title: "Cross-session question delivery authorization"
description: "Native caller and destination permission for live peer questions, separate from exact-Session answer ownership."
tags: [loom, collaboration, questions, authorization]
timestamp: 2026-11-17T00:00:00Z
---

# Cross-session question delivery authorization

## Decision

**Retain live delivery to an existing peer Session, and require a native
permission decision for the actual caller and exact destination before that
delivery is admitted.** Use the existing OpenCode permission authority; do not
introduce a Loom grant store, a second dispatcher or a trusted-project default.

The selected authority is the caller's **effective native permission policy**,
evaluated with the exact destination as its resource. A native wildcard grant
can cover that resource. This policy does not require a literal per-peer allow
entry, target-owner consent or a fresh approval for every question.

**OpenCode 2.2.6's stock agent default includes `*` action / `*` resource /
`allow`. Consequently an otherwise unconfigured caller can deliver a peer
question without being prompted.** This is an inherited native permission
grant, not an authorization inferred from sharing a Loom project. Operators
who require restricted peer delivery must configure native rules for
`loom.question.deliver`; the installed checks must demonstrate those rules
actually control the new operation.

This is the Architect-selected correction for PR #237. Its acceptance still
requires the production adapter and installed-host checks below. The decision
does not itself establish that those checks passed.

The accepted behavior is General A asking General B through optional destination
`session_id`, optionally associated with an explicit `action_id`. The actual
calling Session remains the author. The exact destination remains the answer
owner. Sending a question and receiving an authorized answer remain distinct
from approval, resolution, native processing or successful work.

## Why locality is insufficient

At the reviewed head `a55a4650f304353d2241081d3fc7f680ebacc2e2`,
[`src/plugin.ts`](../src/plugin.ts) verifies native Session identity, project,
workspace and canonical directory before routing an explicit peer notice. Those
checks locate the target; they do not authorize the caller to inject native
input there. The same file already treats same-project membership as
insufficient for unrestricted native Session-family discovery.

[`src/collaboration.ts`](../src/collaboration.ts) independently enforces the
stored `expected_session` when answering. That exact-Session ownership is valid
and remains unchanged. Replacing a live notice with an inbox entry alone would
not satisfy the requested live collaboration behavior.

The finding establishes a missing delivery gate. It does not establish a
cross-user exploit, private-context disclosure or a paid provider request.

## Native authority and concrete request

The inspected host is OpenCode **2.2.6**, commit
[`dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06`](https://github.com/anomalyco/opencode/tree/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06).

- [`packages/plugin/src/permission.ts`](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/plugin/src/permission.ts)
  accepts an action, resource list, calling Session, agent and native tool source.
- [`packages/core/src/permission.ts`](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/core/src/permission.ts)
  evaluates the caller's effective agent and Session rules. An unmatched rule
  asks, but that fallback is not the stock agent's default behavior. An
  effective configured deny takes precedence over saved allows.
  `assert` returns only after native allow or accepted pending approval;
  rejection remains a native failure. Unattended unresolved permission asks
  cannot be silently accepted.
- [`packages/schema/src/agent.ts`](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/schema/src/agent.ts)
  gives `Agent.Info.default` the broad `*` / `*` allow before specific read
  exceptions. The permission evaluator therefore has a matching allow even
  when no dedicated peer-delivery rule has been configured. An installed
  qualification attempt confirmed delivery under this baseline; its expected
  unmatched-ASK premise was incorrect, rather than evidence that the assert
  call was bypassed.
- That permission implementation stores requested `save` resources at project
  scope. A destination-only saved permission could therefore outlive the caller
  for whom the initial request was evaluated. **Do not supply `save`.**
- [`packages/core/src/session/session.ts`](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/core/src/session/session.ts)
  admits synthetic input and can wake the Session. Calling that API is a
  consequential operation separate from locating the Session.

For each explicit-destination live question, use:

```typescript
await ctx.permission.assert({
  action: "loom.question.deliver",
  resources: ["session:" + verifiedDestination],
  sessionID: toolContext.sessionID,
  agent: toolContext.agent,
  source: {
    type: "tool",
    messageID: toolContext.messageID,
    id: toolContext.id,
  },
  metadata: { destination_session_id: verifiedDestination },
})
```

`verifiedDestination` must be the exact native Session ID checked from the
requested `session_id`. The caller, agent and source come from the host tool
context, never question arguments. Neither `action_id`, a matching agent name,
an Action selection nor project membership can substitute for this request.

The native policy may allow this action for selected callers and
`session:<id>` resources, ask for the current request, or deny it. An explicitly
configured wildcard allow and inherited host defaults remain effective; Loom
does not insert a wildcard allow or label it target-owner consent. Omitting
`save` means this call does not create a project-wide remembered grant. Every
new live ask evaluates permission again.

For example, the following ordered native `permissions` on the caller's agent
or Session ask for peer delivery generally, allow B and deny C:

```json
[
  { "action": "loom.question.deliver", "resource": "*", "effect": "ask" },
  { "action": "loom.question.deliver", "resource": "session:SESSION_B", "effect": "allow" },
  { "action": "loom.question.deliver", "resource": "session:SESSION_C", "effect": "deny" }
]
```

Replace the example IDs with verified native Session IDs. Native matching uses
the last matching configured rule, so the general ask precedes the exceptions.
Set these through the ordinary native agent configuration or Session permission
API; Loom does not rewrite the caller's native rules. The installed test uses
real Session permission updates to exercise ASK/rejection, exact-target ALLOW
and a different exact-target DENY. Its results, rather than this example alone,
establish qualification.

This is a native permission boundary, not a new authenticated-human receipt or
multi-tenant security boundary. Native configured permissions and trusted host
extensions remain authoritative. The limitations documented in
[the host trust contract](learning-host-trust-contract.md) still apply.

## Ordering and failure contract

1. Validate the request and verify the actual caller and exact destination
   against current native identity and locality. An explicit destination must
   be another Session.
2. Preserve configuration and model-routing eligibility checks. If they withhold
   native delivery, keep the existing explicit `not-attempted` result and
   durable question/inbox behavior. Do not request delivery permission merely
   to perform an operation that these guards already prohibit.
3. For an eligible explicit peer notice, assert native permission **before
   appending the question**, outside the dispatch helper's catch. Let native
   denial, plain rejection and rejection with feedback escape the Loom tool
   implementation without catching or converting the rejected promise. A failed
   permission request must create neither a question nor a native input; do not
   turn a rejected tool operation into an apparently successful ask. This is
   propagation at Loom's boundary, not a guarantee that the host terminates the
   caller's entire step; see the pinned-host qualification below.
4. After the awaited assertion, check caller/plugin cancellation, revalidate the
   exact caller and destination, and refresh configuration/guard eligibility.
   A late permission reply must not cause delivery after interruption, shutdown,
   target removal or target movement. If a current configuration/model guard
   withholds delivery, report that result explicitly and retain only the
   already-supported question/inbox behavior.
5. Persist the attributed question and its exact answer owner, then perform the
   existing best-effort native notice. Keep the existing target recheck near
   delivery. Rechecks are not an atomic ownership lease; do not claim otherwise.

Apply this additional gate to **every explicit `session_id` live ask**, including
an explicitly addressed Session in the same native family. Existing typed
recipient delegation and parent notices retain their existing native
subagent/parent policy. This avoids a new ancestry-based exemption and does not
change ordinary typed-recipient behavior.

If the native call fails after initiation, retain the question and report the
existing uncertain outcome. Native admission is not recipient execution or an
answer. The peer may discover the persisted question through its own inbox.
There is no automatic retry, queued delivery guarantee or startup replay.

## Pinned-host rejection qualification

The permission SDK's documentation describes a plain rejection as ending the
current step and instructs Promise plugins to rethrow it. Loom follows that
boundary instruction: its permission assertion is not caught and no question or
peer input follows a rejection. The installed OpenCode 2.2.6 composition does
**not** establish the stronger whole-step termination promise.

Installed qualification observed two caller model requests in total: the initial
request and one continuation after plain rejection, with unchanged Loom storage
and zero peer notices. A same-host
control through the genuine native Effect tool
`tools.opencode.list_mcp_resources` likewise made two requests in total, including
one continuation after plain rejection; the denied native operation did not complete. This control
used an unconfigured server name, actual native ASK/reply and no JavaScript
catch or replacement permission implementation.

The inspected
[`Promise tool adapter`](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/plugin/src/promise/adapter.ts)
wraps rejected non-`Tool.Error` values. The independent
[`native MCP-resource tool`](https://github.com/anomalyco/opencode/blob/dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06/packages/core/src/tool/plugin/mcp-resource.ts)
asserts permission before MCP lookup. Together with the installed control,
these sources bound the finding to actual host composition; they do not prove
all native tools or other host versions behave identically.

Retain the failed whole-step-stop probe and its raw evidence. Qualification must
report the accepted delivery-denial result separately from the failed host
step-termination claim. Do not turn that failure into PASS because the delivery
gate works. This boundary does not require Loom to interrupt the caller or own
its execution loop: [the product ownership contract](design.md)
leaves execution with OpenCode. A future requirement that plain rejection stop
all caller processing needs separate host qualification or an upstream fix.

## First-answer continuation

The original **blocking** ask is the asking Session's bounded invitation to
receive its existing first-answer continuation. No additional reverse delivery
grant is required for that established callback:

- The answer transaction still verifies the exact stored respondent.
- The return target is the immutable original asking Session, never a new
  destination supplied by the answerer.
- The native notice contains fixed question/answer identifiers and retrieval
  guidance. It does not grant the respondent arbitrary input into the asker.
- Only the first committed answer receives the immediate best-effort handoff.
  Later answers, reopening and restart cannot inherit a lost handoff.
- Nonblocking questions do not initiate this callback.

Preserve commit-before-resume, cancellation, locality checks and no-retry/no-replay
semantics in [`src/answer-resume.ts`](../src/answer-resume.ts). A permission to
answer is not a general permission to wake other Sessions. The callback is
bounded by the original asking Session's own recorded request.

## Alternatives considered

| Alternative | Disposition |
| --- | --- |
| Treat all Sessions in a project as trusted peers | Rejected: that operating constraint is not accepted, and existing Session-family restrictions contradict inferring it from locality. |
| Inbox-only cross-session questions | Rejected as the general solution: durable recovery is useful, but it does not fulfill live General-to-General contact. |
| Native subagent delivery to a peer root | Rejected: the native subagent tool requires parentage and does not represent an existing independent root Session. |
| Loom-specific durable target grants | Not needed: native caller/agent policy already evaluates exact resources and handles ask/deny. A second grant lifecycle would introduce revocation, persistence and authority obligations without an accepted requirement. |
| Force inherited native allows to ask, or require literal per-peer allows | Rejected for this correction: that adds a mandatory per-peer consent/default policy and a second interpretation of native grants. No accepted requirement establishes that stricter default; adopting it requires an explicit product-policy change. |
| Effective native caller permission for the exact destination | Selected: preserves live behavior and existing authority while adding one bounded, separately testable gate. The tradeoff is that stock broad native allows remain permissive until the operator restricts them. |

Revisit this decision if the host changes permission attribution, resource
matching or saved-rule behavior, or if product requirements later demand
target-owner consent or isolation between mutually untrusted users. None of
those stronger promises is inferred from this correction.

## Required verification

| Scenario | Required observable result |
| --- | --- |
| Stock agent defaults, no dedicated delivery rule | Broad inherited native ALLOW covers peer delivery; report this baseline plainly, without calling it unmatched ASK, per-peer opt-in or target-owner consent. |
| Caller A allowed to address B | Native permission request names A, its real agent/tool source and `session:B`; one notice targets B, and B can store an answer. |
| Same caller denied for C | Native denial occurs before a question or input is created; B's allow cannot authorize C. |
| Different caller or agent | The host evaluates that actual caller/agent again; no Loom cached grant or project-wide `save` is used. |
| Explicit native ASK rule, then rejection | Rejected permission escapes the Loom implementation; no successful-ask output, persisted question or native notice. |
| Plain rejection and caller-step continuation | Record actual caller behavior and compare the genuine native Code Mode control. Whole-step termination is a failed/unqualified pinned-host claim, separate from the required no-write/no-peer-input gate. |
| Late allow after cancellation or target movement | No input or wake after the late reply; do not retarget or retry. |
| Configuration/model guard changes during permission wait | Refreshed guard wins; any stored question reports delivery withheld. |
| Invalid/fake/foreign destination | Reject before native delivery; locality is checked independently of an allow result. |
| Wrong Session tries to answer | Existing exact-Session rejection remains; permission to send does not change respondent ownership. |
| Native peer delivery is unconfirmed | Persisted question stays discoverable; peer-specific history records uncertainty and no automatic retry. |
| Persisted question, host restart, inbox read, authorized answer | Preserve original author, destination, association and answer attribution through actual storage/reopening. |
| Interruption after answer commit and before resume | Answer remains readable after reopening; no replay or transferred first-answer handoff. |
| Typed parent/subagent questions | Existing permission/depth/return behavior and parent-specific history remain intact. |

Component tests must exercise public plugin registration and real Loom storage.
Installed qualification must additionally exercise the unmodified pinned host's
allow/deny and exact-target behavior with only the local scripted provider.
Such qualification establishes native mechanics, not spontaneous model
question usage, direct-human approval or provider billing safety.
