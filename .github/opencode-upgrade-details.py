from pathlib import Path

# Temporary upgrade preparation only. The final branch removes this script.
for name in ['docs/installed-host-validation.md', 'docs/tool-discovery.md']:
    p = Path(name)
    p.write_text(p.read_text().replace('2.0.18', '2.0.29'))
p = Path('docs/installed-host-validation.md')
p.write_text(p.read_text().replace('SDK target. It does not upgrade', 'SDK target. Loom dependencies use frozen installation in this job too. The external\nCLI has an exact top-level version, not a fully locked dependency graph. It does not upgrade'))
p = Path('docs/tool-discovery.md')
p.write_text(p.read_text().replace('## Tests and reproduction\n', '''## Await work whose result matters

Search-visible help also explains Code Mode call lifetime. Await each write before
using its saved record ID or leaving the script. For independent operations,
`Promise.allSettled` lets each settle even when another rejects; inspect every
returned status and report any failure. It is not an atomic multi-write transaction.
Dependent calls remain sequential: a question must be saved before using its ID
in an answer, and a Plan must be saved before selecting one of its nodes.

## Tests and reproduction
''').replace('search must not create Actions, load a guide or change selection.', 'search must not create Actions, load a guide or change selection. A separate Code\nMode execution regression uses the same pinned runtime with real Loom callbacks\nand temporary SQLite to check independent success/failure outcomes; it is not a\nmodel-driven or installed-host handoff.'))

p = Path('tests/package-entry.test.ts')
p.write_text(p.read_text() + '''

test("SDK, installed host, search fixture and boot default share the exact OpenCode pin", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))
  const version = pkg.dependencies["@opencode/plugin"]
  expect(version).toBe("2.0.29")
  const installed = JSON.parse(await readFile(new URL("../node_modules/@opencode/plugin/package.json", import.meta.url), "utf8"))
  expect(installed.version).toBe(version)
  const ci = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8")
  const host = await readFile(new URL("../.github/workflows/installed-host.yml", import.meta.url), "utf8")
  const search = await readFile(new URL("./tool-search-codemode.test.ts", import.meta.url), "utf8")
  const smoke = await readFile(new URL("./installed_host_smoke.py", import.meta.url), "utf8")
  expect(ci).toContain(`@opencode/codemode@${version}`)
  expect(host).toContain(`@opencode/cli@${version}`)
  expect(host).toContain(`--expect-version ${version}`)
  expect(search).toContain(`metadata.version !== "${version}"`)
  expect(smoke).toContain(`"--expect-version", default="${version}"`)
  for (const workflow of [ci, host]) {
    expect(workflow).toContain("bun install --frozen-lockfile")
    expect(workflow).toContain("git diff --exit-code -- bun.lock")
    expect(workflow).not.toMatch(/run: bun install\\s*$/m)
  }
})
''')

p = Path('tests/tool-help-native.test.ts')
p.write_text(p.read_text().replace('import { test, expect } from "bun:test"', 'import { test, expect } from "bun:test"\nimport { writeFile } from "node:fs/promises"\nimport { join } from "node:path"') + '''

test("search-visible help explains awaited writes and independent-call failure handling", async () => {
  const f = await registeredLoom()
  try {
    expect(f.tools.size).toBe(5)
    for (const tool of f.tools.values()) {
      expect(tool.description).toContain("Await writes before using IDs or ending Code Mode")
      expect(tool.description).toContain("Promise.allSettled and inspect every outcome")
      expect(tool.description).toContain("sequence dependent calls")
    }
  } finally { await f.close() }
})

test("Loom context injection preserves host generation options and native tool definitions", async () => {
  const f = await registeredLoom()
  try {
    await writeFile(join(f.directory, ".loom.yaml"), "agents: {author: {roles: [implementation]}}\\n")
    const action = (await f.invoke("action", { operation: "create", title: "Host defaults", goal: "Keep native generation settings" })).result
    const options = { maxTokens: 4096, temperature: 0.2 }
    const nativeTools = { native: { description: "Native tool", input: { type: "object" } } }
    const native = { type: "text", text: "Existing system instructions" }
    const event = { sessionID: "s", agent: "author", system: [native], messages: [], options, tools: nativeTools }
    await f.hooks.get("context")(event)
    expect(event.options).toBe(options)
    expect(event.options).toEqual({ maxTokens: 4096, temperature: 0.2 })
    expect(event.tools).toBe(nativeTools)
    expect(event.system[0]).toBe(native)
    expect(event.system.some(part => part.text.includes(action.id))).toBe(true)
  } finally { await f.close() }
})
''')

