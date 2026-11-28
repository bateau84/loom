import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { chmod, mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { digest } from "../src/model.js"
import { externalOriginalDescriptor, resolveExternalOriginal } from "../src/external-originals.js"
import { retrospectiveMemberKey } from "../src/retrospective-contract.js"
import type { RetrospectiveSourceRequest } from "../src/retrospective-populations.js"
import { registeredLoom } from "./helpers/registered-loom.js"
import { openState } from "./helpers/evaluator-execution-fixture.js"
import { publicationFixture } from "./helpers/evaluator-publication-fixture.js"
import { retrospectiveFixture } from "./helpers/retrospective-store-fixture.js"
import { expectInterpretationUnavailable } from "./helpers/evaluator-public-failure.js"

/** Three individually bounded frozen populations, linked through actual
 * execution-consumer publication. The registered read uses the production
 * external-original owner and CLI transport, not the fixture resolver or a
 * fabricated report. Its executable source owner is controlled and has no
 * real account or network access.
 */
async function historyFixture(counts: number[]) {
  const host = await registeredLoom()
  const path = join(host.directory, "state", "loom", "actions-v1", digest({ project: "tool-help", canonical: host.directory }))
  const state = openState(path), actor = { session_id: "owner", agent: "author" }
  const previousPath = process.env.PATH, bin = join(host.directory, "controlled-bin"), prefix = "/repos/fixture/interpretation-history"
  const messages = Array.from({ length: counts.reduce((sum, n) => sum + n, 0) }, (_, index) => {
    const sha = (index + 1).toString(16).padStart(40, "0")
    return { id: "https://github.com/fixture/interpretation-history/commit/" + sha,
      endpoint: prefix + "/git/commits/" + sha, sha }
  })
  const data: Record<string, unknown> = { [prefix]: { id: 42, full_name: "fixture/interpretation-history" } }
  for (const message of messages) data[message.endpoint] = { sha: message.sha, tree: { sha: "b".repeat(40) },
    message: "Controlled original engineering requirement " + message.sha,
    author: { name: "Controlled engineer" }, committer: { name: "Controlled engineer" }, parents: [] }
  const sync = () => writeFile(join(bin, "owner.json"), JSON.stringify(data))
  const controlled: ReturnType<typeof publicationFixture>[] = []
  const reports: Awaited<ReturnType<ReturnType<typeof publicationFixture>["publish"]>>[] = []
  try {
    await mkdir(bin)
    await writeFile(join(bin, "gh"), `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path'),args=process.argv.slice(2);
const expected=['api','--hostname','github.com','--method','GET','--allow-escape-sequences','--header','X-GitHub-Api-Version: 2022-11-28'];
if(args.length===2&&args[0]==='api'&&args[1]==='--help'){process.stdout.write('--allow-escape-sequences\\n');process.exit(0)}
if(args.length!==expected.length+1||expected.some((value,index)=>args[index]!==value)){process.stderr.write('Invalid controlled argv');process.exit(2)}
const endpoint=args.at(-1),data=JSON.parse(fs.readFileSync(path.join(__dirname,'owner.json'),'utf8'));
fs.appendFileSync(path.join(__dirname,'calls'),endpoint+'\\n');
if(!Object.hasOwn(data,endpoint)){process.stderr.write('HTTP 404');process.exit(1)}
process.stdout.write(JSON.stringify(data[endpoint]));
`)
    await chmod(join(bin, "gh"), 0o700)
    await sync(); process.env.PATH = bin + ":" + (previousPath ?? "")
    const resolve = (request: RetrospectiveSourceRequest) => resolveExternalOriginal(request, {
      directory: host.directory, signal: new AbortController().signal, authorize: async () => {},
      // Publication uses the controlled source-owner transport seam. The public
      // reader below uses the production executable/permission path instead.
      transport: async endpoint => Object.hasOwn(data, endpoint) ? { status: 200, body: Buffer.from(JSON.stringify(data[endpoint])) }
        : { status: 404, body: new Uint8Array() },
    })
    let offset = 0
    for (const [index, count] of counts.entries()) {
      expect(count).toBeLessThanOrEqual(54)
      const manifest = retrospectiveFixture(count, state.store.reviews.storeID)
      manifest.contributors = [actor.session_id]
      const selected = []
      for (const [position, member] of manifest.members.entries()) {
        const descriptor = externalOriginalDescriptor({ kind: "external-ref", id: messages[offset + position]!.id, required: true })!
        const request: RetrospectiveSourceRequest = { ...descriptor, recipient_session_id: actor.session_id, purpose: "preview" }
        const original = await resolve(request)
        expect(original.status).toBe("available")
        selected.push({ ...member, source_store_id: descriptor.source_store_id, source: original.source, permitted_view: request.permitted_view,
          key: retrospectiveMemberKey(descriptor.source_store_id, original.source, request.permitted_view) })
      }
      manifest.members = selected
      offset += count
      // Each new chunk advances the selection frontier. Its size is not a
      // historical cursor: the final 20/21-source chunk is later than the two
      // preceding 54-source chunks, not a rewind to frontier 20/21.
      manifest.selection.through = offset
      manifest.selection.owner_boundary.objective_links = offset
      const f = publicationFixture(state, actor, { manifest, resolve, authorityPath: join(host.directory, "authority-" + index + ".sqlite") })
      controlled.push(f)
      const prior = reports.at(-1)
      if (prior) f.interpretation.prior_interpretations.push({ report_id: prior.report_id, report_sha256: prior.report_sha256,
        relation: "contests", reason: "Later controlled evidence limits the earlier interpretation." })
      await f.execute()
      reports.push(await f.publish())
    }
    const originalReads = () => {
      try { return readFileSync(join(bin, "calls"), "utf8").split("\n").filter(endpoint => endpoint.includes("/git/commits/")) }
      catch { return [] }
    }
    let previousReads = 0
    const reads = { get count() { return originalReads().length - previousReads },
      get endpoints() { return originalReads().slice(previousReads) },
      set count(value: number) { previousReads = originalReads().length - value } }
    const read = (input: Record<string, unknown>) => host.tools.get("insights").execute({
      operation: "evaluation-interpretation", batch_id: reports.at(-1)!.batch_id, section: "overview", ...input,
    }, { sessionID: "owner", agent: "author", messageID: "history-message", id: "history-call", signal: new AbortController().signal })
    return { host, state, controlled, reports, messages, data, sync, reads, read,
      async close() { host.permission.beforeReturn = undefined; for (const f of controlled) f.close(); state.close();
        process.env.PATH = previousPath; await host.close() } }
  } catch (error) { for (const f of controlled) f.close(); state.close(); process.env.PATH = previousPath; await host.close(); throw error }
}

for (const total of [128, 129, 162]) test(`registered revision readback validates ${total} distinct originals without the old per-population ceiling`, async () => {
  const f = await historyFixture([54, 54, total - 108])
  try {
    const output = await f.read({})
    const page = JSON.parse(output.content).result
    expect(page.report_id).toBe(f.reports.at(-1)!.report_id)
    expect(page.report_sha256).toBe(f.reports.at(-1)!.report_sha256)
    // Every distinct original reaches its actual executable owner exactly once;
    // skipping validation cannot pass as a deduplication optimization.
    expect(f.reads.count).toBe(total)
    expect(new Set(f.reads.endpoints)).toEqual(new Set(f.messages.map(message => message.endpoint)))
    const final = f.host.permissionRequests.at(-1)
    expect(final.metadata.view_sha256).toBe(createHash("sha256").update(output.content).digest("hex"))
    for (const message of f.messages) {
      expect(final.resources).toContain(`loom:evidence:inspect:external:${encodeURIComponent(message.id)}:view:github-original/v1`)
      expect(final.resources).toContain(`loom:evidence:disclose:external:${encodeURIComponent(message.id)}:view:github-original/v1:recipient:owner`)
    }
    f.reads.count = 0
    const listed = await f.host.tools.get("insights").execute({ operation: "evaluation-interpretations", limit: 10 },
      { sessionID: "owner", agent: "author", messageID: "list-message", id: "list-call", signal: new AbortController().signal })
    const list = JSON.parse(listed.content).result
    expect(list.items).toHaveLength(3)
    expect(new Set(list.items.map((item: any) => item.report_id))).toEqual(new Set(f.reports.map(report => report.report_id)))
    // All three candidates depend on the first population; the union is resolved
    // once for this invocation rather than independently for every candidate.
    expect(f.reads.count).toBe(total)
    expect(new Set(f.reads.endpoints)).toEqual(new Set(f.messages.map(message => message.endpoint)))
    const listFinal = f.host.permissionRequests.at(-1)
    expect(new Set(listFinal.resources)).toEqual(new Set(final.resources))
    expect(listFinal.metadata.view_sha256).toBe(createHash("sha256").update(listed.content).digest("hex"))
    for (const controlled of f.controlled) expect(controlled.base.counts().effects).toBe(1)
    expect(f.host.sessionCreates).toEqual([]); expect(f.host.sessionPrompts).toEqual([])
  } finally { await f.close() }
}, 60000)

test("inherited originals remain subject to current denial and loss after deduplicated resolution", async () => {
  const f = await historyFixture([54, 54, 54])
  try {
    const original = f.controlled[0]!.population.manifest.members[1]!.source
    const dependent = `loom:evidence:disclose:external:${encodeURIComponent(original.id)}:view:github-original/v1:recipient:owner`
    await f.read({})
    f.reads.count = 0
    f.host.permission.beforeReturn = async () => {
      // Revoke only after actual original-owner work, so a discovery check or
      // invocation-local source cache cannot be mistaken for the final grant.
      if (f.reads.count && f.host.permissionRequests.at(-1)?.resources?.includes(dependent))
        throw new Error("Inherited original revoked after resolution")
    }
    await expectInterpretationUnavailable(f.read({}))
    f.host.permission.beforeReturn = undefined
    delete f.data[f.messages.find(message => message.id === original.id)!.endpoint]
    await f.sync()
    await expectInterpretationUnavailable(f.read({}))
    for (const report of f.reports) expect(f.state.learning.automatic.history.readEvaluatorInterpretation(report.batch_id, "owner")!.report.id).toBe(report.report_id)
    for (const controlled of f.controlled) expect(controlled.base.counts().effects).toBe(1)
  } finally { await f.close() }
}, 60000)
