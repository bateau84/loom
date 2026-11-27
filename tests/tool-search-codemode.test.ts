import { test, expect } from "bun:test"
import { createRequire } from "node:module"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { registeredLoom } from "./helpers/registered-loom.js"

// Isolated exact upstream test dependency; not a new Loom runtime dependency.
const root = process.env.LOOM_CODEMODE_ROOT
if (!root) throw new Error("Set LOOM_CODEMODE_ROOT to an isolated npm prefix containing @opencode/codemode@2.0.29; see docs/architecture/spec/ars-013-tool-discovery.md")
const packageRoot = join(root, "node_modules/@opencode/codemode")
const metadata = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"))
if (metadata.version !== "2.0.29") throw new Error(`Expected Code Mode 2.0.29, found ${metadata.version}`)
// Test the published compiled implementation, not the source-manifest export.
// The pinned build emits src/index.ts to dist/index.js; a missing build is fatal.
const entry = join(packageRoot, "dist/index.js")
const { CodeMode, Namespace, Tool, toolError } = await import(pathToFileURL(entry).href)
const effectReq = createRequire(entry)
const { Effect } = await import(pathToFileURL(effectReq.resolve("effect")).href)

async function withSearch(run: (search: (input: unknown) => Promise<any>, f: Awaited<ReturnType<typeof registeredLoom>>) => Promise<void>) {
  const f = await registeredLoom()
  try {
    const tools = Object.fromEntries([...f.tools].map(([name, tool]) => [name, Tool.make({
      description: tool.description, input: tool.input, output: { type: "string" },
      execute: () => Effect.die(new Error("Discovery must not execute a Loom tool")),
    })]))
    // This is the actual pinned search implementation, fed registrations from the
    // real plugin. Host registration is simulated; no model or live CLI is used.
    const runtime = CodeMode.make({ tools: { loom: Namespace.make({ description: f.namespaces.get("loom").description, tools }) } })
    const search = async (input: unknown) => {
      const result = await Effect.runPromise(runtime.execute(`return await search(${JSON.stringify(input)})`))
      expect(result.ok).toBe(true)
      expect(result.truncated).not.toBe(true)
      expect(result.toolCalls).toEqual([{ name: "search" }])
      return result.value
    }
    await run(search, f)
  } finally { await f.close() }
}

test("actual Code Mode search returns each full registered description and callable signature within response budgets", async () => {
  // UTF-8 bytes of the complete serialized search reply, including generated
  // signatures. Description-only ceilings cannot catch schema expansion.
  const maximumBytes: Record<string, number> = { history: 8000, objective: 7200, review: 18000, record: 16500 }
  await withSearch(async (search, f) => {
    for (const [name, registration] of f.tools) {
      const result = await search({ query: `tools.loom.${name}` })
      expect(result.items).toHaveLength(1)
      expect(result.items[0].path).toBe(`tools.loom.${name}`)
      expect(result.items[0].description).toBe(registration.description)
      expect(result.items[0].signature).toContain(`tools.loom.${name}(`)
      if (Object.hasOwn(maximumBytes, name))
        expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThanOrEqual(maximumBytes[name]!)
      for (const key of Object.keys(registration.input.properties)) expect(result.items[0].signature).toContain(key)
    }
  })
})

test("namespace search carries the complete current tool inventory without file reads, selected work or injected roles", async () => {
  await withSearch(async (search, f) => {
    const result = await search({ namespace: "loom", limit: f.tools.size })
    expect(result.items).toHaveLength(f.tools.size)
    expect(result.remaining).toBe(0)
    // The measured fourteen-tool candidate reply is 82,262 UTF-8 bytes.
    // Keep bounded room for wording; this is not a model-token budget.
    expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThanOrEqual(84000)
    for (const item of result.items) {
      const name = item.path.split(".").at(-1)
      expect(item.description).toBe(f.tools.get(name).description)
      expect(item.description).toContain("Examples (JSON inputs")
    }
  })
})

