import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Database } from "bun:sqlite"
import { canonical, digest } from "../src/model.js"
import { registeredLoom } from "./helpers/registered-loom.js"

type Host = Awaited<ReturnType<typeof registeredLoom>>
const invoke = async (f: Host, tool: string, input: unknown, reader = "owner") => (await f.invoke(tool, input, reader)).result
const hash = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex")
const read = (population: any, member: any) => ({ operation: "population-source", population_id: population.population_id,
  manifest_sha256: population.manifest_sha256, member_key: member.key })
async function collect(f: Host, page: any, reader = "owner") {
  const items = [...page.items]
  while (page.navigation.next) { page = await invoke(f, "history", page.navigation.next, reader); items.push(...page.items) }
  return items
}
async function objective(f: Host) {
  const record = await invoke(f, "record", { operation: "add", session_only: true, kind: "concern",
    statement: "Controlled #182/#187 equivalent: watcher-first ordering is plausible but unproven; scoped test correction does not establish overall release acceptance." })
  const selected = await invoke(f, "objective", { operation: "create", label: "Explain the controlled restore-freshness correction",
    source_type: "ledger-record", source_id: record.id })
  return { selected, record, selection: { objective_id: selected.id,
    question: "Distinguish initial failure, unchanged rerun, correction, named subtests, race suite and separate release requirements." } }
}

test("registered frozen readers resolve caller-native originals, preserve appends and withhold changed or cross-Session content", async () => {
  const f = await registeredLoom()
  try {
    const { selected, selection } = await objective(f)
    const messages = [
      { id: "user-original", type: "user", text: "ORIGINAL_REQUEST: reproduce the failure before correcting the test." },
      { id: "user-correction", type: "user", text: "CORRECTION: distinguish release acceptance from the focused recheck." },
      { id: "assignment", type: "assistant", content: [{ id: "assignment-call", type: "tool", name: "subagent",
        state: { status: "completed", input: { prompt: "ACTUAL_ASSIGNMENT: preserve failure and rerun evidence." },
          content: "ACTUAL_HANDBACK: corrected both ordering cases.", metadata: { sessionID: "child-source" } } }] },
    ]
    f.nativeContexts.set("owner", { data: messages })
    for (const id of ["user-original", "user-correction"]) await invoke(f, "objective", { operation: "link", objective_id: selected.id,
      phase: "request", source_type: "native-message", source_id: id })
    await invoke(f, "objective", { operation: "link", objective_id: selected.id, phase: "dispatch",
      source_type: "native-call", source_id: "assignment-call", source_message_id: "assignment" })
    const preview = await invoke(f, "history", { operation: "preview-population", selection })
    const population = await invoke(f, "review", preview.freeze)
    const members = await collect(f, population)
    const calls = members.filter(member => member.source.kind.startsWith("native-"))
    expect(calls).toHaveLength(3)
    for (const member of calls) {
      const original = await invoke(f, "history", read(population, member))
      expect(original.status).toBe("available")
      expect(digest(original.value)).toBe(member.source.sha256)
      expect(original.value.namespace.native_store_identity).toBe("unavailable")
      expect(original.value.coverage.full_history).toBe(false)
      const other = await invoke(f, "history", read(population, member), "other-reader")
      expect(other.status).toBe("unsupported")
      expect(other.gap.code).toBe("unsupported-source-release")
      expect(JSON.stringify(other)).not.toMatch(/ORIGINAL_REQUEST|ACTUAL_ASSIGNMENT|ACTUAL_HANDBACK|CORRECTION:/)
    }
    messages.push({ id: "unrelated", type: "user", text: "Unrelated newly appended context." })
    const user = calls.find(member => member.source.id === "user-original")
    expect((await invoke(f, "history", read(population, user))).value.fields.text).toBe(messages[0]!.text)
    messages[0]!.text = "CHANGED_NATIVE_ORIGINAL_MUST_NOT_BE_SUBSTITUTED"
    const changed = await invoke(f, "history", read(population, user))
    expect(changed.status).toBe("changed")
    expect(JSON.stringify(changed)).not.toContain("CHANGED_NATIVE_ORIGINAL")
    messages.splice(0, 1)
    expect((await invoke(f, "history", read(population, user))).status).toBe("missing")
    expect((await invoke(f, "history", { operation: "population", population_id: population.population_id,
      manifest_sha256: population.manifest_sha256 })).manifest_sha256).toBe(population.manifest_sha256)
    const call = calls.find(member => member.source.kind === "native-call")
    f.permission.beforeReturn = async () => {
      if (f.permissionRequests.at(-1).resources.some((resource: string) => resource.includes(":view:native-input")))
        throw new Error("native original inspection denied")
    }
    await expect(invoke(f, "history", read(population, call))).rejects.toThrow("native original inspection denied")
    f.permission.beforeReturn = undefined
    for (const format of ["markdown", "html"]) {
      const output = await f.tools.get("history").execute({ ...read(population, call), response_format: format },
        { sessionID: "owner", agent: "author", messageID: "render", id: "render-source", signal: new AbortController().signal })
      expect(output.content).toContain("ACTUAL_ASSIGNMENT")
      expect(output.content).toContain(call.source.sha256)
      expect(f.permissionRequests.at(-1).metadata.view_sha256).toBe(hash(output.content))
    }
    const root = join(f.directory, "state", "loom", "actions-v1", digest({ project: "tool-help", canonical: f.directory }))
    const db = new Database(join(root, "learning.sqlite"), { readonly: true })
    try {
      const rows = [...db.query("SELECT header_json FROM learning_retrospective_populations").all(),
        ...db.query("SELECT data_json FROM learning_retrospective_members").all()]
      expect(JSON.stringify(rows)).not.toMatch(/ACTUAL_ASSIGNMENT|ACTUAL_HANDBACK|ORIGINAL_REQUEST/)
    } finally { db.close() }
    expect(f.sessionCreates).toEqual([]); expect(f.sessionPrompts).toEqual([]); expect(f.nativeInputs).toEqual([])
  } finally { await f.close() }
})

