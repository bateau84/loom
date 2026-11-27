/** Direct composed consumer from the installed package. TEST ONLY; no production tool activation. */
import { Database } from "bun:sqlite"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
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
  const localViews: Record<string, string> = { "ledger-record": "record-full", objective: "objective", "objective-link": "objective-link" }
  const resolveOriginal = async (request: any) => {
    if (request.source_store_id !== learning.automatic.sources.namespace
      || request.source.session_id !== actor.session_id || localViews[request.source.kind] !== request.permitted_view)
      throw new Error("Fixture source identity or view denied")
    const original = learning.automatic.sources.retrospectiveOriginal(request.source.kind, request.source.id,
      request.source.session_id, request.recipient_session_id)
    if (request.purpose === "execute") authority!.journal.event("source-owner-read", {
      recipient_session_id: request.recipient_session_id, source: original?.ref ?? request.source,
      permitted_view: request.permitted_view, source_store_id: request.source_store_id })
    return { ...request, ...(original ? { status: "available", source: original.ref, value: original.value } : { status: "missing" }) }
  }
  if (command === "init") {
    const original = store.record(actor, undefined, { kind: "result", statement:
      "Synthetic original engineering objective " + caseName + ": correction must preserve verified scope." })
    const objective = learning.objectives.create(actor, learning.objectives.ledgerSource(original.id), "Scripted execution mechanics")
    for (const [index, verdict] of ["fail", "pass"].entries()) {
      const record = store.record(actor, undefined, { kind: "result", statement: "Synthetic attempt " + index + " verification: " + verdict })
      learning.objectives.link(actor, { objective_id: objective.id, phase: "verification", assessment: verdict,
        source: learning.objectives.ledgerSource(record.id) })
    }
    const budget = { id: "fixture-controlled-provider-budget", revision: "1", sha256: digest({ capacity: policy.capacity }) }
    let prepared, population
    if (policy.preparation_source === "retrospective") {
      learning.objectives.link(actor, { objective_id: objective.id, phase: "coverage-gap", gap_reason: "missing-source",
        source: { type: "unavailable", id: "fixture-missing-historical-original", verification: "reported-gap" },
        note: "No original was retained; the Evaluator must receive this frozen gap without invented source bytes." })
      const selected = { objective_id: objective.id }, associations = learning.objectives.retrospectiveSources(objective.id)
      const objectives = learning.objectives.historySnapshot(selected)
      const recordIDs = store.engineeringHistory.objectiveEvidenceSources(objectives.ledger_record_ids, objectives.ledger_through)
      const reviews = store.reviews.historySnapshot(actor, { record_ids: recordIDs, through: objectives.ledger_through })
      const boundary = { objective_links: associations.link_through,
        review_requests: reviews.request_through, review_relationships: reviews.relationship_through }
      const owners = { objectives, reviews, record_ids: recordIDs, boundary,
        version: digest({ objectives: objectives.content_digest, reviews: reviews.content_digest, boundary }) }
      const query = { ...selected, through: objectives.ledger_through, owner_boundary: boundary, limit: 50 }
      const manifest = await learning.populations.preview(actor, { ...selected, mode: "explicit-objective", exclusions: [],
        question: "Explain the bounded synthetic correction; preserve failed and successful attempts." }, {
          query, view: store.engineeringHistory.read(query, owners), owners, associations, contributors: associations.contributors,
        }, resolveOriginal)
      population = learning.automatic.history.freezeRetrospective(actor, manifest)
      await learning.populations.validateForPreparation(actor, population, resolveOriginal)
      prepared = learning.evaluator.prepareRetrospective(actor, population, policy.method, budget)
    } else {
      let batch = await learning.automatic.run(actor.session_id, async () => {}, new AbortController().signal)
      for (let count = 0; batch.state === "pending" && count < 100; count++)
        batch = await learning.automatic.run(actor.session_id, async () => {}, new AbortController().signal)
      if (batch.state !== "complete" || !batch.batch_id) throw new Error("Fixture Stage 3 did not complete")
      prepared = learning.evaluator.prepare(actor, batch.batch_id, policy.method, budget)
    }
    const members = learning.evaluator.members(actor.session_id, prepared.batch_id, prepared.request_id, prepared.manifest_sha256)
    if (!members.items.length || !members.items[0].source_refs.length) throw new Error("Fixture original source missing")
    const value = { pins: { batch_id: prepared.batch_id, request_id: prepared.request_id,
      manifest_sha256: prepared.manifest_sha256, attempt_id: prepared.issue.attempt.attempt_id },
      selected: (population ? members.items : members.items.slice(0, 1)).map((member: any) => ({ member: member.key, index: 0 })),
      objective_id: objective.id, request_format: prepared.request.format,
      ...(population ? { population_id: population.population_id, population_sha256: population.manifest_sha256,
        members: population.manifest.members.map((member: any) => ({ key: member.key, source: member.source,
          permitted_view: member.permitted_view, source_store_id: member.source_store_id, availability: member.availability })) } : {}) }
    writeFileSync(join(folder, "case.json"), JSON.stringify(value), { mode: 0o600 })
    console.log(JSON.stringify({ ok: true, pins: value.pins, request_format: value.request_format,
      ...(population ? { population_id: population.population_id, population_sha256: population.manifest_sha256,
        member_count: population.manifest.members.length } : {}) }))
  } else {
    const data = JSON.parse(readFileSync(join(folder, "case.json"), "utf8"))
    const owner = authority = new NativeFixtureAuthority(root, digest, data.selected)
    const stop = new AbortController()
    const event = (type: string, issue_key: string) => owner.journal.event(type, { command, issue_key })
    const prepare = owner.prepare.bind(owner), reserve = owner.reserve.bind(owner), validate = owner.validate.bind(owner)
    const execute = owner.execute.bind(owner), cancel = owner.cancel.bind(owner), native = owner.native.bind(owner)
    owner.prepare = async (...args) => {
      const grant = await prepare(...args)
      if (command === "execute-wrong-population") return { ...grant, subject: { ...grant.subject,
        source: { ...grant.subject.source, manifest_sha256: "0".repeat(64) } } }
      return grant
    }
    owner.reserve = async grant => {
      const admission = await reserve(grant)
      if (command === "execute-invalid-reservation") return { ...admission, reservation_id: "fixture-forged-reservation" }
      if (command === "execute-uncertain") {
        // The external fixture owner changes its real durable reservation after
        // reserve. The packed consumer must inspect current state before claim.
        owner.journal.db.transaction(() => {
          const saved = owner.journal.db.query("SELECT receipt_json FROM fixture_grants WHERE semantic_key=?")
            .get(grant.subject.semantic_key) as { receipt_json: string }
          const previous = JSON.parse(saved.receipt_json)
          const receipt = { ...previous, sequence: previous.sequence + 1,
            receipt_id: "fixture-uncertain:" + grant.subject.semantic_key, budget: "uncertain" }
          owner.journal.db.query("UPDATE fixture_grants SET receipt_json=? WHERE semantic_key=?")
            .run(JSON.stringify(receipt), grant.subject.semantic_key)
          event("fixture-reservation-uncertain", grant.subject.semantic_key)
        }).immediate()
      }
      return admission
    }
    owner.validate = async (admission, boundary, recheckCaller) => {
      if (boundary === "claim" && ["execute-loser-failure", "execute-loser-abort"].includes(command)) {
        event("driver-claim-paused", admission.grant.subject.semantic_key)
        writeFileSync(join(root, "loser-ready"), command, { mode: 0o600, flag: "wx" })
        const deadline = Date.now() + 20000
        while (!existsSync(join(root, "release-loser"))) {
          if (Date.now() >= deadline) throw new Error("Fixture losing caller barrier timed out")
          await new Promise(done => setTimeout(done, 25))
        }
        if (command === "execute-loser-failure") throw new Error("Fixture losing claim validation failed")
        stop.abort(new Error("Fixture losing caller aborted"))
      }
      return validate(admission, boundary, recheckCaller)
    }
    owner.execute = async (admission, source, signal) => {
      event("consumer-execute-entry", admission.grant.subject.semantic_key)
      const receipt = await execute(admission, source, signal)
      if (command !== "execute-winner" || receipt.execution !== "unknown") return receipt
      // Keep this winning caller alive while its real native provider is held.
      // Completion comes only from the original persisted native result.
      const deadline = Date.now() + 20000
      while (Date.now() < deadline) {
        signal.throwIfAborted()
        const snapshot = await owner.reconcile(admission.grant.subject)
        if (snapshot?.receipt.execution === "completed") return snapshot.receipt
        await new Promise(done => setTimeout(done, 25))
      }
      throw new Error("Fixture winning native result remained uncertain")
    }
    owner.cancel = async admission => {
      event("consumer-cancel-entry", admission.grant.subject.semantic_key)
      return cancel(admission)
    }
    owner.native = async (method, path, value) => {
      if (path.includes("/interrupt")) owner.journal.event("consumer-native-interrupt", { command })
      return native(method, path, value)
    }
    const execution = new EvaluatorExecution(learning.evaluator, learning.automatic.history, store, {
      authority, authorize: async (caller: { session_id: string }) => {
        if (caller.session_id !== actor.session_id || JSON.parse(readFileSync(join(root, "policy.json"), "utf8")).source_enabled === false)
          throw new Error("Fixture original source disclosure revoked")
      },
      ...(policy.preparation_source === "retrospective" ? { retrospective: {
        populations: learning.populations, resolve: resolveOriginal,
        authorize: async (recipient: { session_id: string; agent: string }, sources: any) => {
          if (sources.population_id !== data.population_id || sources.manifest_sha256 !== data.population_sha256
            || sources.owner_session !== actor.session_id || sources.source_store_id !== learning.automatic.sources.namespace
            || sources.contains_private_reviews || sources.contributors.some((session: string) => session !== actor.session_id)
            || !JSON.parse(readFileSync(join(root, "policy.json"), "utf8")).source_enabled)
            throw new Error("Fixture population source disclosure denied")
          if (recipient.session_id === actor.session_id) return
          const grants = owner.journal.db.query("SELECT grant_json FROM fixture_grants").all() as Array<{ grant_json: string }>
          const grant = grants.map(row => JSON.parse(row.grant_json)).find(grant => grant.recipient.session_id === recipient.session_id)
          if (command === "execute-denied-recipient" || recipient.agent !== "evaluator" || !grant
            || grant.subject.source?.population_id !== data.population_id
            || grant.subject.source?.manifest_sha256 !== data.population_sha256)
            throw new Error("Fixture actual Evaluator recipient denied")
          owner.journal.event("population-recipient-authorized", { population_id: sources.population_id,
            recipient_session_id: recipient.session_id, agent: recipient.agent })
        },
      } } : {}),
    })
    if (command === "inspect") {
      console.log(JSON.stringify({ ok: true, snapshot: learning.automatic.history.readExecution(data.pins.batch_id, actor.session_id),
        issue: store.reviews.readIssue(actor, data.pins.request_id) }))
    } else if (command === "append-history") {
      const later = store.record(actor, undefined, { kind: "result", statement: "LATER_HISTORY_MUST_NOT_ENTER_FROZEN_EVALUATION" })
      learning.objectives.link(actor, { objective_id: data.objective_id, phase: "verification", assessment: "pass",
        source: learning.objectives.ledgerSource(later.id) })
      const frozen = learning.automatic.history.retrospectivePopulation(data.population_id, actor.session_id)
      if (frozen.manifest_sha256 !== data.population_sha256 || frozen.manifest.members.some((member: any) => member.source.id === later.id))
        throw new Error("Later history changed the evaluated frozen population")
      console.log(JSON.stringify({ ok: true, result: { population_id: frozen.population_id,
        manifest_sha256: frozen.manifest_sha256, member_count: frozen.manifest.members.length, later_record_id: later.id } }))
    } else if (command === "change-original") {
      const member = data.members.find((item: any) => item.source.kind === "ledger-record")
      if (!member) throw new Error("Fixture selected ledger original missing")
      action.query("UPDATE ledger SET data=json_set(data,'$.statement',?) WHERE id=?")
        .run("CHANGED_ORIGINAL_MUST_NOT_AUTHORIZE_EXECUTION", member.source.id)
      console.log(JSON.stringify({ ok: true, result: { changed_source: member.source.id } }))
    } else if (["execute", "execute-uncertain", "execute-winner", "execute-loser-failure", "execute-loser-abort",
      "execute-wrong-population", "execute-invalid-reservation", "execute-denied-recipient", "execute-wrong-request", "recover", "cancel"].includes(command)) {
      const supplied = command === "execute-wrong-request" ? { ...data.pins, request_id: "wrong-execution-request" } : data.pins
      const result = command.startsWith("execute") ? await execution.execute(actor, supplied, stop.signal)
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
