---
type: Architecture
title: "Tool help is part of discovery"
description: "Describes how native tool discovery exposes useful Loom instructions."
tags: [loom, discovery, tooling]
timestamp: 2026-10-24T00:00:00Z
---

# Tool help is part of discovery

Each registered Loom tool description contains its own usage,
operation-specific inputs, returned fields, side effects, error caveats and JSON
examples. `src/tool-help.ts` is the source for that text. The plugin registers it
as actual tool metadata, not a link requiring another file read. `docs/tools.md`
remains an optional human-readable walkthrough; agents need not open it to learn
how to call a discovered tool.

The separately installed `@opencode/codemode@2.0.29` search fixture returns the
full description alongside the exact callable path and generated signature. For
example, inside Code Mode:

```js
return await search({ namespace: "loom", query: "record" })
```

An exact `query: "tools.loom.record"` retrieves that tool alone. Agents should
use the returned callable path, not guess names from underscore labels. A query
can return more tools than intended; use its returned path/signature and paging.
The initial compact catalog uses only the first description line, limited by the
host to 120 characters. Each Loom summary fits that boundary. Detailed help is
therefore available at discovery without putting every tool manual into each
role's initial instructions. Descriptions are at most 3,600 characters, except
`loom_record` (10,000) which also teaches completion, questions and full_thread;
this is a tested metadata size convention, not a tokenizer-independent limit or
control over the host's output budget.

