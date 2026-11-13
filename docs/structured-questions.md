---
type: Architecture
title: "Structured Open Questions"
description: "Single-choice answers in the existing OQ protocol and evidence limits for question usage."
tags: [loom, collaboration, questions]
timestamp: 2026-11-13T00:00:00Z
---

# Structured Open Questions

An agent can present explicit alternatives and the intended respondent can select
one stable ID. This extends `loom_record` rather than adding a tool, database,
question lifecycle or dispatcher. Format and recipient remain separate. General
may consult Evaluator for a comparison; a recommendation does not gain the
Architect's decision authority or replace a genuine user decision.

## Public contract

```json
{"operation":"ask","question":"Which approach fits the agreed constraints?","answer_type":"multi-choice","choices":[{"id":"A","answer":"Keep the current approach"},{"id":"B","answer":"Use the proposed approach"}],"recipient":{"kind":"role","id":"research"},"blocking":true}
```

This primary-Session example requires a single eligible `research` role discovered
through `loom_agents`. In a child Session, `recipient:{kind:"dispatcher"}` can
instead address its native parent. A primary Session has no dispatcher. User
questions still need native user interaction; Loom does not fabricate a reply.
Neither an Action nor a Plan is required.

```json
{"operation":"answer","question_id":"QUESTION_ID","choice_id":"B","reason":"Evidence and limitations supporting this recommendation."}
```

The reason is optional for a selection. The server validates the ID against the
original stored question and copies its original label into `data.answer`.
Respondents do not resubmit or rewrite that label. Existing consumers therefore
retain readable answer text alongside `choice_id` and the separate `reason`.

```json
{"operation":"answer","question_id":"QUESTION_ID","status":"cannot-select","reason":"Neither alternative satisfies the required guarantee."}
```

`cannot-select` requires a reason and prohibits both `choice_id` and `answer`.
It is a response, not a selected option, resolution or approval. It can be the
first response that wakes the asker under the existing protocol. A subsequent
selection does not gain a second Loom wake. The caller must retrieve the thread
and decide what safe work can continue; do not repeat an answer to retry delivery.

Omitted `answer_type`, or explicit `text`, keeps existing text questions and
`answer` responses. Text questions reject choice/status/reason fields. Choice
questions reject free-text `answer` submissions and mixtures of answer forms.
`context_attachments` remains available on all response forms.

New multiple-choice questions require a typed `recipient`; `to_agent` remains
manual-only for text questions. This keeps every new selection on the existing
respondent-identity checks without adding authority to legacy addressing. Earlier
draft v1 multiple-choice records and their answers remain readable and unchanged,
but reject new replies: recreate the question with a typed recipient and a new ID.
Historical manual responses are not retroactively verified. Typed identity still
does not certify that a relayed user decision actually came from the user.

Multiple-choice means **one selection**, not multi-select. Bounds are 2–20
choices; unique, case-sensitive IDs of 1–64 ASCII letters, digits, `_`, `.`, `:`
or `-`, beginning with a letter or digit; nonblank labels of at most 4,000
Unicode code points; and nonblank reasons of at most 8,000 Unicode code points.
Counts apply before trimming; labels retain their exact original bytes/string.
The schema and runtime both reject whitespace-only new fields. Legacy text limits
are unchanged; combining marks count separately, not as display graphemes. Existing combined
record/read budgets also apply. Duplicate IDs, unknown IDs, unknown fields,
malformed choices and invalid combinations fail before appending an answer or
contacting a recipient. The public schema checks shapes; the Store checks the
original question type, IDs and respondent identity inside the answer transaction.

Questions and their choices are append-only. Changed alternatives require a new
question; never reuse an old question ID with a changed meaning. Multiple answers,
including conflicting selections, remain separately attributed and paginated.
The latest preview is not an automatically accepted winner. `view:thread` retains
all options/replies; bounded context shows type, choice count and selected ID or
cannot-select status, with ordinary excerpt/omission notices. `full_thread`
retains the complete stored objects through its existing escaped renderer.

