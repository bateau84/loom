import { expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { createServer } from "node:http"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { EXTERNAL_ORIGINAL_LIMITS, externalOriginalDescriptor, resolveExternalOriginal,
  type ExternalOriginalTransport } from "../src/external-originals.js"
import type { RetrospectiveSourceRequest } from "../src/retrospective-populations.js"

const repository = "bateau84/loom", prefix = `/repos/${repository}`, commit = "a".repeat(40), tree = "b".repeat(40)
const buffer = (value: unknown) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value))
const hash = (value: Uint8Array) => createHash("sha256").update(value).digest("hex")
const request = (path: string): RetrospectiveSourceRequest => {
  const source = { kind: "external-ref", id: `https://github.com/${repository}/${path}`, required: true }
  return { ...externalOriginalDescriptor(source)!, recipient_session_id: "researcher", purpose: "inspect" }
}
function fixture() {
  const routes = new Map<string, { status: number; body: Uint8Array }>(), calls: string[] = [], grants: string[][] = []
  const set = (path: string, value: unknown, status = 200) => routes.set(prefix + path, { status, body: buffer(value) })
  set("", { id: 42, full_name: repository })
  set(`/git/commits/${commit}`, { sha: commit, tree: { sha: tree }, message: "Control ordering in both subtests\n",
    author: { name: "Controlled engineer", email: "fixture@example.test", date: "2026-01-01T00:00:00Z" },
    committer: { name: "Controlled engineer", email: "fixture@example.test", date: "2026-01-01T00:00:00Z" }, parents: [] })
  const source = Buffer.from("\ufefffunc TestFreshness(t *testing.T) {\n  // original corrected test bytes\n}\n")
  const blob = createHash("sha1").update(`blob ${source.length}\0`).update(source).digest("hex")
  set(`/git/trees/${tree}`, { sha: tree, truncated: false, tree: [{ path: "restore_test.go", mode: "100644", type: "blob", sha: blob, size: source.length }] })
  set(`/git/blobs/${blob}`, { sha: blob, size: source.length, encoding: "base64", content: source.toString("base64") })
  for (const attempt of [1, 2]) {
    set(`/actions/runs/100/attempts/${attempt}`, { id: 100, run_attempt: attempt, head_sha: commit,
      repository: { full_name: repository }, status: "completed", conclusion: attempt === 1 ? "failure" : "success", workflow_id: 7 })
    set(`/actions/jobs/${10 + attempt}`, { id: 10 + attempt, run_id: 100, run_attempt: attempt, head_sha: "c".repeat(40),
      status: "completed", conclusion: attempt === 1 ? "failure" : "success", name: "test", steps: [] })
    set(`/actions/jobs/${10 + attempt}/logs`, `attempt ${attempt}; expected refresh=true, observed ${attempt === 1 ? "false" : "true"}\n`)
  }
  const archive = Buffer.from("504b0506000000000000000000000000000000000000", "hex")
  set("/actions/artifacts/501", { id: 501, name: "go-test-events", expired: false, size_in_bytes: archive.length,
    digest: `sha256:${hash(archive)}`, workflow_run: { id: 100, repository_id: 42, head_sha: commit } })
  routes.set(prefix + "/actions/artifacts/501/zip", { status: 200, body: archive })
  const transport: ExternalOriginalTransport = async path => {
    calls.push(path)
    const result = routes.get(path)
    if (!result) throw new Error("Unexpected fixture endpoint: " + path)
    return result
  }
  const options = { directory: "/tmp", signal: new AbortController().signal,
    authorize: async (resources: string[]) => { grants.push(resources) }, transport }
  return { routes, calls, grants, set, options, source, blob, archive }
}

