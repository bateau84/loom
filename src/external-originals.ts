import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { canonical, digest, ProcessingBudget, ProcessingLimitError } from "./model.js"
import type { EvaluationSourceRef } from "./evaluation-store.js"
import type { RetrospectiveSourceRequest, RetrospectiveSourceResolution } from "./retrospective-populations.js"

/** Narrow reads through the operator's existing GitHub CLI integration. No
 * account setup, credential persistence, shell, arbitrary URL or archive reader. */
export const EXTERNAL_ORIGINAL_LIMITS = Object.freeze({ apiBytes: 1048576, originalBytes: 524288,
  responseBytes: 1048576, calls: 8, timeoutMs: 20000 })
const VIEW = "github-original/v1"
const OID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/
type Locator = { repository: string } & (
  | { kind: "commit"; commit: string }
  | { kind: "blob"; commit: string; path: string }
  | { kind: "attempt"; run: number; attempt: number }
  | { kind: "job"; run: number; attempt?: number; job: number }
  | { kind: "artifact"; run: number; artifact: number })
type GapStatus = "missing" | "changed" | "unsupported" | "unresolved"
class SourceGap extends Error {
  constructor(readonly status: GapStatus, readonly code: string, readonly detail: string) { super(code) }
}
const gap = (status: GapStatus, code: string, detail: string): never => { throw new SourceGap(status, code, detail) }
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return gap("unresolved", "invalid-owner-response", "The source owner did not return a supported complete representation.")
  return value as Record<string, unknown>
}
const integer = (value: unknown): number | undefined => typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined
const sourceNumber = (value: string): number | undefined => /^[1-9][0-9]{0,15}$/.test(value) ? integer(Number(value)) : undefined
const text = (value: unknown): string => {
  if (typeof value !== "string") return gap("unresolved", "invalid-owner-response", "The source owner omitted a required original field.")
  return value
}
const oid = (value: unknown): string => {
  const result = text(value)
  if (!OID.test(result)) return gap("unresolved", "unresolved-git-object", "The source owner did not establish a complete Git object identity.")
  return result
}
function locator(ref: EvaluationSourceRef): Locator | undefined {
  if (ref.kind !== "external-ref" || ref.session_id !== undefined || ref.message_id !== undefined || ref.id.length > 1000) return
  const match = /^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9_.-]{1,100})\/(.+)$/.exec(ref.id)
  if (!match || match[2] === "." || match[2] === "..") return
  const repository = `${match[1]}/${match[2]}`.toLowerCase(), path = match[3]!
  let part = /^commit\/([0-9a-f]{40}(?:[0-9a-f]{24})?)$/.exec(path)
  if (part) return { repository, kind: "commit", commit: part[1]! }
  part = /^blob\/([0-9a-f]{40}(?:[0-9a-f]{24})?)\/(.+)$/.exec(path)
  if (part && part[2]!.split("/").every(segment => /^[A-Za-z0-9_.-]+$/.test(segment) && segment !== "." && segment !== ".."))
    return { repository, kind: "blob", commit: part[1]!, path: part[2]! }
  part = /^actions\/runs\/([0-9]+)\/attempts\/([0-9]+)(?:\/jobs\/([0-9]+))?$/.exec(path)
  if (part) {
    const run = sourceNumber(part[1]!), attempt = sourceNumber(part[2]!), job = part[3] ? sourceNumber(part[3]) : undefined
    if (!run || !attempt || part[3] && !job) return
    return job ? { repository, kind: "job", run, attempt, job } : { repository, kind: "attempt", run, attempt }
  }
  part = /^actions\/runs\/([0-9]+)\/job\/([0-9]+)$/.exec(path)
  if (part) {
    const run = sourceNumber(part[1]!), job = sourceNumber(part[2]!)
    if (run && job) return { repository, kind: "job", run, job }
  }
  part = /^actions\/runs\/([0-9]+)\/artifacts\/([0-9]+)$/.exec(path)
  if (part) {
    const run = sourceNumber(part[1]!), artifact = sourceNumber(part[2]!)
    if (run && artifact) return { repository, kind: "artifact", run, artifact }
  }
}
export function externalOriginalDescriptor(source: EvaluationSourceRef): { source_store_id: string; permitted_view: string; source: EvaluationSourceRef } | undefined {
  const selected = locator(source)
  if (!selected) return
  const base = `https://github.com/${selected.repository}/`
  const id = base + (selected.kind === "commit" ? `commit/${selected.commit}`
    : selected.kind === "blob" ? `blob/${selected.commit}/${selected.path}`
    : selected.kind === "attempt" ? `actions/runs/${selected.run}/attempts/${selected.attempt}`
    : selected.kind === "job" ? `actions/runs/${selected.run}/job/${selected.job}`
    : `actions/runs/${selected.run}/artifacts/${selected.artifact}`)
  const declared = selected.kind === "job" && selected.attempt !== undefined
    ? `run:${selected.run}:attempt:${selected.attempt}:job:${selected.job}` : undefined
  if (declared !== undefined && source.revision !== undefined && source.revision !== declared) return
  return { source_store_id: "github-" + digest({ host: "github.com", repository: selected.repository }), permitted_view: VIEW,
    source: { ...source, id, ...(declared !== undefined ? { revision: declared } : {}) } }
}