/** An executable, controlled source owner. Production gh transport and native
 * permission callbacks execute normally; no real account or private originals. */
async function externalFixture() {
  const directory = await mkdtemp(join(tmpdir(), "loom-original-owner-")), bin = join(directory, "bin")
  await mkdir(bin)
  const previousPath = process.env.PATH, dataFile = join(bin, "owner.json")
  const a1 = "a".repeat(40), b2 = "b".repeat(40), tree = "c".repeat(40), prefix = "/repos/fixture/restore"
  const correction = '// Controlled exact corrected file\nt.Run("stale_index", checkRefresh)\nt.Run("racy_clean", checkAlreadyIndexed)\n'
  const blob = createHash("sha1").update(`blob ${Buffer.byteLength(correction)}\0`).update(correction).digest("hex")
  const zip = Buffer.from("PK\x03\x04controlled-original-archive-bytes"), archive = hash(zip)
  const data: Record<string, any> = {
    [prefix]: { id: 42, full_name: "fixture/restore" },
    [`${prefix}/git/commits/${b2}`]: { sha: b2, tree: { sha: tree }, message: "Make both ordering cases explicit",
      author: { name: "Controlled author" }, committer: { name: "Controlled committer" }, parents: [{ sha: a1 }] },
    [`${prefix}/git/trees/${tree}`]: { sha: tree, truncated: false, tree: [{ path: "restore_test.go", type: "blob", mode: "100644", sha: blob, size: Buffer.byteLength(correction) }] },
    [`${prefix}/git/blobs/${blob}`]: { sha: blob, size: Buffer.byteLength(correction), encoding: "base64", content: Buffer.from(correction).toString("base64") },
    [`${prefix}/actions/artifacts/91`]: { id: 91, name: "controlled-test-events", expired: false, size_in_bytes: zip.length,
      workflow_run: { id: 20, repository_id: 42, head_sha: b2 }, digest: "sha256:" + archive },
    [`${prefix}/actions/artifacts/91/zip`]: { raw_base64: zip.toString("base64") },
  }
  const logs: Record<string, string> = {}
  for (const [run, attempt, job, head, conclusion, log] of [
    [10, 1, 101, a1, "failure", "checkout " + a1 + "\n--- FAIL: TestRestoreFreshness/racy_clean\nexpected true, observed false; original ordering was not captured\n"],
    [10, 2, 102, a1, "success", "checkout " + a1 + "\n--- PASS: TestRestoreFreshness/racy_clean\nunchanged-code rerun; no historical-cause proof\n"],
    [20, 1, 201, b2, "success", "checkout " + b2 + "\n--- PASS: TestRestoreFreshness/stale_index\n--- PASS: TestRestoreFreshness/racy_clean\n"],
    [20, 1, 202, b2, "success", "checkout " + b2 + "\ngo test -race ./...\nok fixture/restore\n"],
  ] as const) {
    data[`${prefix}/actions/runs/${run}/attempts/${attempt}`] = { id: run, run_attempt: attempt, head_sha: head,
      repository: { full_name: "fixture/restore" }, status: "completed", conclusion }
    data[`${prefix}/actions/jobs/${job}`] = { id: job, run_id: run, run_attempt: attempt, head_sha: head, status: "completed", conclusion,
      name: job === 202 ? "Race suite" : "Restore tests", steps: [] }
    logs[String(job)] = log
    data[`${prefix}/actions/jobs/${job}/logs`] = { raw_base64: Buffer.from(log).toString("base64") }
  }
  await writeFile(join(bin, "gh"), `#!${process.execPath}\nconst fs=require('node:fs'),path=require('node:path');
const args=process.argv.slice(2), expected=['api','--hostname','github.com','--method','GET','--allow-escape-sequences','--header','X-GitHub-Api-Version: 2022-11-28'];
if(args.length===2&&args[0]==='api'&&args[1]==='--help'){process.stdout.write('  --allow-escape-sequences\\n');process.exit(0)}
if(args.length!==expected.length+1||expected.some((v,i)=>args[i]!==v)){process.stderr.write('Invalid fixture argv');process.exit(2)}
const endpoint=args.at(-1), all=JSON.parse(fs.readFileSync(path.join(__dirname,'owner.json'),'utf8'));
fs.appendFileSync(path.join(__dirname,'calls'),'read\\n');
const value=all[endpoint]; if(!value){process.stderr.write('HTTP 404');process.exit(1)}
if(value.error_status){process.stderr.write('HTTP '+value.error_status);process.exit(1)}
process.stdout.write(value.raw_base64===undefined?JSON.stringify(value):Buffer.from(value.raw_base64,'base64'));
`)
  await chmod(join(bin, "gh"), 0o700)
  const sync = () => writeFile(dataFile, JSON.stringify(data))
  await sync(); process.env.PATH = bin + ":" + previousPath
  const f = await registeredLoom()
  return { f, data, prefix, a1, b2, tree, blob, correction, logs, archive, sync,
    url: (path: string) => "https://github.com/fixture/restore/" + path,
    calls: async () => { try { return (await readFile(join(bin, "calls"), "utf8")).length } catch { return 0 } },
    close: async () => { try { await f.close() } finally { process.env.PATH = previousPath; await rm(directory, { recursive: true, force: true }) } } }
}