No schema migration is needed. Old text rows remain unchanged. New structured
rows use the existing question/answer record formats and always retain readable
answer text. Older binaries do not support creating/selecting these questions;
use the installed tool schema rather than assuming an old writer understands them.

## Why questions may appear to have disappeared

Investigation baseline: `b235ed712b471fd25fc9b0ec12eb805f0e5ad4be`.

**Confirmed guidance defect:** both advertised ask examples in
`src/tool-help.ts`, and the bundled Loom guide's example, used legacy `to_agent`.
That path deliberately stores a question without contacting anyone. A regression
executing the advertised example against actual plugin callbacks/SQLite failed
with `not-attempted`; after changing to a configured `recipient` role it obtains
native admission through the simulated host and an attributed answer. Legacy
manual addressing remains supported and separately tested.

**Confirmed instruction gap, unproven behavioral effect:** injected guidance
said to ask the owner but did not name the ask operation or its required fields.
The namespace description omitted Open Questions. Current guidance names the
operation, recipient and blocking fields; discovery presents routed examples and
structured selections. It does not mandate questions for routine work, change
configuration opt-outs, inject into unconfigured agents or automatically choose
Evaluator. Real Code Mode discovery still found the tool before these changes;
complete tool disappearance is not supported by that counterevidence.

These defects do **not** establish why a particular user's question count went
from tens to zero. Original before/after Sessions and installed configuration were
not available. No spontaneous-use or real-model improvement is claimed.
Distinguish these paths before attributing the reduction:

- **No ask call:** verify plugin/version, actual registered tools, effective
  `instructions.enabled`, native agent IDs, enabled agents with nonempty roles,
  and configuration errors. Inspect what instructions the actual Session received.
  A configured roster entry is not proof that its guidance reached that Session.
- **Stored question but no contact:** inspect its dispatch annotation. Legacy
  `to_agent`, missing/ambiguous recipients, depth/permission rejection and the
  unqualified managed-model-routing guard have different causes. Do not disable
  safety/billing guards to increase question counts.
- **Missing from a view:** Action-scoped question views omit Session-only work;
  follow the exact question thread or authorized Session `full_thread`, including
  every cursor. Outer Code Mode call counts alone can hide inner ask operations.

For a useful before/after comparison, preserve the exact Loom/host versions,
configuration diagnostics from `loom_agents`, delivered guidance where observable,
and authorized original parent/child source records. Count opportunities for a
material question, actual asks, dispatch outcomes and attributed answers separately.
Neither a successful scripted dispatch nor a higher question count proves better
engineering. Privacy-preserving counts/IDs are preferable to public transcripts.

## Verification and limits

`question-choices.test.mjs` exercises SQLite validation, immutable labels,
free-text compatibility, limits, failure atomicity, first-answer behavior and
bounded preview/readback. `question-choices-native.test.ts` exercises real plugin
callbacks with a simulated host, including bound-child and forwarded-sibling
checks. `question-discovery-native.test.ts` executes the advertised example and
checks delivered guidance/opt-outs and executes every advertised ask in its
labelled primary/child Session context. The native string-schema test compares
the actual registered fragments using Effect's JSON Schema importer with the
real callbacks. `tool-search-codemode.test.ts` uses the real pinned Code Mode
runtime for discovery and execution. JSON Schema in Code Mode is signature
metadata, not an input validator; those negative calls prove runtime rejection,
not schema enforcement by Code Mode.

`installed_question_choices.py` installs the exact package into an isolated
OpenCode 2.2.6 host and uses the existing local scripted provider. It checks native
child selection, rejection, abstention/conflicts and process-restart readback.
It also rejects new legacy choices and exercises Unicode label/reason boundaries.
Its provider deterministically selects the second option: that is not Evaluator
reasoning, human consent, independent review or evidence of restored spontaneous
question use. Fixture presence is not a passing run; consult the PR's execution
record for actual results. Existing routing/resume and trust tests remain required.

This change is based on main, not the separate review-mandate work in draft PR
#233. Both change the ask schema; integration must reconcile those additions
without bypassing that PR's protected-review delivery boundary.