export type ExternalOriginalTransport = (endpoint: string, options: {
  directory: string; signal: AbortSignal; maxBytes: number;
}) => Promise<{ status: number; body: Uint8Array }>
export type ExternalOriginalOptions = { signal: AbortSignal; directory: string;
  authorize: (resources: string[]) => Promise<void>;
  /** Controlled owner/transport qualification seam; production uses existing gh. */
  transport?: ExternalOriginalTransport }

type CLIOptions = { directory: string; signal: AbortSignal; maxBytes: number; timeoutMs?: number;
  executable: string; environment?: NodeJS.ProcessEnv }
const runGH = (args: string[], options: CLIOptions): Promise<{ status: number; body: Uint8Array }> => new Promise((resolve, reject) => {
  options.signal.throwIfAborted()
  // Credentials remain with gh. Prevent diagnostics, paging, prompts and TTY
  // formatting from becoming another output/secret channel. All stdout is piped;
  // raw terminal escapes never reach an actual terminal through this transport.
  const env: NodeJS.ProcessEnv = { ...(options.environment ?? process.env), GH_PROMPT_DISABLED: "1", GH_PAGER: "", PAGER: "", NO_COLOR: "1" }
  delete env.GH_DEBUG
  delete env.DEBUG
  delete env.GH_FORCE_TTY
  delete env.CLICOLOR_FORCE
  execFile(options.executable, args, { cwd: options.directory, encoding: "buffer", maxBuffer: options.maxBytes,
    timeout: options.timeoutMs ?? EXTERNAL_ORIGINAL_LIMITS.timeoutMs, signal: options.signal, env }, (error, stdout, stderr) => {
    if (options.signal.aborted) { reject(options.signal.reason); return }
    if (error) {
      if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
        reject(new SourceGap("unresolved", "processing-limit", "The complete original exceeds the bounded read; no excerpt was substituted.")); return
      }
      // Never return CLI diagnostics, paths, HTTP URLs or credential material.
      const status = /\bHTTP (401|403|404|410|429|5[0-9]{2})\b/.exec(stderr.toString("utf8"))?.[1]
      if (status) { resolve({ status: Number(status), body: new Uint8Array() }); return }
      reject(new SourceGap(error.code === "ENOENT" ? "unsupported" : "unresolved", "github-cli-unavailable",
        "The existing authenticated GitHub CLI could not complete this bounded read. No account or credentials were created.")); return
    }
    resolve({ status: 200, body: stdout })
  })
})

const apiArguments = (endpoint: string, explicitRaw: boolean) => ["api", "--hostname", "github.com", "--method", "GET",
  ...(explicitRaw ? ["--allow-escape-sequences"] : []), "--header", "X-GitHub-Api-Version: 2022-11-28", endpoint]