test("strict source grammar rejects arbitrary URLs, mutable refs, quoted SHAs and latest attempts before transport", () => {
  for (const id of [commit, `https://example.test/${repository}/commit/${commit}`, `https://github.com/${repository}/commit/main`,
    `https://github.com/${repository}/commit/${commit.slice(0,8)}`, `https://github.com/${repository}/commit/${commit}?token=hidden`,
    `https://github.com/${repository}/blob/${commit}/../secret`, `https://github.com/${repository}/blob/${commit}/%2e%2e/secret`,
    `https://github.com/${repository}/actions/runs/100`, `https://github.com/${repository}/actions/runs/100/job/0`,
    `https://github.com/${repository}/actions/runs/100/attempts/0`, `https://github.com/${repository}/actions/runs/9007199254740993/attempts/1`])
    expect(externalOriginalDescriptor({ kind: "external-ref", id, required: true })).toBeUndefined()
  expect(externalOriginalDescriptor({ ...request(`commit/${commit}`).source, session_id: "wrong-session" })).toBeUndefined()
  expect(externalOriginalDescriptor(request(`commit/${commit}`).source)?.source_store_id).toMatch(/^github-[0-9a-f]{64}$/)
})

test("commit resolution preserves distinct commit/tree identities and explicitly labels its original-field projection", async () => {
  const f = fixture(), result = await resolveExternalOriginal(request(`commit/${commit}`), f.options)
  expect(result.status).toBe("available")
  expect(result.value?.owner).toEqual({ host: "github.com", repository, repository_id: 42 })
  expect(result.value?.original).toMatchObject({ commit_sha: commit, tree_sha: tree, message: "Control ordering in both subtests\n" })
  expect(result.source.revision).toBe(`commit:${commit}`)
  expect(result.source.sha256).toMatch(/^[0-9a-f]{64}$/)
  expect(f.grants.at(-1)).toHaveLength(2)
  expect(f.grants.flat().every(resource => resource.endsWith(":recipient:researcher"))).toBe(true)
})

test("exact Git tree and verified blob return the original correction bytes, including the UTF-8 BOM", async () => {
  const f = fixture(), result = await resolveExternalOriginal(request(`blob/${commit}/restore_test.go`), f.options)
  expect(result.status).toBe("available")
  expect(result.value?.original).toMatchObject({ commit_sha: commit, tree_sha: tree, blob_sha: f.blob,
    encoding: "utf8", content: f.source.toString("utf8"), content_sha256: hash(f.source), byte_length: f.source.length })
  expect(f.calls.some(path => path.includes("/contents/"))).toBe(false)
  f.set(`/git/blobs/${f.blob}`, { sha: f.blob, size: f.source.length, encoding: "base64", content: Buffer.alloc(f.source.length, 65).toString("base64") })
  const changed = await resolveExternalOriginal(request(`blob/${commit}/restore_test.go`), f.options)
  expect(changed).toMatchObject({ status: "changed", gap: { code: "source-identity-mismatch" } })
  expect(changed.value).toBeUndefined()
})

test("symlinks, incomplete trees, missing paths and malformed original encodings do not become file originals", async () => {
  const f = fixture(), selected = request(`blob/${commit}/restore_test.go`)
  f.set(`/git/trees/${tree}`, { sha: tree, truncated: false, tree: [{ path: "restore_test.go", mode: "120000", type: "blob", sha: f.blob }] })
  expect(await resolveExternalOriginal(selected, f.options)).toMatchObject({ status: "unsupported" })
  f.set(`/git/trees/${tree}`, { sha: tree, truncated: true, tree: [] })
  expect(await resolveExternalOriginal(selected, f.options)).toMatchObject({ status: "unresolved", gap: { code: "incomplete-git-tree" } })
  f.set(`/git/trees/${tree}`, { sha: tree, truncated: false, tree: [] })
  expect(await resolveExternalOriginal(selected, f.options)).toMatchObject({ status: "missing", gap: { code: "git-path-missing" } })
  f.set(`/git/trees/${tree}`, { sha: tree, truncated: false, tree: [{ path: "restore_test.go", mode: "100644", type: "blob", sha: f.blob }] })
  f.set(`/git/blobs/${f.blob}`, { sha: f.blob, size: 1, encoding: "base64", content: "!!invalid" })
  expect(await resolveExternalOriginal(selected, f.options)).toMatchObject({ status: "unresolved", gap: { code: "invalid-original-encoding" } })
})