p = Path('tests/tool-search-codemode.test.ts')
p.write_text(p.read_text().replace('const { CodeMode, Namespace, Tool } =', 'const { CodeMode, Namespace, Tool, toolError } =') + '''

test("actual Code Mode allSettled preserves an independent write and exposes the failed write", async () => {
  const f = await registeredLoom()
  try {
    const action = (await f.invoke("action", { operation: "create", title: "Independent calls", goal: "Keep successful work visible" })).result
    const tools = Object.fromEntries([...f.tools].map(([name, tool]) => [name, Tool.make({
      description: tool.description, input: tool.input, output: { type: "string" },
      execute: (input: unknown) => Effect.tryPromise({
        try: async () => JSON.stringify(await f.invoke(name, input)),
        catch: (error: unknown) => toolError(error instanceof Error ? error.message : String(error)),
      }),
    })]))
    const runtime = CodeMode.make({ tools: { loom: Namespace.make({ description: f.namespaces.get("loom").description, tools }) } })
    const bad = { operation: "add", action_id: "missing-action", kind: "result", statement: "This must not be saved" }
    const good = { operation: "add", action_id: action.id, kind: "result", statement: "Successful independent work remains available" }
    const result = await Effect.runPromise(runtime.execute(`
      const outcomes = await Promise.allSettled([
        tools.loom.record(${JSON.stringify(bad)}),
        tools.loom.record(${JSON.stringify(good)})
      ]);
      return outcomes.map(outcome => outcome.status === "fulfilled"
        ? {status: outcome.status, record_id: JSON.parse(outcome.value).result.id}
        : {status: outcome.status});
    `))
    expect(result.ok).toBe(true)
    expect(result.value[0].status).toBe("rejected")
    expect(result.value[1].status).toBe("fulfilled")
    const saved = (await f.invoke("record", { operation: "query", action_id: action.id })).result.items
    expect(saved).toHaveLength(1)
    expect(saved[0].id).toBe(result.value[1].record_id)
    expect(saved[0].data.statement).toBe(good.statement)
  } finally { await f.close() }
})
''')