/** Flagless CLIs must demonstrate byte-preserving nonterminal output. The
 * only URLs admitted here are generated loopback probe URLs, with synthetic
 * bodies and a disposable credential-free configuration. No owner endpoint or
 * operator credentials enter this test. It is a capability test for a trusted
 * installed executable, not a sandbox for an adversarial executable. */
async function qualifyFlaglessCLI(options: CLIOptions): Promise<void> {
  let directory: string | undefined, stop: (() => void | Promise<void>) | undefined
  try {
    options.signal.throwIfAborted()
    directory = await mkdtemp(join(tmpdir(), "loom-gh-byte-probe-"))
    const textBytes = Buffer.from("\ufeffloom byte probe\r\n\x1b[31mred\x1b[0m\x1b]0;probe\x07\t\n")
    const binaryBytes = Uint8Array.from({ length: 256 }, (_, i) => i)
    const server = Bun.serve({
      hostname: "127.0.0.1", port: 0,
      fetch(request) {
        // A capability probe has no authorization to receive real credentials.
        if (request.method !== "GET" || request.headers.has("authorization")) return new Response(null, { status: 400 })
        const path = new URL(request.url).pathname
        if (path === "/text") return new Response(textBytes, { headers: { "content-type": "text/plain" } })
        if (path === "/redirect") return new Response(null, { status: 302, headers: { location: "/binary" } })
        if (path === "/binary") return new Response(binaryBytes, { headers: { "content-type": "application/octet-stream" } })
        return new Response(null, { status: 404 })
      }
    })
    stop = () => server.stop(true)
    // Construct a minimal environment, never copy the operator's token, proxy,
    // config, keyring or other credential-bearing environment into the probe.
    const environment: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: directory, USERPROFILE: directory,
      XDG_CONFIG_HOME: directory, XDG_CACHE_HOME: directory, XDG_DATA_HOME: directory, XDG_STATE_HOME: directory,
      GH_CONFIG_DIR: directory, GH_TOKEN: "loom-local-probe-not-a-credential",
      GH_NO_UPDATE_NOTIFIER: "1", GH_NO_EXTENSION_UPDATE_NOTIFIER: "1" }
    for (const [path, expected] of [["text", textBytes], ["redirect", binaryBytes]] as const) {
      const response = await runGH(apiArguments(new URL(path, server.url).href, false), {
        ...options, directory, environment, maxBytes: 4096, timeoutMs: 5000
      })
      if (response.status !== 200 || !Buffer.from(response.body).equals(Buffer.from(expected)))
        throw new Error("byte mismatch")
    }
  } catch {
    options.signal.throwIfAborted()
    return gap("unsupported", "github-cli-byte-output-unqualified",
      "The flagless GitHub CLI could not prove exact nonterminal text and redirected binary output using the isolated local probe. No GitHub owner read was attempted. Make loopback available or put a GitHub CLI with --allow-escape-sequences on PATH; check gh --version.")
  } finally {
    try { await stop?.() }
    finally { if (directory !== undefined) await rm(directory, { recursive: true, force: true }) }
  }
}

/** Qualify byte output once per source read, before any remote owner read.
 * Prefer the CLI's explicit raw-output capability; otherwise require a
 * successful local nonterminal byte probe, not a version claim. Use the same
 * resolved executable for help, qualification and owner reads. */