Help includes the difference between Action and Plan revisions, full-plan
replacement, explicit context-selection side effects, full dependency-record
retrieval with Action ID (without inheriting the Worker's task filter), ledger
paging, Assessment/QA verdicts and evidence limits. Successful context reads survive
selection-save failure with a separate truthful outcome; failed clear still throws.
Action/Plan guidance is proportional: continuity across agents/Sessions can
warrant an Action, while meaningful dependencies or resumption can warrant a
Plan. OQ guidance separates fact investigation from choices beyond agent
authority; it does not create an automatic escalation or approval gate.
[Collaboration](collaboration.md) uses canonical `context_attachments` on both ask
and answer (never an `attachments` alias), manual native handling after fail-closed
question dispatch, first-answer-only best-effort resume and explicit-scope/cursor
`full_thread`. Retired assignment/delivery operations and views are not advertised.
The private `loom_review` reader preserves original review mandates and historical membership. Typed `loom_record ask` accepts structured reviews, persists and prepares them, then withholds protected delivery under the current host limits. See the [Stage 2 integration contract](learning-review-stage2.md). Fourteen tools are registered; Assessment/QA loaders require the configured role and native permission.

Use `loom_history` for selective historical investigation and its expansion/exact-source requests instead of exhaustive ledger paging. `loom_record` remains the direct reader for known records; all query views accept explicit JSON. The source-linked objective index remains optional and does not dispatch work. Live descriptions are syntax authority;
the bundled on-demand guide teaches use without eager full-guide injection.

## Await work whose result matters

Search-visible help also explains Code Mode call lifetime. Await each write before
using its saved record ID or leaving the script. For independent operations,
`Promise.allSettled` lets each settle even when another rejects; inspect every
returned status and report any failure. It is not an atomic multi-write transaction.
Dependent calls remain sequential: a question must be saved before using its ID
in an answer, and a Plan must be saved before selecting one of its nodes.

## Supported Code Mode retrieval and measurement

Use `Date.now()` for coarse elapsed milliseconds. The pinned Code Mode runtime
has no `performance.now()`, Node `process` or `Buffer`; do not assume arbitrary
browser/Node APIs. JSON Schema informs discovery signatures in this qualified
host version; Loom's runtime validation still enforces the request contract.

For a known record, retrieve only the fields needed. This example assumes search
returned `tools.loom.record`; replace both placeholders with actual returned or
verified IDs. The real Code Mode regression executes this exact snippet:

```js
// example: measured-record
const started = Date.now();
const response = JSON.parse(await tools.loom.record({
  operation: "query", action_id: "ACTION_ID", record_id: "RECORD_ID",
  projection: "fields", fields: ["statement"], response_format: "json"
}));
return { elapsed_ms: Date.now() - started, records: response.result.items };
```

`text.length` counts UTF-16 code units, not UTF-8 bytes or model tokens. Measure
UTF-8 response volume in the host harness. Response-byte reductions cannot
establish token savings. Keep measurement outside the normal task unless it is
needed; do not retrieve JSON/Markdown/HTML copies simply to compare formats.
For unknown work, use history selectors and returned navigation. All history
expand/trajectory/navigation requests include operation and required boundaries;
copy them unchanged. Exact-source objective find is not text search, and initial
population preview needs only nested selection{objective_id,question}. Preview
boundaries come from preview itself, not a live-history response.

## Tests and reproduction

`bun run test:native` checks the actual registered descriptions with role
injection disabled and no selected work. It also executes the help's JSON
examples against the real plugin callbacks and temporary SQLite state, replacing
placeholder IDs and findings. Its registration host is simulated, not a live
OpenCode Session or a model-driven Research-to-Worker acceptance run.

Main CI also installs the exact upstream `@opencode/codemode@2.0.29` package into
an isolated temporary prefix and runs its real `search` implementation against
those registrations. Tests require unchanged full descriptions, all parameter
names in generated signatures, exact-path and namespace discovery, and useful
natural-language matches. Tool execution is disabled for these search probes;
search must not create Actions, load a guide or change selection. A separate Code
Mode execution regression uses the same pinned runtime with real Loom callbacks
and temporary SQLite to check independent success/failure outcomes; it is not a
model-driven or installed-host handoff.

To reproduce that separate upstream search check:

```sh
# From the Loom checkout, after bun install --frozen-lockfile:
fixture=$(mktemp -d)
npm install --prefix "$fixture" --ignore-scripts --no-audit --no-fund @opencode/codemode@2.0.29 &&
LOOM_CODEMODE_ROOT="$fixture" bun test tests/tool-search-codemode.test.ts
# Remove the temporary fixture directory after inspecting the result.
```

Missing/wrong upstream dependency is an error, not a skipped passing check.
This dependency is test-only and installed outside Loom's frozen package tree;
its top-level version is exact, but the isolated test installation is not claimed
to have a fully frozen transitive graph. These fixture search tests passed for
Code Mode 2.0.29 only; they do not establish compatibility with Code Mode 2.0.32.
No new runtime dependency is added.
The installed-host boot test and independent two-agent acceptance retain their
existing, separate meanings. Tests of search behavior are not evidence of model
quality or successful end-to-end delegation.

The separate [public-tool usability qualification](tool-usability.md) records
fresh investigators, actual failed calls and returned bytes, schema/runtime
agreement, independent review and the limits of the baseline comparison.

Pinned sources:
- [Tool-to-Code-Mode registration](https://github.com/anomalyco/opencode/blob/v2.0.29/packages/core/src/codemode/tool.ts)
- [Search results and ranking](https://github.com/anomalyco/opencode/blob/v2.0.29/packages/codemode/src/tool-runtime.ts)
- [Compact catalog summaries](https://github.com/anomalyco/opencode/blob/v2.0.29/packages/core/src/codemode/catalog.ts)


## Open Question usage

The namespace and record summary name Open Questions explicitly. Routed examples
use `recipient`; legacy `to_agent` is manual-only for text, not new choices.
Each registered ask example labels its primary or child Session context. The
multiple-choice example uses a primary-capable role; dispatcher examples are
child-only. Regression tests execute every ask and its attributed answer.
Configured role guidance names `loom_record operation=ask`, required fields and
when another owner's input is needed. It preserves opt-outs and does not require
an OQ for every uncertainty. See [structured questions](structured-questions.md)
for the reproduced example defect and limits of the usage investigation.