Path('docs/opencode-2.0.29.md').write_text('''# OpenCode 2.0.29 compatibility and opportunities

## Version scope

Loom pins `@opencode/plugin` to **2.0.29**. The isolated Code Mode fixture and
installed CLI probe target the same version. `bun.lock` was regenerated by Bun
1.4.2 from the existing lock, then checked with frozen installation; no integrity
hashes were hand-edited. The Bun baseline and model selection are unchanged.
This repository change does not upgrade the user's local OpenCode executable.

The upstream tag resolves to `042d0832f5f3a73eaa039a58a7d565776f6d4290`.
On 2026-10-15 the npm CLI package reported `latest: 2.0.29`; GitHub's stable
release endpoint still reported v1.19.0. The exact V2 tag and packages are the
basis for this pin, not a moving latest alias.

Both CI jobs now use frozen installation for Loom dependencies. External host
and search fixtures still use exact top-level versions rather than a fully
locked transitive graph. Required transitive changes include Effect moving from
`4.0.0-rc.112` to `4.0.1`; this is not just a version-label edit. The parser and
development-tool pins, ledger schema, history and observation semantics are
unchanged by this upgrade. Historical reports citing v2.0.18 retain their evidence.

## Relevant upstream changes and decisions

This is a focused source comparison, not a complete review of every intervening
commit or a model-quality benchmark.

**Tool errors.** Promise tools and before hooks now convert ordinary rejections
into `Tool.Error`; model-request handling preserves native permission/question
declines. Take the SDK fix through the upgrade. Retain Loom's native-error
projection and non-blocking observer handling. Callback tests do not establish
real model-driven error recovery.

**Shared host modules.** Runtime provisioning supplies supported `effect` and
`@opencode/plugin` modules and rejects unsupported foreign copies. Keep supported
imports and the exact SDK target. The installed-host boot checks the normal load
path; do not vendor another SDK or add dummy entrypoints.

**Awaited independent work.** Code Mode now recommends `Promise.allSettled` for
independent calls. Search-visible Loom help tells agents to await writes, inspect
every outcome and sequence dependent calls. A regression runs the actual pinned
Code Mode implementation with real callbacks and temporary SQLite: one write
fails while the other remains saved. It is not an atomic multi-write transaction.

**Native generation policy.** Primary/compaction requests now expose an initial
`maxTokens` allowance to hooks; the runner handles output-limit continuations.
Loom leaves those policies with OpenCode. A regression checks that its context
injection preserves native generation options and tool definitions.

**New Session controls.** The Promise API adds `remove` and `compact`. Do not
adopt automatic Session deletion or compaction: neither is a notification
primitive or an alpha requirement.

**Evidence identity.** Tool-hook identifiers and the native inbox schema and
implementation are unchanged in the inspected files. Code Mode still passes
outer call context to nested tools. Keep conservative pairing; richer progress
output is not a new authoritative invocation identity.

## Passive notifications remain a separate candidate

Synthetic input still enters the native inbox before the `resume:false` check.
An ordinary running drain can still promote queued input at its next input
boundary. Skipping an explicit wake is not a no-additional-step guarantee.
This upgrade does not enable native-inbox notifications.

The agreed candidate is a Loom-owned, immutable Session-addressed notice,
available independently of Action selection and inserted only during an
already-requested context preparation. It must never submit execution input.

- **Stored for Session:** durably available while the record is retained.
- **Presented in context:** included in prepared context, not proof of a successful
  model request, consumption, acknowledgement or resolution.
- **Admitted to native inbox:** reserved for separately authorized transport.

Durable availability does not imply timely presentation. A Session that never
runs again cannot encounter the notice. Routing, attempt history, coordinator
fallback and bounded Session-wide discovery remain requirements. The notice
feature is not implemented or accepted by this upgrade.

## Verification boundaries

The preparation run regenerated the lock, ran SDK/core/native/Python/search
checks and booted the published 2.0.29 CLI in isolated state. The generated
changes are reviewed before publication. Temporary preparation files are removed
from the final tree; ordinary CI validates the committed upgrade again.

A version regression checks the installed SDK, CI pins, search harness and boot
probe default. Registered-help size limits and the five-tool count remain tested.
The additional Code Mode execution check uses a simulated registration host and
an Effect callback bridge, not the real installed provider or Promise adapter.

The boot probe still establishes loading and equivalent intact **empty** ledger
checks across restart/removal. It does not establish meaningful-record handoff,
passive presentation under concurrent host activity, graceful shutdown or manual
backup/restore. Source inspection is not installed-host behavioural acceptance.

The concurrent `efe6683` review corrections are preserved, including failure
capture, selection-independent recovery and CI mutation counterchecks. The
successful-read/failed-selection-save issue remains separate. Keep PR #180 draft;
independent acceptance and the real Research-to-Worker scenario remain open.
No whole-process resource guarantee or execution machinery is added.

## Pinned sources

- [Promise adapter](https://github.com/anomalyco/opencode/blob/v2.0.29/packages/plugin/src/promise/adapter.ts)
- [Host module provisioning](https://github.com/anomalyco/opencode/blob/v2.0.29/packages/plugin/src/runtime.ts)
- [Code Mode](https://github.com/anomalyco/opencode/blob/v2.0.29/packages/core/src/codemode/tool.ts)
- [Request construction](https://github.com/anomalyco/opencode/blob/v2.0.29/packages/core/src/session/model-request.ts)
- [Runner](https://github.com/anomalyco/opencode/blob/v2.0.29/packages/core/src/session/runner/llm.ts)
- [Promise Session API](https://github.com/anomalyco/opencode/blob/v2.0.29/packages/plugin/src/promise/session.ts)
- [Synthetic admission](https://github.com/anomalyco/opencode/blob/v2.0.29/packages/core/src/session/session.ts)
- [Native inbox](https://github.com/anomalyco/opencode/blob/v2.0.29/packages/core/src/session/inbox.ts)
''')