function githubCLITransport(): ExternalOriginalTransport {
  let qualified: Promise<{ executable: string; explicitRaw: boolean }> | undefined
  return async (endpoint, options) => {
    qualified ??= (async () => {
      const executable = Bun.which("gh", { PATH: process.env.PATH, cwd: options.directory })
      if (!executable) return gap("unsupported", "github-cli-unavailable",
        "The existing authenticated GitHub CLI could not be found on PATH. No account or credentials were created.")
      const help = await runGH(["api", "--help"], { ...options, executable, maxBytes: 32768, timeoutMs: 5000 })
      if (help.status !== 200) return gap("unsupported", "github-cli-byte-output-unqualified", "GitHub CLI byte-output support could not be established. Check gh api --help.")
      const explicitRaw = /^\s+--allow-escape-sequences(?:\s|=)/m.test(decode(help.body))
      if (!explicitRaw) await qualifyFlaglessCLI({ ...options, executable })
      return { executable, explicitRaw }
    })()
    const { executable, explicitRaw } = await qualified
    return runGH(apiArguments(endpoint, explicitRaw), { ...options, executable })
  }
}

function same(actual: unknown, expected: unknown) {
  if (actual !== expected) gap("changed", "source-identity-mismatch", "The source owner returned another source identity; no replacement was released.")
}
const bytesHash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
const decode = (bytes: Uint8Array) => {
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes) }
  catch { return gap("unsupported", "unsupported-original-encoding", "This permitted text view requires a complete valid UTF-8 original.") }
}
const base64 = (value: unknown): Uint8Array => {
  const encoded = text(value).replace(/\n/g, "")
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))
    return gap("unresolved", "invalid-original-encoding", "The source owner returned an invalid original encoding.")
  const bytes = Buffer.from(encoded, "base64")
  if (bytes.toString("base64") !== encoded) return gap("unresolved", "invalid-original-encoding", "The source owner returned a noncanonical original encoding.")
  return bytes
}
const selected = (value: Record<string, unknown>, names: string[]) => Object.fromEntries(names.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]))

/** Returned hashes qualify this permitted view only. They do not attest a native
 * invocation, actual checkout, test event, protected transfer or retained copy. */