test("actual search exposes canonical questions and full-thread continuation, not retired routes", async () => {
  await withSearch(async search => {
    const result = await search({ query: "tools.loom.record" })
    const record = result.items[0]
    for (const field of ["question", "to_agent", "blocking", "context_attachments", "reference", "question_id", "answer", "session_id", "cursor"])
      expect(record.signature).toContain(field)
    for (const text of ["attachments/old aliases are invalid", "policy-capability-unavailable", "FIRST committed", "No retries", "full_thread", "next_cursor", "not perpetual", "readable Markdown by default", "history remains inert"])
      expect(record.description).toContain(text)
    const examples = record.description.split("\n").filter((s: string) => s.startsWith("{")).map((s: string) => JSON.parse(s))
    const ask = examples.find((e: any) => e.operation === "ask" && e.reference)
    const answer = examples.find((e: any) => e.operation === "answer")
    expect(ask.context_attachments).toEqual(["RECORD_ID"])
    expect(answer.context_attachments).toEqual(["SOURCE_REFERENCE"])
    for (const input of [ask, answer]) expect(input).not.toHaveProperty("attachments")
    for (const retired of ["assign", "authorize-continuation", "withdraw-continuation", "retry-delivery"])
      expect(examples.some((e: any) => e.operation === retired)).toBe(false)
    for (const retired of ["assignments", "deliveries"])
      expect(examples.some((e: any) => e.view === retired)).toBe(false)
  })
})

test("task-language discovery finds record and recovery help, including the dependency filter warning", async () => {
  await withSearch(async search => {
    const records = await search({ namespace: "loom", query: "dependency history QA", limit: 5 })
    const record = records.items.find((item: any) => item.path === "tools.loom.record")
    expect(record?.description).toContain("action_id without node_id searches the whole Action")
    const recovery = await search({ namespace: "loom", query: "recover handoff restart", limit: 5 })
    expect(recovery.items.some((item: any) => item.path === "tools.loom.context" && item.description.includes("task-not-in-current-plan"))).toBe(true)
  })
})

test("Plan search carries the field guide and complete three-task example, not just a signature", async () => {
  await withSearch(async (search, f) => {
    const result = await search({ query: "tools.loom.plan" })
    expect(result.items).toHaveLength(1)
    const help = result.items[0].description
    expect(help).toBe(f.tools.get("plan").description)
    for (const text of ["Plan is not a scheduler", "Nodes are a flat list", "criteria: list of observable completion conditions", "siblings do not automatically depend on each other", "Action and Plan revisions are separate", "whole current list, not a patch", "ledger remembers what was found or done"]) expect(help).toContain(text)
    const examples = help.split("\n").filter((s: string) => s.startsWith("{")).map((s: string) => JSON.parse(s))
    const save = examples.find((e: any) => e.operation === "save")
    expect(save.expected_revision).toBe(0)
    expect(save.nodes).toHaveLength(3)
    expect(save.nodes[1].depends_on).toEqual([save.nodes[0].id])
    expect(save.nodes[2].depends_on).toEqual([save.nodes[1].id])
    const discovery = await search({ namespace: "loom", query: "acceptance criteria intended work", limit: 5 })
    expect(discovery.items.some((item: any) => item.path === "tools.loom.plan" && item.description === help)).toBe(true)
  })
})


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
    // Reproduce the failed agent request through Code Mode, including the parallel Plan read.
    const read = await Effect.runPromise(runtime.execute(`
      const [rev, p] = await Promise.all([
        tools.loom.record({operation:"query",action_id:${JSON.stringify(action.id)},record_id:${JSON.stringify(saved[0].id)},response_format:"json"}),
        tools.loom.plan({operation:"read",action_id:${JSON.stringify(action.id)}})
      ]);
      return {record: JSON.parse(rev).result.items[0], nodes: JSON.parse(p).result.nodes};
    `))
    expect(read.ok).toBe(true)
    expect(read.value.record.id).toBe(saved[0].id)
    expect(read.value.record.data.statement).toBe(good.statement)
    expect(read.value.nodes).toEqual([])
  } finally { await f.close() }
})