test("registered source path preserves failed attempt, unchanged rerun, exact correction and scoped verification through frozen pages", async () => {
  const fixture = await externalFixture(), { f, url, data, prefix } = fixture
  try {
    const { selected, selection, record } = await objective(f)
    const urls = [url(`commit/${fixture.b2}`), url(`blob/${fixture.b2}/restore_test.go`),
      url("actions/runs/10/job/101"), url("actions/runs/10/job/102"),
      url("actions/runs/20/job/201"), url("actions/runs/20/job/202"), url("actions/runs/20/artifacts/91")]
    for (const source_id of urls) await invoke(f, "objective", { operation: "link", objective_id: selected.id,
      phase: "verification", source_type: "external-ref", source_id, assessment: "inconclusive" })
    const failureAlias = url("actions/runs/10/attempts/1/jobs/101")
    await invoke(f, "objective", { operation: "link", objective_id: selected.id, phase: "coordination",
      source_type: "external-ref", source_id: failureAlias, note: "Same original failure via an explicit-attempt alias." })
    // A URL quoting a short SHA remains an unresolved authored identity.
    await invoke(f, "objective", { operation: "link", objective_id: selected.id, phase: "coordination",
      source_type: "external-ref", source_id: url("commit/bbbbbbb") })
    const preview = await invoke(f, "history", { operation: "preview-population", selection, limit: 50 })
    const population = await invoke(f, "review", preview.freeze), members = await collect(f, population)
    const external = members.filter(member => urls.includes(member.source.id))
    expect(external).toHaveLength(urls.length)
    expect(external.every(member => member.availability === "available" && member.permitted_view === "github-original/v1")).toBe(true)
    const oneFailure = external.filter(member => member.source.id === urls[2])
    expect(oneFailure).toHaveLength(1)
    expect(oneFailure[0].basis.map((basis: any) => basis.declared_source.id).sort()).toEqual([urls[2], failureAlias].sort())
    const originals = new Map<string, any>()
    for (const member of external) {
      const first = await invoke(f, "history", { ...read(population, member), source_limit: 700 })
      let page = first, text = page.content_json ?? canonical(page.value), pages = 1
      while (page.navigation.next) {
        page = await invoke(f, "history", page.navigation.next)
        expect(page.status).toBe("available")
        text += page.content_json; pages++
      }
      const value = JSON.parse(text)
      expect(digest(value)).toBe(member.source.sha256)
      expect(value.owner).toMatchObject({ repository: "fixture/restore", repository_id: 42 })
      expect(pages).toBeGreaterThan(1)
      originals.set(member.source.id, value.original)
    }
    const failed = originals.get(urls[2]!), rerun = originals.get(urls[3]!), corrected = originals.get(urls[4]!), race = originals.get(urls[5]!)
    expect(failed.run.run_attempt).toBe(1); expect(failed.run.conclusion).toBe("failure")
    expect(rerun.run.run_attempt).toBe(2); expect(rerun.run.conclusion).toBe("success")
    expect(failed.run.workflow_head_sha).toBe(fixture.a1); expect(rerun.run.workflow_head_sha).toBe(fixture.a1)
    expect(failed.log.content).toContain("--- FAIL:")
    expect(corrected.log.content).toContain("TestRestoreFreshness/stale_index")
    expect(corrected.log.content).toContain("TestRestoreFreshness/racy_clean")
    expect(corrected.job.workflow_head_sha).toBe(fixture.b2)
    expect(corrected.job.tested_revision).toContain("unknown")
    expect(race.log.content).toContain("go test -race ./...")
    expect(race.log.content).not.toContain("--- PASS:")
    expect(originals.get(urls[0]!).tree_sha).toBe(fixture.tree)
    expect(originals.get(urls[0]!).commit_sha).toBe(fixture.b2)
    expect(originals.get(urls[1]!).blob_sha).toBe(fixture.blob)
    expect(originals.get(urls[1]!).content_sha256).toBe(hash(fixture.correction))
    expect(originals.get(urls[6]!).archive_sha256).toBe(fixture.archive)
    expect(originals.get(urls[6]!).run_attempt).toContain("unknown")
    const diagnosis = await invoke(f, "history", read(population, members.find(member => member.source.id === record.id)))
    expect(diagnosis.value.data.statement).toContain("plausible but unproven")
    expect(diagnosis.value.data.statement).toContain("does not establish overall release acceptance")
    const quoted = members.find(member => member.source.id === url("commit/bbbbbbb"))
    expect(quoted).toMatchObject({ availability: "unsupported", permitted_view: "reference-only" })

    const selectedFailure = external.find(member => member.source.id === urls[2])
    const attemptEndpoint = `${prefix}/actions/runs/10/attempts/1`, savedAttempt = data[attemptEndpoint]
    data[attemptEndpoint] = { ...savedAttempt, run_attempt: 2, conclusion: "success" }; await fixture.sync()
    const substituted = await invoke(f, "history", read(population, selectedFailure))
    expect(substituted.status).toBe("changed"); expect(substituted.value).toBeUndefined()
    data[attemptEndpoint] = savedAttempt
    const logEndpoint = `${prefix}/actions/jobs/101/logs`, savedLog = data[logEndpoint]
    data[logEndpoint] = { raw_base64: Buffer.from("LATER_CONTENT_MUST_NOT_SUBSTITUTE").toString("base64") }; await fixture.sync()
    const changed = await invoke(f, "history", read(population, selectedFailure))
    expect(changed.status).toBe("changed"); expect(JSON.stringify(changed)).not.toContain("LATER_CONTENT")
    delete data[logEndpoint]; await fixture.sync()
    expect((await invoke(f, "history", read(population, selectedFailure))).status).toBe("missing")
    data[logEndpoint] = savedLog
    data[`${prefix}/actions/artifacts/91/zip`] = { raw_base64: Buffer.from("WRONG_ARCHIVE_BYTES").toString("base64") }; await fixture.sync()
    const badArtifact = await invoke(f, "history", read(population, external.find(member => member.source.id === urls[6])))
    expect(badArtifact.status).toBe("changed"); expect(badArtifact.gap.code).toBe("artifact-digest-mismatch")
    expect(JSON.stringify(badArtifact)).not.toContain("WRONG_ARCHIVE")
    f.permission.beforeReturn = async () => {
      if (f.permissionRequests.at(-1).metadata?.view_sha256) throw new Error("revoked before final bounded-source return")
    }
    await expect(invoke(f, "history", read(population, selectedFailure))).rejects.toThrow("revoked before final bounded-source return")
    f.permission.beforeReturn = undefined
    const frozen = await invoke(f, "history", { operation: "population", population_id: population.population_id,
      manifest_sha256: population.manifest_sha256, limit: 50 })
    expect(frozen.manifest_sha256).toBe(population.manifest_sha256)
    expect(frozen.items.find((member: any) => member.source.id === urls[2]).source).toEqual(selectedFailure.source)
    expect(f.sessionCreates).toEqual([]); expect(f.sessionPrompts).toEqual([]); expect(f.nativeInputs).toEqual([])
  } finally { await fixture.close() }
}, 60000)