export async function resolveExternalOriginal(request: RetrospectiveSourceRequest, options: ExternalOriginalOptions): Promise<RetrospectiveSourceResolution> {
  const target = locator(request.source), descriptor = externalOriginalDescriptor(request.source)
  if (!target || !descriptor) return { ...request, status: "unsupported", gap: { code: "unsupported-external-reference",
    detail: "Supported originals require a complete GitHub commit/blob, explicit CI attempt/job, or exact artifact locator." } }
  if (request.source_store_id !== descriptor.source_store_id || request.permitted_view !== descriptor.permitted_view)
    throw new Error("External source owner or permitted view mismatch")
  options.signal.throwIfAborted()
  const resources = new Set<string>(), transport = options.transport ?? githubCLITransport()
  const prefix = `/repos/${target.repository}`
  let calls = 0
  const read = async (path: string, maxBytes: number = EXTERNAL_ORIGINAL_LIMITS.apiBytes) => {
    if (++calls > EXTERNAL_ORIGINAL_LIMITS.calls) return gap("unresolved", "processing-limit", "The complete original exceeds the bounded owner-read budget.")
    const resource = `loom:evidence:external:github:${target.repository}:GET:${encodeURIComponent(path)}:recipient:${encodeURIComponent(request.recipient_session_id)}`
    resources.add(resource)
    await options.authorize([resource])
    options.signal.throwIfAborted()
    const response = await transport(path, { directory: options.directory, signal: options.signal, maxBytes })
    options.signal.throwIfAborted()
    // Test transports must satisfy the same size boundary as the subprocess.
    if (response.body.byteLength > maxBytes) return gap("unresolved", "processing-limit", "The complete original exceeds the bounded read; no excerpt was substituted.")
    if (response.status === 401 || response.status === 403) throw new Error("External source access denied")
    if (response.status === 404 || response.status === 410) return gap("missing", "source-missing", "The exact original is not available from its owner.")
    if (response.status !== 200) return gap("unresolved", "source-owner-unavailable", "The source owner did not complete this exact original read.")
    return response.body
  }
  const json = async (path: string) => {
    const bytes = await read(path)
    try { return object(JSON.parse(decode(bytes))) }
    catch (error) { if (error instanceof SourceGap) throw error; return gap("unresolved", "invalid-owner-response", "The source owner returned an unsupported JSON representation.") }
  }
  const repository = async () => {
    const value = await json(prefix)
    same(text(value.full_name).toLowerCase(), target.repository)
    if (!integer(value.id)) return gap("unresolved", "repository-identity-unavailable", "The source owner did not establish the repository's numeric identity.")
    return { host: "github.com", repository: target.repository, repository_id: value.id }
  }
  const commit = async (id: string) => {
    const value = await json(`${prefix}/git/commits/${id}`)
    same(value.sha, id)
    oid(object(value.tree).sha)
    if (!Array.isArray(value.parents) || value.parents.length > 100) return gap("unresolved", "invalid-owner-response", "The Git commit parent coverage is incomplete or unsupported.")
    return { object_type: "commit", commit_sha: id, tree_sha: object(value.tree).sha,
      message: text(value.message), author: object(value.author), committer: object(value.committer),
      parents: value.parents.map(parent => ({ commit_sha: oid(object(parent).sha) })),
      representation: "source-owner Git commit field projection; not raw serialized Git object bytes",
      transport_qualification: "GitHub CLI JSON presentation may neutralize terminal control characters" }
  }
  const attempt = async (run: number, number: number) => {
    const value = await json(`${prefix}/actions/runs/${run}/attempts/${number}`)
    same(value.id, run); same(value.run_attempt, number)
    if (value.repository !== undefined) same(text(object(value.repository).full_name).toLowerCase(), target.repository)
    oid(value.head_sha)
    if (value.status !== "completed") return gap("unresolved", "incomplete-source", "The selected CI attempt is not complete; its later result is not substituted.")
    return { run_id: run, run_attempt: number, workflow_head_sha: value.head_sha,
      ...selected(value, ["workflow_id", "event", "status", "conclusion", "name", "path", "created_at", "run_started_at"]),
      tested_revision: "unknown; a workflow head is not proof of any job's actual checkout",
      test_event_coverage: "unknown; a suite-level conclusion is not a named test event" }
  }
  try {
    const owner = await repository()
    let original: Record<string, unknown>, revision: string
    if (target.kind === "commit") {
      original = await commit(target.commit); revision = `commit:${target.commit}`
    } else if (target.kind === "blob") {
      const resolvedCommit = await commit(target.commit)
      // Contents endpoints may dereference symlinks. Follow the commit's exact
      // Git trees instead, and admit only the requested regular blob entry.
      let treeID = oid(resolvedCommit.tree_sha), entry: Record<string, unknown> = {}
      const segments = target.path.split("/")
      for (let index = 0; index < segments.length; index++) {
        const tree = await json(`${prefix}/git/trees/${treeID}`)
        same(tree.sha, treeID)
        if (tree.truncated !== false || !Array.isArray(tree.tree))
          return gap("unresolved", "incomplete-git-tree", "The owner did not return a complete bounded directory tree.")
        const matches = tree.tree.map(object).filter(item => item.path === segments[index])
        if (!matches.length) return gap("missing", "git-path-missing", "The exact path is absent from the selected commit's tree.")
        if (matches.length !== 1) return gap("unresolved", "invalid-owner-response", "The owner returned an ambiguous tree entry.")
        entry = matches[0]!
        if (index + 1 < segments.length) {
          if (entry.type !== "tree" || entry.mode !== "040000")
            return gap("unsupported", "unsupported-git-entry", "The exact path crosses a non-directory Git entry.")
          treeID = oid(entry.sha)
        }
      }
      if (entry.type !== "blob" || !["100644", "100755"].includes(String(entry.mode)))
        return gap("unsupported", "unsupported-git-entry", "This view resolves a regular Git file, not a symlink or submodule target.")
      const blobID = oid(entry.sha), blob = await json(`${prefix}/git/blobs/${blobID}`)
      same(blob.sha, blobID); same(blob.encoding, "base64")
      const bytes = base64(blob.content)
      if (bytes.byteLength > EXTERNAL_ORIGINAL_LIMITS.originalBytes) return gap("unresolved", "processing-limit", "The exact file exceeds the bounded original size.")
      same(blob.size, bytes.byteLength)
      if (entry.size !== undefined) same(entry.size, bytes.byteLength)
      const actual = createHash(blobID.length === 40 ? "sha1" : "sha256").update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex")
      same(actual, blobID)
      original = { object_type: "blob", commit_sha: target.commit, tree_sha: resolvedCommit.tree_sha, path: target.path,
        blob_sha: blobID, content_sha256: bytesHash(bytes), byte_length: bytes.byteLength, representation: "complete original Git blob bytes",
        ...(isUTF8(bytes) ? { encoding: "utf8", content: decode(bytes) } : { encoding: "base64", content: Buffer.from(bytes).toString("base64") }),
        coverage: "complete selected file; no claim of complete commit diff" }
      revision = `commit:${target.commit}:blob:${blobID}`
    } else if (target.kind === "attempt") {
      original = await attempt(target.run, target.attempt); revision = `run:${target.run}:attempt:${target.attempt}`
    } else if (target.kind === "job") {
      const job = await json(`${prefix}/actions/jobs/${target.job}`)
      same(job.id, target.job); same(job.run_id, target.run)
      // New preview canonicalizes locator aliases. The explicit attempt remains
      // an asserted revision; a frozen canonical reference retains it too.
      // Only a complete matching tuple can restore the exact-attempt fallback.
      const declared = /^run:([0-9]+):attempt:([0-9]+):job:([0-9]+)$/.exec(request.source.revision ?? "")
      const asserted = target.attempt ?? (declared && sourceNumber(declared[1]!) === target.run
        && sourceNumber(declared[3]!) === target.job ? sourceNumber(declared[2]!) : undefined)
      // Normal GitHub job links omit the attempt. Resolve it from this exact
      // job's owner metadata, never from a run's current/latest attempt.
      const number = asserted ?? integer(job.run_attempt)
      if (number === undefined) return gap("unresolved", "job-attempt-unavailable", "The owner did not establish this exact job's attempt; latest-run data was not substituted.")
      revision = `run:${target.run}:attempt:${number}:job:${target.job}`
      if (request.source.revision !== undefined && request.source.revision !== revision)
        return gap("changed", "source-version-changed", "The exact job's attempt differs from its frozen identity; no later attempt or log was retrieved.")
      if (job.run_attempt !== undefined) same(job.run_attempt, number)
      const run = await attempt(target.run, number)
      // run_attempt may be absent on older owners. An exact attempt jobs endpoint
      // can establish it without ever reading the latest-attempt collection.
      if (job.run_attempt === undefined) {
        const jobs = await json(`${prefix}/actions/runs/${target.run}/attempts/${number}/jobs?per_page=100`)
        if (!Array.isArray(jobs.jobs) || !Number.isSafeInteger(jobs.total_count) || (jobs.total_count as number) !== jobs.jobs.length)
          return gap("unresolved", "incomplete-attempt-job-coverage", "The bounded attempt jobs response is incomplete; latest jobs are not substituted.")
        const exact = jobs.jobs.map(object).find(item => item.id === target.job)
        if (!exact) return gap("changed", "job-attempt-mismatch", "The selected job does not belong to the exact CI attempt.")
        same(exact.run_id, target.run); same(exact.head_sha, job.head_sha)
      }
      if (job.status !== "completed") return gap("unresolved", "incomplete-source", "The selected CI job is not complete.")
      const log = await read(`${prefix}/actions/jobs/${target.job}/logs`, EXTERNAL_ORIGINAL_LIMITS.originalBytes)
      original = { run, job: { job_id: target.job, run_id: target.run, run_attempt: number, workflow_head_sha: oid(job.head_sha),
        ...selected(job, ["name", "status", "conclusion", "started_at", "completed_at", "steps"]),
        tested_revision: "unknown; inspect the original checkout/test evidence", test_event_coverage: "not inferred from job or step conclusions" },
        log: { representation: "complete source-owner job log; GitHub masking may already redact runner content",
          encoding: "utf8", content: decode(log), byte_length: log.byteLength, content_sha256: bytesHash(log),
          coverage: "complete returned job log, not an assertion that the owner retained every runner event" } }
    } else {
      const artifact = await json(`${prefix}/actions/artifacts/${target.artifact}`)
      same(artifact.id, target.artifact); same(object(artifact.workflow_run).id, target.run)
      if (artifact.expired === true) return gap("missing", "artifact-expired", "The exact artifact has expired at its source owner.")
      if (typeof artifact.digest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(artifact.digest))
        return gap("unresolved", "artifact-digest-unavailable", "The owner did not supply the artifact archive digest required to verify these originals.")
      const bytes = await read(`${prefix}/actions/artifacts/${target.artifact}/zip`, EXTERNAL_ORIGINAL_LIMITS.originalBytes)
      if (artifact.digest !== `sha256:${bytesHash(bytes)}`) return gap("changed", "artifact-digest-mismatch", "The downloaded archive does not match its owner's digest; no content was released.")
      original = { artifact_id: target.artifact, run_id: target.run, name: text(artifact.name),
        workflow: selected(object(artifact.workflow_run), ["id", "repository_id", "head_repository_id", "head_sha"]),
        run_attempt: "unknown; artifact metadata does not establish a CI attempt", job_id: "unknown", tested_revision: "unknown",
        representation: "complete verified original artifact archive; no extraction or test-event interpretation", encoding: "base64",
        content: Buffer.from(bytes).toString("base64"), byte_length: bytes.byteLength, archive_sha256: bytesHash(bytes),
        reported_size_in_bytes: Number.isSafeInteger(artifact.size_in_bytes) && (artifact.size_in_bytes as number) >= 0 ? artifact.size_in_bytes : null,
        test_event_coverage: "uninspected; suite outcomes and named test events remain distinct" }
      revision = `run:${target.run}:artifact:${target.artifact}`
    }
    const value = { format: "loom-external-original/v1", owner, locator: descriptor.source.id, permitted_view: VIEW,
      original, coverage: { selected_original: "complete", broader_source: "not claimed" },
      authority: "current caller inspection through existing GitHub integration; no atomic revocation or protected-transfer claim" }
    const serialized = canonical(value, new ProcessingBudget(EXTERNAL_ORIGINAL_LIMITS.responseBytes, 100000))
    if (Buffer.byteLength(serialized) > EXTERNAL_ORIGINAL_LIMITS.responseBytes)
      return gap("unresolved", "processing-limit", "The complete permitted source view exceeds the response bound.")
    // Recheck every selected owner resource after all async reads. This observes
    // current permission; gh/GitHub do not offer an atomic native release fence.
    await options.authorize([...resources])
    options.signal.throwIfAborted()
    const sha256 = digest(value, new ProcessingBudget(EXTERNAL_ORIGINAL_LIMITS.responseBytes, 100000))
    if (request.source.revision !== undefined && request.source.revision !== revision
      || request.source.sha256 !== undefined && request.source.sha256 !== sha256)
      return { ...request, status: "changed", gap: { code: "source-version-changed", detail: "The exact frozen source view changed; its replacement was withheld." } }
    return { ...request, source: { ...request.source, revision, sha256 }, status: "available", value }
  } catch (error) {
    if (error instanceof SourceGap || error instanceof ProcessingLimitError) {
      await options.authorize([...resources])
      options.signal.throwIfAborted()
      return error instanceof SourceGap ? { ...request, status: error.status, gap: { code: error.code, detail: error.detail } }
        : { ...request, status: "unresolved", gap: { code: "processing-limit", detail: "The complete original exceeds the bounded representation; no excerpt was substituted." } }
    }
    throw error
  }
}

function isUTF8(bytes: Uint8Array): boolean {
  try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); return true } catch { return false }
}
