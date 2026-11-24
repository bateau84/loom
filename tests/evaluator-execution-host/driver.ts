/** Direct composed consumer from the installed package. TEST ONLY; no production tool activation. */
import { Database } from "bun:sqlite"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { NativeFixtureAuthority } from "./authority.js"

const [command, rootArg, packageArg, caseName = "first"] = process.argv.slice(2)
if (!command || !rootArg || !packageArg || !/^[a-z][a-z0-9-]*$/.test(caseName)) throw new Error("Fixture driver arguments required")
const root = resolve(rootArg), installed = resolve(packageArg), folder = join(root, "consumers", caseName)
mkdirSync(folder, { recursive: true, mode: 0o700 })
const load = (name: string) => import(pathToFileURL(join(installed, "src", name + ".ts")).href)
const [{ Learning }, { Store }, { digest }, { EvaluatorExecution }] = await Promise.all([
  load("learning"), load("store"), load("model"), load("evaluator-execution"),
])
const action = new Database(join(folder, "ledger.sqlite")), derived = new Database(join(folder, "learning.sqlite"))
const store = new Store(action), learning = new Learning(derived, store, action)
const actor = { session_id: "fixture-owner-" + caseName, agent: "general" }
let authority: NativeFixtureAuthority | undefined
try {
  const policy = JSON.parse(readFileSync(join(root, "policy.json"), "utf8"))
  if (command === "init") {
    const original = store.record(actor, undefined, { kind: "result", statement:
      "Synthetic original engineering objective " + caseName + ": correction must preserve verified scope." })
    const objective = learning.objectives.create(actor, learning.objectives.ledgerSource(original.id), "Scripted execution mechanics")
    for (const [index, verdict] of ["fail", "pass"].entries()) {
      const record = store.record(actor, undefined, { kind: "result", statement: "Synthetic attempt " + index + " verification: " + verdict })
      learning.objectives.link(actor, { objective_id: objective.id, phase: "verification", assessment: verdict,
        source: learning.objectives.ledgerSource(record.id) })
    }
    let batch = await learning.automatic.run(actor.session_id, async () => {}, new AbortController().signal)
    for (let count = 0; batch.state === "pending" && count < 100; count++)
      batch = await learning.automatic.run(actor.session_id, async () => {}, new AbortController().signal)
    if (batch.state !== "complete" || !batch.batch_id) throw new Error("Fixture Stage 3 did not complete")
    const prepared = learning.evaluator.prepare(actor, batch.batch_id, policy.method,
      { id: "fixture-controlled-provider-budget", revision: "1", sha256: digest({ capacity: policy.capacity }) })
    const members = learning.evaluator.members(actor.session_id, prepared.batch_id, prepared.request_id, prepared.manifest_sha256)
    if (!members.items.length || !members.items[0].source_refs.length) throw new Error("Fixture original source missing")
    const value = { pins: { batch_id: prepared.batch_id, request_id: prepared.request_id,
      manifest_sha256: prepared.manifest_sha256, attempt_id: prepared.issue.attempt.attempt_id },
      selected: { member: members.items[0].key, index: 0 } }
    writeFileSync(join(folder, "case.json"), JSON.stringify(value), { mode: 0o600 })
    console.log(JSON.stringify({ ok: true, pins: value.pins }))
  } else {
    const data = JSON.parse(readFileSync(join(folder, "case.json"), "utf8"))
    authority = new NativeFixtureAuthority(root, digest, data.selected)
    const execution = new EvaluatorExecution(learning.evaluator, learning.automatic.history, store, {
      authority, authorize: async (caller: { session_id: string }) => {
        if (caller.session_id !== actor.session_id || JSON.parse(readFileSync(join(root, "policy.json"), "utf8")).source_enabled === false)
          throw new Error("Fixture original source disclosure revoked")
      },
    })
    if (command === "inspect") {
      console.log(JSON.stringify({ ok: true, snapshot: learning.automatic.history.readExecution(data.pins.batch_id, actor.session_id),
        issue: store.reviews.readIssue(actor, data.pins.request_id) }))
    } else if (["execute", "recover", "cancel"].includes(command)) {
      const result = command === "execute" ? await execution.execute(actor, data.pins, new AbortController().signal)
        : command === "recover" ? await execution.recover(actor, data.pins) : await execution.cancel(actor, data.pins)
      console.log(JSON.stringify({ ok: true, result }))
    } else throw new Error("Unknown fixture driver command")
  }
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }))
  process.exitCode = 2
} finally {
  authority?.close(); derived.close(true); action.close(true)
}