test("a missing original becoming retrievable requires a new explicit population and source denial stops before gh", async () => {
  const fixture = await externalFixture(), { f, data, url, prefix } = fixture
  try {
    const { selected, selection } = await objective(f), source_id = url("actions/runs/10/job/101")
    const endpoint = `${prefix}/actions/jobs/101/logs`, saved = data[endpoint]
    delete data[endpoint]; await fixture.sync()
    await invoke(f, "objective", { operation: "link", objective_id: selected.id, phase: "coordination", source_type: "external-ref", source_id })
    const preview = await invoke(f, "history", { operation: "preview-population", selection })
    const old = await invoke(f, "review", preview.freeze), member = (await collect(f, old)).find(item => item.source.id === source_id)
    expect(member.availability).toBe("missing")
    data[endpoint] = saved; await fixture.sync()
    const calls = await fixture.calls()
    expect((await invoke(f, "history", read(old, member))).status).toBe("missing")
    expect(await fixture.calls()).toBe(calls)
    const nextPreview = await invoke(f, "history", { operation: "preview-population", selection })
    const next = await invoke(f, "review", nextPreview.freeze)
    expect(next.population_id).not.toBe(old.population_id)
    const actual = (await collect(f, next)).find(item => item.source.id === source_id)
    expect(actual.availability).toBe("available")
    const beforeDenied = await fixture.calls()
    f.permission.beforeReturn = async () => {
      if (f.permissionRequests.at(-1).resources.some((resource: string) => resource.startsWith("loom:evidence:discover:external:")))
        throw new Error("external source inspection denied")
    }
    await expect(invoke(f, "history", read(next, actual))).rejects.toThrow("external source inspection denied")
    expect(await fixture.calls()).toBe(beforeDenied)
  } finally { await fixture.close() }
}, 30000)