test("documented Code Mode companion example preserves Markdown and reports partial failures", async () => {
  const f = await registeredLoom()
  try {
    await writeFile(join(f.directory, ".loom.yaml"), JSON.stringify({
      agents: { critic: { roles: ["qa"] }, reviewer: { roles: ["assessment"] } },
      instructions: { enabled: false }, ledger: { capture: "off" },
    }))
    for (const id of ["one", "two"]) {
      const directory = join(f.directory, id)
      await mkdir(directory)
      await writeFile(join(directory, "SKILL.md"), "# Skill\n")
      await writeFile(join(directory, "QA.md"), "# QA " + id + "\n\nChallenge " + id + ".\n")
      await writeFile(join(directory, "ASSESSMENT.md"), "# Assessment " + id + "\n\nAssess " + id + ".\n")
      f.skills.set(id, { id, path: join(directory, "SKILL.md") })
    }
    for (const [lens, agent] of [["qa", "critic"], ["assessment", "reviewer"]] as const) {
      const registration = f.tools.get(lens)
      const example = registration.description.match(/```javascript\n([\s\S]*?)\n```/)?.[1]
      expect(example).toBeDefined()
      const code = example!.replace('["SKILL_ID_1", "SKILL_ID_2"]', '["one", "missing", "two"]')
      expect(code).not.toBe(example)
      const runtime = CodeMode.make({ tools: { loom: Namespace.make({
        description: f.namespaces.get("loom").description,
        tools: { [lens]: Tool.make({
          description: registration.description, input: registration.input, output: { type: "string" },
          execute: (input: unknown) => Effect.tryPromise({
            try: async () => (await registration.execute(input, {
              sessionID: "review-session", agent, id: "tool-call", messageID: "message",
              signal: new AbortController().signal,
            })).content,
            catch: (error: unknown) => toolError(error instanceof Error ? error.message : String(error)),
          }),
        }) },
      }) } })
      const result = await Effect.runPromise(runtime.execute(code))
      expect(result.ok).toBe(true)
      expect(result.truncated).not.toBe(true)
      expect(typeof result.value).toBe("string")
      const output = result.value as string
      const label = lens === "qa" ? "QA" : "Assessment"
      expect(output).toContain("# " + label + " lens\n")
      expect(output).toContain("**Skill:** `one`")
      expect(output).toContain("**Skill:** `two`")
      expect(output).toContain("**SHA-256:**")
      expect(output).toContain("# " + label + " lens failed: missing")
      expect(output).toContain("Expected one registered native skill with ID missing; found 0")
      expect(output.indexOf("**Skill:** `one`")).toBeLessThan(output.indexOf("# " + label + " lens failed: missing"))
      expect(output.indexOf("# " + label + " lens failed: missing")).toBeLessThan(output.indexOf("**Skill:** `two`"))
      expect(output).not.toContain("\\n")
      expect(() => JSON.parse(output)).toThrow()
      expect(f.sessionCreates).toHaveLength(0)
    }
  } finally { await f.close() }
})