test("failed CI attempt remains independently retrievable from unchanged-code successful rerun", async () => {
  const f = fixture()
  const first = await resolveExternalOriginal(request("actions/runs/100/attempts/1/jobs/11"), f.options)
  const second = await resolveExternalOriginal(request("actions/runs/100/attempts/2/jobs/12"), f.options)
  expect(first.status).toBe("available"); expect(second.status).toBe("available")
  expect(first.value?.original).toMatchObject({ run: { run_attempt: 1, workflow_head_sha: commit, conclusion: "failure" },
    job: { job_id: 11, workflow_head_sha: "c".repeat(40) }, log: { content: "attempt 1; expected refresh=true, observed false\n" } })
  expect(second.value?.original).toMatchObject({ run: { run_attempt: 2, workflow_head_sha: commit, conclusion: "success" } })
  expect(first.source.sha256).not.toBe(second.source.sha256)
  expect(f.calls.some(path => path === prefix + "/actions/runs/100" || path === prefix + "/actions/runs/100/jobs")).toBe(false)
  const original = first.value?.original as { job: Record<string, unknown> }
  expect(original.job.tested_revision).toContain("unknown")
})

test("substituting a later attempt or its job is rejected before any log content is released", async () => {
  const f = fixture()
  f.set("/actions/runs/100/attempts/1", { id: 100, run_attempt: 2, head_sha: commit, status: "completed", conclusion: "success" })
  const attempt = await resolveExternalOriginal(request("actions/runs/100/attempts/1"), f.options)
  expect(attempt.status).toBe("changed"); expect(attempt.value).toBeUndefined()
  const clean = fixture()
  const job = await resolveExternalOriginal(request("actions/runs/100/attempts/1/jobs/12"), clean.options)
  expect(job.status).toBe("changed"); expect(job.value).toBeUndefined()
  expect(clean.calls.some(path => path.endsWith("/logs"))).toBe(false)
})

test("canonical GitHub job links resolve and pin the exact owner-established attempt", async () => {
  const f = fixture(), selected = request("actions/runs/100/job/11")
  const result = await resolveExternalOriginal(selected, f.options)
  expect(result.status).toBe("available")
  expect(result.source.id).toBe(selected.source.id)
  expect(result.source.revision).toBe("run:100:attempt:1:job:11")
  expect(result.value?.original).toMatchObject({ run: { run_id: 100, run_attempt: 1, conclusion: "failure" },
    job: { job_id: 11, run_id: 100, run_attempt: 1 }, log: { content: "attempt 1; expected refresh=true, observed false\n" } })
  expect(f.calls).toContain(prefix + "/actions/runs/100/attempts/1")
  expect(f.calls).not.toContain(prefix + "/actions/runs/100")
})

test("canonical job links with missing or invalid attempt metadata do not consult latest-run data", async () => {
  for (const run_attempt of [undefined, 0, -1, "1", 1.5]) {
    const f = fixture()
    f.set("/actions/jobs/11", { id: 11, run_id: 100, run_attempt, head_sha: commit, status: "completed", conclusion: "failure" })
    const result = await resolveExternalOriginal(request("actions/runs/100/job/11"), f.options)
    expect(result).toMatchObject({ status: "unresolved", gap: { code: "job-attempt-unavailable" } })
    expect(result.value).toBeUndefined()
    expect(f.calls).toEqual([prefix, prefix + "/actions/jobs/11"])
  }
})

