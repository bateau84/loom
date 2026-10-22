import { test, expect } from "bun:test"
import { createHash } from "node:crypto"
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { COMPANION_MAX_BYTES, companionHelp, readCompanion } from "../src/review-companions.js"
import { registeredLoom } from "./helpers/registered-loom.js"

type Fixture = Awaited<ReturnType<typeof registeredLoom>>
async function fixture() {
  const f = await registeredLoom()
  try {
    // Deliberately not a conventional skill root or a basename matching the ID.
    const directory = join(f.directory, "external-install", "different-directory-name")
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, "SKILL.md"), "# Practitioner instructions, not a review lens\n")
    await writeFile(join(directory, "ASSESSMENT.md"), "# Assessment\nVerify the accepted requirements.\n")
    await writeFile(join(directory, "QA.md"), "# QA\nChallenge shared assumptions.\n")
    f.skills.set("domain-skill", { id: "domain-skill", name: "Domain", path: join(directory, "SKILL.md"), content: "Practitioner" })
    await configure(f, { custom: { roles: ["assessment"] }, challenger: { roles: ["qa"] }, both: { roles: ["assessment", "qa"] } })
    return { ...f, skillDirectory: directory }
  } catch (error) { await f.close(); throw error }
}
async function configure(f: Fixture, agents: Record<string, unknown>) {
  // Permission to load companions does not depend on instruction injection or capture.
  await writeFile(join(f.directory, ".loom.yaml"), JSON.stringify({ agents, instructions: { enabled: false }, ledger: { capture: "off" } }))
}

for (const [lens, agent, filename] of [["assessment", "custom", "ASSESSMENT.md"], ["qa", "challenger", "QA.md"]] as const) {
  test(`${lens} returns the exact installed companion through the public plugin without workflow state`, async () => {
    const f = await fixture()
    try {
      const tool = f.tools.get(lens)
      expect(tool.options).toEqual({ namespace: "loom", codemode: true })
      expect(tool.description).toBe(companionHelp(lens))
      for (const section of ["Usage:", "Returns:", "Caution:", "Examples (JSON inputs"]) expect(tool.description).toContain(section)
      const path = join(f.skillDirectory, filename)
      const bytes = await readFile(path)
      expect((await f.invoke(lens, { skill: "domain-skill" }, "fresh", agent)).result).toEqual({
        skill: "domain-skill", methodology: lens, available: true, path,
        content: bytes.toString("utf8"), sha256: createHash("sha256").update(bytes).digest("hex"),
      })
      expect(f.permissionRequests).toEqual([{
        action: "skill", resources: ["domain-skill"], save: ["domain-skill"], sessionID: "fresh", agent,
        source: { type: "tool", messageID: "message", id: "tool-call" },
      }])
      expect((await f.invoke("context", {}, "fresh", agent)).result.selected).toBeNull()
      expect((await f.invoke("action", { operation: "list" })).result.items).toEqual([])
      expect((await f.invoke("record", { operation: "query", session_only: true }, "fresh", agent)).result.items).toEqual([])
      expect(f.nativeInputs).toEqual([])
    } finally { await f.close() }
  })

  test(`${lens} denies absent, wrong and disabled roles before skill lookup or permission prompts`, async () => {
    const f = await fixture()
    try {
      await configure(f, {
        reviewer: { roles: [] }, critic: { roles: [] },
        wrong: { roles: [lens === "qa" ? "assessment" : "qa"] },
        disabled: { roles: [lens], enabled: false },
      })
      for (const caller of ["unknown", "reviewer", "critic", "wrong", "disabled"]) {
        await expect(f.invoke(lens, { skill: "domain-skill" }, "s", caller)).rejects.toThrow(`requires the ${lens} role`)
      }
      expect(f.skillRequests).toEqual([])
      expect(f.permissionRequests).toEqual([])
    } finally { await f.close() }
  })
}

test("one enabled agent may hold both roles; live removal and malformed config fail closed", async () => {
  const f = await fixture()
  try {
    for (const lens of ["assessment", "qa"]) expect((await f.invoke(lens, { skill: "domain-skill" }, "s", "both")).result.available).toBe(true)
    await configure(f, { both: { roles: ["qa"] } })
    await expect(f.invoke("assessment", { skill: "domain-skill" }, "s", "both")).rejects.toThrow("requires the assessment role")
    expect((await f.invoke("qa", { skill: "domain-skill" }, "s", "both")).result.available).toBe(true)
    await writeFile(join(f.directory, ".loom.local.yaml"), "agents: [invalid]\n")
    await expect(f.invoke("qa", { skill: "domain-skill" }, "s", "both")).rejects.toThrow("Cannot authorize loom_qa")
  } finally { await f.close() }
})

