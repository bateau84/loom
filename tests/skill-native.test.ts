import { test, expect } from "bun:test"
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises"
import { isAbsolute, join } from "node:path"
import { tmpdir } from "node:os"
import plugin from "../server.js"
import { LOOM_SKILL_ID, loomSkill } from "../src/skill.js"
import { registeredLoom } from "./helpers/registered-loom.js"

test("packaged Loom guide has a real path, bounded body and discoverable native metadata", async () => {
  const skill = await loomSkill()
  expect(skill.id).toBe("loom")
  expect(skill.name).toBe("Loom")
  expect(skill.description.length).toBeGreaterThan(0)
  expect(skill.description.length).toBeLessThanOrEqual(200)
  // false would hide metadata from the model, not merely prevent eager loading.
  expect(skill.autoinvoke).toBe(true)
  expect(isAbsolute(skill.path)).toBe(true)
  expect(skill.content).toBe(await readFile(skill.path, "utf8"))
  expect(skill.content.startsWith("# Loom usage guide\n")).toBe(true)
  expect(skill.content.length).toBeLessThanOrEqual(12000)
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))
  expect(pkg.files).toContain("src")
  expect(pkg.exports["."]).toBe("./server.ts")
  expect(pkg.exports["./server"]).toBe("./server.ts")
})

test("public plugin advertises the skill without a role, Action, sixth tool or eager guide injection", async () => {
  const f = await registeredLoom()
  try {
    expect([...f.skills.keys()]).toEqual([LOOM_SKILL_ID])
    expect(f.skills.get(LOOM_SKILL_ID)).toEqual(await loomSkill())
    expect([...f.tools.keys()].sort()).toEqual(["action", "agents", "context", "plan", "record"])
    expect((await f.invoke("action", { operation: "list" })).result.items).toEqual([])
    expect((await f.invoke("context", {})).result.selected).toBeNull()
    const event = { sessionID: "s", agent: "author", system: [] as any[], messages: [], tools: {}, options: {} }
    await f.hooks.get("context")(event)
    expect(event.system).toEqual([])
    await writeFile(join(f.directory, ".loom.yaml"), "agents: {author: {roles: [implementation]}}\n")
    await f.hooks.get("context")(event)
    expect(event.system.length).toBeGreaterThan(0)
    expect(JSON.stringify(event.system)).not.toContain("# Loom usage guide")
  } finally { await f.close() }
  expect(f.skills.size).toBe(0)
})

test("skill transforms replay without duplicates or retained mutations", async () => {
  const f = await registeredLoom()
  try {
    const original = { ...f.skills.get(LOOM_SKILL_ID) }
    f.skills.get(LOOM_SKILL_ID).content = "Later transform changed this snapshot"
    f.skills.get(LOOM_SKILL_ID).autoinvoke = false
    f.reloadSkills(); f.reloadSkills()
    expect([...f.skills.keys()]).toEqual([LOOM_SKILL_ID])
    expect(f.skills.get(LOOM_SKILL_ID)).toEqual(original)
  } finally { await f.close() }
})

test("existing same-ID user skill is preserved including its visibility setting", async () => {
  const existing = { id: LOOM_SKILL_ID, name: "My Loom", description: "User guide", path: "/user/loom/SKILL.md", content: "User content", autoinvoke: false }
  const other = { ...existing, id: "other", name: "Other guide" }
  const f = await registeredLoom([existing, other])
  try {
    expect(f.skills.get(LOOM_SKILL_ID)).toEqual(existing)
    expect(f.skills.get("other")).toEqual(other)
    f.reloadSkills()
    expect(f.skills.get(LOOM_SKILL_ID)).toEqual(existing)
  } finally { await f.close() }
  expect([...f.skills.values()]).toEqual([existing, other])
})

test("core setup failure disposes the already registered skill and preserves the original error", async () => {
  const directory = await mkdtemp(join(tmpdir(), "loom-skill-failure-"))
  const skills = new Map<string, any>()
  let disposed = 0
  try {
    const ctx = {
      location: { directory: join(directory, "does-not-exist") },
      skill: { transform: async (fn: any) => {
        fn({ get: (id: string) => skills.get(id), add: (skill: any) => skills.set(skill.id, skill) })
        return { dispose: async () => { disposed++; skills.clear(); throw new Error("Secondary cleanup error") } }
      } },
    }
    await expect((plugin as any).setup(ctx)).rejects.toThrow("ENOENT")
    expect(disposed).toBe(1)
    expect(skills.size).toBe(0)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test("skill guidance retains current evidence, coordination and recovery boundaries", async () => {
  const { content } = await loomSkill()
  for (const text of [
    "loom_agents", "loom_action", "loom_plan", "loom_context", "loom_record",
    "A conversation needs no Action", "An Action needs no Plan", "not a scheduler",
    "complete node list", "Action's separate current revision", "original",
    "work_ref", "contract_match:null", "next_after", "session_only:true",
    "ASSESSMENT.md", "QA.md", "does not establish", "independent acceptance",
    "storage-only", "transport:not-attempted", "Do not repeat an",
    "answer to try delivery", "credentials", "not redacted", "selection changed after an error",
    "Await writes", "Promise.allSettled",
  ]) expect(content).toContain(text)
  for (const removed of ["loom_start", "loom_route", "loom_work", "loom_intent", "loom_task_plan"]) expect(content).not.toContain(removed)
})

test("bundled JSON examples execute with real returned identities against registered callbacks", async () => {
  const f = await registeredLoom()
  try {
    const skill = f.skills.get(LOOM_SKILL_ID)
    const inputs = [...skill.content.matchAll(/```json\n([\s\S]*?)\n```/g)].map(match => JSON.parse(match[1]))
    expect(inputs).toHaveLength(4)
    const action = (await f.invoke("action", inputs[0])).result
    const replace = (input: unknown) => JSON.parse(JSON.stringify(input).replaceAll("ACTION_ID", action.id).replaceAll("TASK_ID", "task"))
    expect((await f.invoke("plan", replace(inputs[1]))).result.revision).toBe(0)
    await f.invoke("plan", { operation: "save", action_id: action.id, expected_revision: 0, nodes: [{ id: "task", kind: "task", title: "Fixture task" }] })
    expect((await f.invoke("context", replace(inputs[2]))).result.task.id).toBe("task")
    const result = (await f.invoke("record", { operation: "add", action_id: action.id, kind: "result", statement: "Fixture only; no external work was performed." })).result
    const query = { ...replace(inputs[3]), record_id: result.id }
    expect((await f.invoke("record", query)).result.items[0].id).toBe(result.id)
  } finally { await f.close() }
})