test("a frozen canonical job link cannot acquire a later attempt from changed owner metadata", async () => {
  const f = fixture(), selected = request("actions/runs/100/job/11")
  const original = await resolveExternalOriginal(selected, f.options)
  expect(original.status).toBe("available")
  f.calls.length = 0
  f.set("/actions/jobs/11", { id: 11, run_id: 100, run_attempt: 2, head_sha: commit, status: "completed", conclusion: "success" })
  const result = await resolveExternalOriginal({ ...selected, source: original.source }, f.options)
  expect(result).toMatchObject({ status: "changed", gap: { code: "source-identity-mismatch" } })
  expect(result.value).toBeUndefined()
  expect(f.calls).toEqual([prefix, prefix + "/actions/jobs/11"])
})

test("new preview descriptors canonicalize job URL and repository case aliases without losing an explicit attempt assertion", async () => {
  const f = fixture(), normal = request("actions/runs/100/job/11"), explicit = request("actions/runs/100/attempts/1/jobs/11")
  const mixed = externalOriginalDescriptor({ kind: "external-ref", id: "https://github.com/Bateau84/Loom/actions/runs/100/attempts/1/jobs/11", required: true })!
  expect(explicit.source.id).toBe(normal.source.id)
  expect(explicit.source.revision).toBe("run:100:attempt:1:job:11")
  expect(mixed).toEqual({ source_store_id: explicit.source_store_id, permitted_view: explicit.permitted_view, source: explicit.source })
  const original = await resolveExternalOriginal(normal, f.options), alias = await resolveExternalOriginal(explicit, f.options)
  expect(original.status).toBe("available"); expect(alias.status).toBe("available")
  expect(alias.source).toEqual(original.source)
  expect(alias.value).toEqual(original.value)
  expect(alias.value?.locator).toBe(normal.source.id)
  const wrong = request("actions/runs/100/attempts/2/jobs/11")
  f.calls.length = 0
  expect(await resolveExternalOriginal(wrong, f.options)).toMatchObject({ status: "changed" })
  expect(f.calls).toEqual([prefix, prefix + "/actions/jobs/11"])
})

test("older job responses require complete exact-attempt membership rather than latest-job substitution", async () => {
  const f = fixture()
  f.set("/actions/jobs/11", { id: 11, run_id: 100, head_sha: commit, status: "completed", conclusion: "failure" })
  f.set("/actions/runs/100/attempts/1/jobs?per_page=100", { total_count: 101, jobs: [{ id: 11, run_id: 100, head_sha: commit }] })
  expect(await resolveExternalOriginal(request("actions/runs/100/attempts/1/jobs/11"), f.options))
    .toMatchObject({ status: "unresolved", gap: { code: "incomplete-attempt-job-coverage" } })
  f.set("/actions/runs/100/attempts/1/jobs?per_page=100", { total_count: 1, jobs: [{ id: 11, run_id: 100, head_sha: commit }] })
  expect((await resolveExternalOriginal(request("actions/runs/100/attempts/1/jobs/11"), f.options)).status).toBe("available")
})

test("artifact archive is retrieved and digest-verified without inventing attempt, checkout or test events", async () => {
  const f = fixture(), selected = request("actions/runs/100/artifacts/501")
  const result = await resolveExternalOriginal(selected, f.options)
  expect(result.status).toBe("available")
  expect(result.value?.original).toMatchObject({ artifact_id: 501, run_id: 100, encoding: "base64",
    content: f.archive.toString("base64"), archive_sha256: hash(f.archive), tested_revision: "unknown" })
  // The REST size is retained as reported metadata. The actual downloaded byte
  // bound and digest establish this archive; no undocumented size equality does.
  f.set("/actions/artifacts/501", { id: 501, name: "go-test-events", expired: false, size_in_bytes: 123456,
    digest: `sha256:${hash(f.archive)}`, workflow_run: { id: 100, repository_id: 42, head_sha: commit } })
  expect(await resolveExternalOriginal(selected, f.options)).toMatchObject({ status: "available", value: {
    original: { byte_length: f.archive.length, reported_size_in_bytes: 123456 } } })
  f.routes.set(prefix + "/actions/artifacts/501/zip", { status: 200, body: Buffer.alloc(f.archive.length) })
  const changed = await resolveExternalOriginal(selected, f.options)
  expect(changed).toMatchObject({ status: "changed", gap: { code: "artifact-digest-mismatch" } })
  expect(changed.value).toBeUndefined()
})