test("new preview canonicalizes an explicit job alias while retaining exact-attempt fallback and its authored source", async () => {
  const fixture = await externalFixture(), { f, data, prefix, url } = fixture
  try {
    const { selected, selection } = await objective(f), declared = url("actions/runs/10/attempts/1/jobs/101")
    delete data[`${prefix}/actions/jobs/101`].run_attempt
    data[`${prefix}/actions/runs/10/attempts/1/jobs?per_page=100`] = { total_count: 1, jobs: [data[`${prefix}/actions/jobs/101`]] }
    await fixture.sync()
    await invoke(f, "objective", { operation: "link", objective_id: selected.id, phase: "coordination", source_type: "external-ref", source_id: declared })
    const preview = await invoke(f, "history", { operation: "preview-population", selection })
    const population = await invoke(f, "review", preview.freeze), members = await collect(f, population)
    const original = members.find(member => member.source.kind === "external-ref")
    expect(original.source).toMatchObject({ id: url("actions/runs/10/job/101"), revision: "run:10:attempt:1:job:101" })
    expect(original.availability).toBe("available")
    expect(original.basis[0].declared_source.id).toBe(declared)
    expect((await invoke(f, "history", read(population, original))).value.original.log.content).toContain("--- FAIL:")
    expect(data[`${prefix}/actions/runs/10`]).toBeUndefined()
  } finally { await fixture.close() }
}, 30000)