test("native rejection propagates unchanged, with no companion read or fallback", async () => {
  const f = await fixture()
  try {
    const denied = new Error("Native skill permission denied")
    f.permission.error = denied
    // A directory would fail file validation if the denied request reached the reader.
    await rm(join(f.skillDirectory, "QA.md"))
    await mkdir(join(f.skillDirectory, "QA.md"))
    await expect(f.invoke("qa", { skill: "domain-skill" }, "s", "challenger")).rejects.toBe(denied)
    expect(f.permissionRequests).toHaveLength(1)
  } finally { await f.close() }
})

test("role revocation while native approval waits is respected before returning content", async () => {
  const f = await fixture()
  try {
    f.permission.beforeReturn = () => configure(f, { custom: { roles: [] } })
    await expect(f.invoke("assessment", { skill: "domain-skill" }, "s", "custom")).rejects.toThrow("requires the assessment role")
  } finally { await f.close() }
})

test("missing companions are explicit, and changed bytes are reloaded rather than cached", async () => {
  const f = await fixture()
  try {
    const path = join(f.skillDirectory, "QA.md")
    await rm(path)
    const missing = (await f.invoke("qa", { skill: "domain-skill" }, "s", "challenger")).result
    expect(missing).toEqual({ skill: "domain-skill", methodology: "qa", available: false, path, reason: "companion-not-found" })
    expect(missing).not.toHaveProperty("content")
    expect(missing).not.toHaveProperty("sha256")
    await writeFile(path, "A newly installed QA lens\n")
    const first = (await f.invoke("qa", { skill: "domain-skill" }, "s", "challenger")).result
    await writeFile(path, "Changed QA lens\n")
    const next = (await f.invoke("qa", { skill: "domain-skill" }, "s", "challenger")).result
    expect(next.content).toBe("Changed QA lens\n")
    expect(next.sha256).not.toBe(first.sha256)
  } finally { await f.close() }
})

test("unknown skills, forged arguments and non-file registry paths cannot become arbitrary reads", async () => {
  const f = await fixture()
  try {
    for (const skill of ["missing", "../../secret"]) {
      await expect(f.invoke("assessment", { skill }, "s", "custom")).rejects.toThrow("Expected one registered native skill")
    }
    for (const input of [{ skill: "" }, { skill: " domain-skill" }, { skill: 1 }, { skill: "domain-skill", path: "/secret" }, { skill: "domain-skill", role: "assessment" }]) {
      await expect(f.invoke("assessment", input, "s", "custom")).rejects.toThrow("Expected only skill")
    }
    f.skills.get("domain-skill").path = f.skillDirectory
    await expect(f.invoke("assessment", { skill: "domain-skill" }, "s", "custom")).rejects.toThrow("registered local SKILL.md")
    expect(f.permissionRequests).toEqual([])
  } finally { await f.close() }
})

test("symlinked skill installations work; companion-file symlinks do not escape the skill", async () => {
  const f = await fixture()
  try {
    const link = join(f.directory, "installed-link")
    await symlink(f.skillDirectory, link, "dir")
    f.skills.get("domain-skill").path = join(link, "SKILL.md")
    expect((await f.invoke("assessment", { skill: "domain-skill" }, "s", "custom")).result.available).toBe(true)
    await rm(join(f.skillDirectory, "QA.md"))
    await symlink(join(f.skillDirectory, "SKILL.md"), join(f.skillDirectory, "QA.md"))
    await expect(f.invoke("qa", { skill: "domain-skill" }, "s", "challenger")).rejects.toThrow()
  } finally { await f.close() }
})

test("bounded reads reject oversized, non-UTF-8 and nonregular files without silent truncation", async () => {
  const f = await fixture()
  try {
    const path = join(f.skillDirectory, "QA.md")
    const run = () => f.invoke("qa", { skill: "domain-skill" }, "s", "challenger")
    await writeFile(path, "x".repeat(COMPANION_MAX_BYTES))
    expect((await run()).result.content.length).toBe(COMPANION_MAX_BYTES)
    await writeFile(path, "x".repeat(COMPANION_MAX_BYTES + 1))
    await expect(run()).rejects.toThrow("exceeds 64 KiB")
    await writeFile(path, Buffer.from([0xff, 0xfe]))
    await expect(run()).rejects.toThrow("valid UTF-8")
    await rm(path); await mkdir(path)
    await expect(run()).rejects.toThrow("regular file")
  } finally { await f.close() }
})

test("foreign Sessions and cancellation cannot load a companion", async () => {
  const f = await fixture()
  try {
    f.sessions.set("foreign", { projectID: "elsewhere", location: { directory: f.directory } })
    await expect(f.invoke("assessment", { skill: "domain-skill" }, "foreign", "custom")).rejects.toThrow("does not own")
    expect(f.skillRequests).toEqual([])
    const abort = new AbortController(); abort.abort(new Error("Cancelled review load"))
    await expect(readCompanion(join(f.skillDirectory, "ASSESSMENT.md"), abort.signal)).rejects.toThrow("Cancelled review load")
  } finally { await f.close() }
})