test("missing, unfinished, changed and oversized originals remain explicit gaps without content", async () => {
  const f = fixture(), selected = request(`commit/${commit}`)
  const prior = await resolveExternalOriginal(selected, f.options)
  f.set(`/git/commits/${commit}`, {}, 404)
  expect(await resolveExternalOriginal({ ...selected, source: prior.source }, f.options)).toMatchObject({ status: "missing" })
  const c = fixture()
  const changed = await resolveExternalOriginal({ ...selected, source: { ...selected.source, revision: "commit:quoted", sha256: "0".repeat(64) } }, c.options)
  expect(changed.status).toBe("changed"); expect(changed.value).toBeUndefined()
  c.set("/actions/runs/100/attempts/1", { id: 100, run_attempt: 1, head_sha: commit, status: "in_progress" })
  expect(await resolveExternalOriginal(request("actions/runs/100/attempts/1"), c.options)).toMatchObject({ status: "unresolved", gap: { code: "incomplete-source" } })
  const o = fixture()
  o.routes.set(prefix + "/actions/jobs/11/logs", { status: 200, body: Buffer.alloc(EXTERNAL_ORIGINAL_LIMITS.originalBytes + 1, 65) })
  const oversized = await resolveExternalOriginal(request("actions/runs/100/attempts/1/jobs/11"), o.options)
  expect(oversized).toMatchObject({ status: "unresolved", gap: { code: "processing-limit" } }); expect(oversized.value).toBeUndefined()
})

test("source-owner identity, recipient authorization and mid-read revocation fail closed", async () => {
  const f = fixture(), selected = request(`commit/${commit}`)
  await expect(resolveExternalOriginal({ ...selected, source_store_id: "wrong-owner" }, f.options)).rejects.toThrow("owner or permitted view")
  await expect(resolveExternalOriginal(selected, { ...f.options, authorize: async () => { throw new Error("denied") } })).rejects.toThrow("denied")
  expect(f.calls).toHaveLength(0)
  const scoped = fixture()
  await resolveExternalOriginal({ ...selected, recipient_session_id: "session:subagent" }, scoped.options)
  expect(scoped.grants.flat().every(resource => resource.endsWith(":recipient:session%3Asubagent"))).toBe(true)
  let revoked = false
  await expect(resolveExternalOriginal(selected, { ...f.options,
    transport: async (path, options) => { const result = await f.options.transport(path, options); if (path.includes("/git/commits/")) revoked = true; return result },
    authorize: async () => { if (revoked) throw new Error("revoked") } })).rejects.toThrow("revoked")
  const denied = fixture(); denied.set(`/git/commits/${commit}`, "SECRET-OWNER-ERROR", 403)
  await expect(resolveExternalOriginal(selected, denied.options)).rejects.toThrow("External source access denied")
})

