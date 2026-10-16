# Tool help is part of discovery

Each of Loom's five registered tool descriptions now contains its own usage,
operation-specific inputs, returned fields, side effects, error caveats and JSON
examples. `src/tool-help.ts` is the source for that text. The plugin registers it
as actual tool metadata, not a link requiring another file read. `docs/tools.md`
remains an optional human-readable walkthrough; agents need not open it to learn
how to call a discovered tool.

The pinned OpenCode 2.0.29 Code Mode search returns the full description alongside
the exact callable path and generated signature. For example, inside Code Mode:

```js
return await search({ namespace: "loom", query: "record" })
```

An exact `query: "tools.loom.record"` retrieves that tool alone. Agents should
use the returned callable path, not guess names from underscore labels. A query
can return more tools than intended; use its returned path/signature and paging.
The initial compact catalog uses only the first description line, limited by the
host to 120 characters. Each Loom summary fits that boundary. Detailed help is
therefore available at discovery without putting all five manuals into every
role's initial instructions. Descriptions are at most 3,600 characters, except
`loom_record` (6,000) which also teaches completion and question operations;
this is a tested metadata size convention, not a tokenizer-independent limit or
control over the host's output budget.

Help includes the difference between Action and Plan revisions, full-plan
replacement, explicit context-selection side effects, full dependency-record
retrieval with Action ID (without inheriting the Worker's task filter), ledger
paging, Assessment/QA verdicts and evidence limits. It documents the currently
unfixed selection-save failure rather than promising the proposed partial-result
behavior. Discovery alone does not implement that fix. The subsequent
[completion and question extension](collaboration.md) adds operations to the
existing record tool and views to context, not a sixth tool or execution engine.

## Await work whose result matters

Search-visible help also explains Code Mode call lifetime. Await each write before
using its saved record ID or leaving the script. For independent operations,
`Promise.allSettled` lets each settle even when another rejects; inspect every
returned status and report any failure. It is not an atomic multi-write transaction.
Dependent calls remain sequential: a question must be saved before using its ID
in an answer, and a Plan must be saved before selecting one of its nodes.

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
to have a fully frozen transitive graph. No new runtime dependency is added.
The installed-host boot test and independent two-agent acceptance retain their
existing, separate meanings. Tests of search behavior are not evidence of model
quality or successful end-to-end delegation.

Pinned sources:
- [Tool-to-Code-Mode registration](https://github.com/anomalyco/opencode/blob/v2.0.29/packages/core/src/codemode/tool.ts)
- [Search results and ranking](https://github.com/anomalyco/opencode/blob/v2.0.29/packages/codemode/src/tool-runtime.ts)
- [Compact catalog summaries](https://github.com/anomalyco/opencode/blob/v2.0.29/packages/core/src/codemode/catalog.ts)