test("Open Question discovery and actual Code Mode accept typed choices and reject mixed answer shapes", async () => {
  const f = await registeredLoom()
  try {
    const tools = Object.fromEntries([...f.tools].map(([name, tool]) => [name, Tool.make({
      description: tool.description, input: tool.input, output: { type: "string" },
      execute: (input: unknown) => Effect.tryPromise({
        try: async () => JSON.stringify(await f.invoke(name, input)),
        catch: (error: unknown) => toolError(error instanceof Error ? error.message : String(error)),
      }),
    })]))
    const runtime = CodeMode.make({ tools: { loom: Namespace.make({ description: f.namespaces.get("loom").description, tools }) } })
    const search = await Effect.runPromise(runtime.execute('return await search({namespace:"loom",query:"Open Question choices",limit:5})'))
    expect(search.ok).toBe(true)
    const found = search.value.items.find((item: any) => item.path === "tools.loom.record")
    expect(found.description).toContain("cannot-select")
    for (const field of ["answer_type", "choices", "choice_id", "reason"]) expect(found.signature).toContain(field)
    // Native user interaction stays manual in the primary session; its response is
    // attributed, not magically certified as a genuine human decision.
    const ask = { operation: "ask", question: "Which option?", recipient: { kind: "user" }, blocking: false,
      answer_type: "multi-choice", choices: [{ id: "A", answer: "Keep" }, { id: "B", answer: "Replace" }] }
    const result = await Effect.runPromise(runtime.execute(`
      const q=JSON.parse(await tools.loom.record(${JSON.stringify(ask)})).result;
      const invalids=[
        {operation:"answer",question_id:q.id},
        {operation:"answer",question_id:q.id,choice_id:"A",answer:"Keep"},
        {operation:"answer",question_id:q.id,status:"cannot-select"},
        {operation:"answer",question_id:q.id,status:"cannot-select",reason:"Missing evidence",choice_id:"A"},
        {operation:"answer",question_id:q.id,choice_id:"Z"},
        {...${JSON.stringify(ask)},answer_type:"text"},
        {...${JSON.stringify(ask)},choices:undefined}
      ];
      const rejected=await Promise.allSettled(invalids.map(input=>tools.loom.record(input)));
      const before=JSON.parse(await tools.loom.record({operation:"query",view:"thread",question_id:q.id})).result;
      const a=JSON.parse(await tools.loom.record({operation:"answer",question_id:q.id,choice_id:"B",reason:"Existing requirement"})).result;
      const abstain=JSON.parse(await tools.loom.record({operation:"answer",question_id:q.id,status:"cannot-select",reason:"New uncertainty"})).result;
      const legacy=JSON.parse(await tools.loom.record({operation:"ask",question:"Text?",to_agent:"manual",blocking:false})).result;
      const text=JSON.parse(await tools.loom.record({operation:"answer",question_id:legacy.id,answer:"Still supported"})).result;
      return {q,a,abstain,text,before:before.answers.length,statuses:rejected.map(r=>r.status)};
    `))
    expect(result.ok).toBe(true)
    expect(result.value.statuses).toEqual(Array(7).fill("rejected"))
    expect(result.value.before).toBe(0)
    expect(result.value.a.data).toMatchObject({ choice_id: "B", answer: "Replace", reason: "Existing requirement" })
    expect(result.value.abstain.data.status).toBe("cannot-select")
    expect(result.value.text.data.answer).toBe("Still supported")
    expect(result.value.q.data.choices).toEqual(ask.choices)
    expect(f.sessionCreates).toHaveLength(0)
  } finally { await f.close() }
})

test("real Code Mode carries Unicode boundaries and runtime rejects invalid choices/reasons", async () => {
  const f = await registeredLoom()
  let callbacks = 0
  try {
    const tools = Object.fromEntries([...f.tools].map(([name, tool]) => [name, Tool.make({
      description: tool.description, input: tool.input, output: { type: "string" },
      execute: (input: unknown) => Effect.tryPromise({
        try: async () => { callbacks++; return JSON.stringify(await f.invoke(name, input)) },
        catch: (error: unknown) => toolError(error instanceof Error ? error.message : String(error)),
      }),
    })]))
    const runtime = CodeMode.make({ tools: { loom: Namespace.make({ description: f.namespaces.get("loom").description, tools }) } })
    const valid = await Effect.runPromise(runtime.execute(`
      const label="😀".repeat(4000), reason="😀".repeat(8000);
      const q=JSON.parse(await tools.loom.record({operation:"ask",question:"Unicode boundary?",recipient:{kind:"user"},
        blocking:false,answer_type:"multi-choice",choices:[{id:"A",answer:label},{id:"B",answer:"Other"}]})).result;
      const a=JSON.parse(await tools.loom.record({operation:"answer",question_id:q.id,choice_id:"A",reason})).result;
      const b=JSON.parse(await tools.loom.record({operation:"answer",question_id:q.id,status:"cannot-select",reason})).result;
      const t=JSON.parse(await tools.loom.record({operation:"query",view:"thread",question_id:q.id})).result;
      return {id:q.id,label:a.data.answer===label,reason:a.data.reason===reason,abstain:b.data.reason===reason,
        stored:t.question.data.choices[0].answer===label && t.answers[0].data.reason===reason && t.answers[1].data.reason===reason};
    `))
    expect(valid.ok).toBe(true)
    expect(valid.value).toMatchObject({ label: true, reason: true, abstain: true, stored: true })
    const before = callbacks
    const rejected = await Effect.runPromise(runtime.execute(`
      const ask={operation:"ask",question:"Boundary?",recipient:{kind:"user"},blocking:true,
        answer_type:"multi-choice",choices:[{id:"A",answer:"One"},{id:"B",answer:"Two"}]};
      const {recipient,...legacy}=ask;
      const invalids=[{...legacy,to_agent:"manual"},
        ...["😀".repeat(4001)," ","\\u00a0\\u2003\\u2028\\u2029\\ufeff"].map(answer=>({...ask,choices:[{id:"A",answer},{id:"B",answer:"Two"}]})),
        ...["😀".repeat(8001)," ","\\u00a0\\u2003\\u2028\\ufeff"].flatMap(reason=>[
          {operation:"answer",question_id:${JSON.stringify(valid.value.id)},choice_id:"A",reason},
          {operation:"answer",question_id:${JSON.stringify(valid.value.id)},status:"cannot-select",reason}])];
      return (await Promise.allSettled(invalids.map(input=>tools.loom.record(input)))).map(result=>result.status);
    `))
    expect(rejected.ok).toBe(true)
    expect(rejected.value).toEqual(Array(10).fill("rejected"))
    // Pinned Code Mode uses JSON Schema for signatures, not input validation.
    // These calls reach real callbacks; runtime must enforce the same boundary.
    expect(callbacks).toBe(before + 10)
    const thread = (await f.invoke("record", { operation: "query", view: "thread", question_id: valid.value.id })).result
    expect(thread.answers).toHaveLength(2)
    expect(f.nativeInputs).toHaveLength(0)
    expect(f.sessionCreates).toHaveLength(0)
  } finally { await f.close() }
})