test("default CLI transport uses fixed GET argv and bounded cancellation without exposing diagnostics", async () => {
  const directory = await mkdtemp(join(tmpdir(), "loom-external-cli-")), savedPath = process.env.PATH
  try {
    const bin = join(directory, "bin"), argsFile = join(directory, "arguments.json")
    await mkdir(bin)
    await writeFile(join(bin, "gh"), `#!${process.execPath}\nimport {writeFileSync} from 'node:fs';const args=process.argv.slice(2);if(args.join(' ')==='api --help'){process.stdout.write('  --allow-escape-sequences  Raw byte output\\n');process.exit(0)}writeFileSync(${JSON.stringify(argsFile)},JSON.stringify(args));process.stderr.write('SECRET-OWNER-DIAGNOSTIC');process.exit(1);\n`, { mode: 0o700 })
    process.env.PATH = bin + ":" + savedPath
    const result = await resolveExternalOriginal(request(`commit/${commit}`), { directory, signal: new AbortController().signal, authorize: async () => {} })
    expect(result).toMatchObject({ status: "unresolved", gap: { code: "github-cli-unavailable" } })
    expect(JSON.stringify(result)).not.toContain("SECRET")
    const args = JSON.parse(await readFile(argsFile, "utf8")) as string[]
    expect(args).toEqual(["api", "--hostname", "github.com", "--method", "GET", "--allow-escape-sequences", "--header", "X-GitHub-Api-Version: 2022-11-28", prefix])
    await writeFile(join(bin, "gh"), `#!${process.execPath}\nsetInterval(()=>{},1000)\n`, { mode: 0o700 })
    const abort = new AbortController()
    const pending = resolveExternalOriginal(request(`commit/${commit}`), { directory, signal: abort.signal, authorize: async () => {} })
    setTimeout(() => abort.abort(new Error("controlled cancellation")), 30)
    await expect(pending).rejects.toThrow("controlled cancellation")
  } finally {
    if (savedPath === undefined) delete process.env.PATH; else process.env.PATH = savedPath
    await rm(directory, { recursive: true, force: true })
  }
})

test("CLI byte-output qualification accepts known legacy bytes and never retries an unknown sanitizer without its flag", async () => {
  const directory = await mkdtemp(join(tmpdir(), "loom-external-cli-modes-")), savedPath = process.env.PATH
  try {
    const bin = join(directory, "bin"), calls = join(directory, "calls.jsonl")
    await mkdir(bin)
    const writeCLI = async (version: string) => writeFile(join(bin, "gh"), `#!${process.execPath}\nconst fs=require('node:fs');const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(args)+'\\n');if(args.join(' ')==='api --help'){process.stdout.write('Legacy API help without a raw flag\\n');process.exit(0)}if(args.join(' ')==='--version'){process.stdout.write(${JSON.stringify(version)});process.exit(0)}process.stderr.write('gh: HTTP 404');process.exit(1);\n`, { mode: 0o700 })
    process.env.PATH = bin + ":" + savedPath
    await writeCLI("gh version 2.46.0 (controlled fixture)\n")
    const options = { directory, signal: new AbortController().signal, authorize: async () => {} }
    expect(await resolveExternalOriginal(request(`commit/${commit}`), options)).toMatchObject({ status: "missing" })
    let observed = (await readFile(calls, "utf8")).trim().split("\n").map(line => JSON.parse(line))
    expect(observed).toEqual([["api", "--help"], ["--version"],
      ["api", "--hostname", "github.com", "--method", "GET", "--header", "X-GitHub-Api-Version: 2022-11-28", prefix]])
    await writeFile(calls, "")
    await writeCLI("gh version 2.999.0 (unknown flagless fixture)\n")
    const denied = await resolveExternalOriginal(request(`commit/${commit}`), options)
    expect(denied).toMatchObject({ status: "unsupported", gap: { code: "github-cli-byte-output-unqualified" } })
    observed = (await readFile(calls, "utf8")).trim().split("\n").map(line => JSON.parse(line))
    expect(observed).toEqual([["api", "--help"], ["--version"]])
  } finally {
    if (savedPath === undefined) delete process.env.PATH; else process.env.PATH = savedPath
    await rm(directory, { recursive: true, force: true })
  }
})

// This is a real CLI byte/redirect check when a qualified installed executable is
// available, not a claim of live GitHub account authorization. Only the test
// wrapper maps fixed production endpoints onto a loopback source fixture.
const installedGH = Bun.which("gh")
let qualifiedInstalledGH = false
if (installedGH) {
  try {
    const help = execFileSync(installedGH, ["api", "--help"], { encoding: "utf8", maxBuffer: 32768, timeout: 5000 })
    qualifiedInstalledGH = /^\s+--allow-escape-sequences(?:\s|=)/m.test(help)
      || /^gh version 2\.46\.0(?:\s|$)/.test(execFileSync(installedGH, ["--version"], { encoding: "utf8", maxBuffer: 4096, timeout: 5000 }))
  } catch { /* Unavailable/unsupported installed CLI is an explicit skipped check. */ }
}
test.skipIf(!qualifiedInstalledGH)("installed GitHub CLI preserves original log and redirected artifact bytes through the production compatibility path", async () => {
  const directory = await mkdtemp(join(tmpdir(), "loom-real-cli-originals-")), savedPath = process.env.PATH
  const f = fixture(), calls: string[] = [], authorizations: Array<string | undefined> = []
  const log = Buffer.from("\ufeffactual CLI log bytes\r\n\x1b[31mfailed\x1b[0m\n")
  f.routes.set(prefix + "/actions/jobs/11/logs", { status: 200, body: log })
  const server = createServer((incoming, response) => {
    const path = incoming.url!; calls.push(path); authorizations.push(incoming.headers.authorization)
    if (path.endsWith("/zip")) {
      response.writeHead(302, { location: "/controlled-original-archive" }); response.end(); return
    }
    const source = path === "/controlled-original-archive" ? { status: 200, body: f.archive } : f.routes.get(path)
    if (!source) { response.writeHead(404); response.end(); return }
    response.writeHead(source.status, { "content-type": path.endsWith("/logs") ? "text/plain"
      : path === "/controlled-original-archive" ? "application/zip" : "application/json" })
    response.end(source.body)
  })
  try {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
    const address = server.address() as { port: number }, bin = join(directory, "bin")
    await mkdir(bin)
    const controlledEnv = { PATH: "/usr/bin:/bin", GH_CONFIG_DIR: join(directory, "config"), GH_TOKEN: "controlled-not-a-real-token", GH_PROMPT_DISABLED: "1", NO_COLOR: "1" }
    await writeFile(join(bin, "gh"), `#!${process.execPath}\nconst{execFileSync}=require('node:child_process');const args=process.argv.slice(2);if(args[0]==='api'&&args[1]!=='--help'){const last=args.length-1;if(!args[last].startsWith('/repos/bateau84/loom'))process.exit(90);args[last]='http://127.0.0.1:${address.port}'+args[last]}try{process.stdout.write(execFileSync(${JSON.stringify(installedGH)},args,{env:${JSON.stringify(controlledEnv)},maxBuffer:1048576,timeout:5000}))}catch(error){process.stderr.write(error.stderr??'controlled CLI failed');process.exit(1)}\n`, { mode: 0o700 })
    process.env.PATH = bin + ":" + savedPath
    const options = { directory, signal: new AbortController().signal, authorize: async () => {} }
    const result = await resolveExternalOriginal(request("actions/runs/100/attempts/1/jobs/11"), options)
    expect(result.status).toBe("available")
    expect(result.value?.original).toMatchObject({ log: { content: log.toString("utf8"), content_sha256: hash(log), byte_length: log.length } })
    const archive = await resolveExternalOriginal(request("actions/runs/100/artifacts/501"), options)
    expect(archive.status).toBe("available")
    expect(archive.value?.original).toMatchObject({ archive_sha256: hash(f.archive), content: f.archive.toString("base64") })
    expect(calls).toContain("/controlled-original-archive")
    expect(authorizations.every(value => value === undefined)).toBe(true)
  } finally {
    if (savedPath === undefined) delete process.env.PATH; else process.env.PATH = savedPath
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    await rm(directory, { recursive: true, force: true })
  }
})