test("documented Code Mode measurement uses Date.now and does not assume performance or Node globals", async () => {
  const runtime = CodeMode.make({ tools: {} })
  const result = await Effect.runPromise(runtime.execute(`
    const started = Date.now();
    const sample = "é😀";
    return { elapsed_ms: Date.now() - started, code_units: sample.length,
      performance: typeof performance, process: typeof process, Buffer: typeof Buffer };
  `))
  expect(result.ok).toBe(true)
  expect(result.value.elapsed_ms).toBeGreaterThanOrEqual(0)
  expect(result.value.code_units).toBe(3)
  expect(result.value.performance).toBe("undefined")
  expect(result.value.process).toBe("undefined")
  expect(result.value.Buffer).toBe("undefined")
  expect(result.toolCalls).toEqual([])
})

test("documented measured-record snippet executes exact field retrieval with returned identities", async () => {
  const f = await registeredLoom()
  try {
    const action = (await f.invoke("action", { operation: "create", title: "Measured example", goal: "Controlled retrieval" })).result
    const record = (await f.invoke("record", { operation: "add", action_id: action.id, kind: "result",
      statement: "Exact selected statement é😀", artifact_refs: ["OMITTED_ARTIFACT_REFERENCE"] })).result
    const registration = f.tools.get("record")
    const runtime = CodeMode.make({ tools: { loom: Namespace.make({ tools: { record: Tool.make({
      description: registration.description, input: registration.input, output: { type: "string" },
      execute: (input: unknown) => Effect.tryPromise({
        try: async () => JSON.stringify(await f.invoke("record", input)),
        catch: (error: unknown) => toolError(error instanceof Error ? error.message : String(error)),
      }),
    }) } }) } })
    const doc = await readFile(new URL("../docs/architecture/spec/ars-013-tool-discovery.md", import.meta.url), "utf8")
    const snippet = doc.match(/```js\n(\/\/ example: measured-record[\s\S]*?)\n```/)![1]!
    const result = await Effect.runPromise(runtime.execute(snippet.replaceAll('"ACTION_ID"', JSON.stringify(action.id))
      .replaceAll('"RECORD_ID"', JSON.stringify(record.id))))
    expect(result.ok).toBe(true)
    expect(result.value.elapsed_ms).toBeGreaterThanOrEqual(0)
    expect(result.value.records).toHaveLength(1)
    expect(result.value.records[0].id).toBe(record.id)
    expect(result.value.records[0].data).toEqual({ statement: record.data.statement })
    expect(JSON.stringify(result.value)).not.toContain("OMITTED_ARTIFACT_REFERENCE")
    expect(result.toolCalls).toEqual([{ name: "loom.record" }])
  } finally { await f.close() }
})
