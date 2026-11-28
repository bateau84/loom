import { createHash } from "node:crypto"
import { join } from "node:path"
import { canonical, digest, type Actor } from "../../src/model.js"
import { EvaluatorExecution } from "../../src/evaluator-execution.js"
import { EvaluatorInterpretations } from "../../src/evaluator-interpretations.js"
import type { EvaluatorExecutionAuthority, EvaluatorRetrievedSource } from "../../src/evaluator-execution-contract.js"
import type { EvaluatorInterpretation } from "../../src/evaluator-interpretation.js"
import type { RetrospectiveSourceResolver } from "../../src/retrospective-populations.js"
import { retrospectiveMemberKey, type RetrospectiveManifest } from "../../src/retrospective-contract.js"
import { ACTOR, NOW, POLICY, FixtureExecutionAuthority, freshSignal, method, pins, type FixtureState } from "./evaluator-execution-fixture.js"
import { retrospectiveFixture } from "./retrospective-store-fixture.js"

/** Synthetic unit fixture using the existing #249/#259 consumer and owner.
 * Real installed OpenCode provenance is qualified by the separate host suite. */
export function publicationFixture(state: FixtureState, actor: Actor = ACTOR, options: { gaps?: boolean; claims?: number; members?: number; authorityPath?: string;
  manifest?: RetrospectiveManifest; resolve?: RetrospectiveSourceResolver } = {}) {
  const history = state.learning.automatic.history, manifest = options.manifest ? structuredClone(options.manifest)
    : retrospectiveFixture(options.members ?? 3, state.store.reviews.storeID)
  if (!options.manifest) manifest.members = manifest.members.map((member, index) => {
    const original = state.store.record({ session_id: actor.session_id, agent: "author" }, undefined,
      { kind: "result", statement: "Controlled original " + index + ": scoped verification; causal independence unproven." })
    const source = state.learning.automatic.sources.retrospectiveOriginal("ledger-record", original.id, actor.session_id, actor.session_id)!
    return { ...member, source: source.ref, key: retrospectiveMemberKey(manifest.source_store_id, source.ref, member.permitted_view),
      availability: options.gaps && index === 2 ? "unresolved" as const : "available" as const }
  })
  if (!options.manifest) manifest.contributors = [actor.session_id]
  const population = history.freezeRetrospective(actor, manifest)
  const prepared = state.learning.evaluator.prepareRetrospective(actor, population, method(), POLICY)
  // Freezing sorts member keys. A deliberately unavailable member can sort
  // first, so choose an actual available original for the scripted citation.
  const first = population.manifest.members.find(member => member.availability === "available")
  if (!first) throw new Error("Controlled publication fixture requires an available original")
  const reference = { member_key: first.key, source_index: 0 as const }
  const interpretation: EvaluatorInterpretation = {
    format: "loom-evaluator-interpretation/v1", covered_members: population.manifest.members.map(member => member.key),
    conclusion: { kind: "no-change", statement: "The controlled fixture supports no automatic configuration change.", limitations: ["Scripted publication mechanics only."] },
    trajectory: [{ event_id: "verification", statement: "The authored source describes scoped verification.", members: [first.key], supporting: [reference], limitations: ["No native reviewer independence established."] }],
    claims: Array.from({ length: options.claims ?? 7 }, (_, index) => ({ claim_id: "claim-" + index,
      kind: "authored", category: "successful-practice", basis: "supported", statement: "Preserve the stated verification scope " + index,
      members: [first.key], supporting: [reference], contradicting: [], limitations: ["Authored statement, not verified behavior."], applicability: ["Controlled fixture only"], recommendation: null })),
    review_coverage: [],
    gaps: population.manifest.members.filter(member => member.key !== first.key).map(member => ({ member_key: member.key,
      kind: member.availability === "available" ? "not-retrieved" : "unavailable", reason: "Explicit controlled fixture gap." })),
    qualifications: { chronology: ["Historical order is not causal attribution."], independence: "unknown" }, prior_interpretations: [],
  }
  const base = new FixtureExecutionAuthority(options.authorityPath ?? join(state.path, "publication-authority.sqlite"))
  base.source = { memberKey: first.key, sourceIndex: 0 }
  const retrieved: EvaluatorRetrievedSource[] = [{ ...reference, receipt_id: "controlled-delivery-1", boundary: "native-tool-result", source_sha256: first.source.sha256! }]
  let reads = 0, allowed = true
  const authority: EvaluatorExecutionAuthority = {
    reconcile: base.reconcile.bind(base), prepare: base.prepare.bind(base), reserve: base.reserve.bind(base),
    validate: base.validate.bind(base), cancel: base.cancel.bind(base),
    async execute(admission, readSource, signal) {
      // The existing owner consumes its reservation and reads the original.
      // Replace only this synthetic provider's scripted result before its first
      // receipt reaches the consumer. There is no production import surface.
      const receipt = await base.execute(admission, readSource, signal)
      if (!receipt.result || receipt.execution !== "completed") return receipt
      const text = JSON.stringify(interpretation)
      receipt.result.sha256 = createHash("sha256").update(text).digest("hex")
      base.db.query("UPDATE fixture_results SET content=? WHERE result_id=?").run(text, receipt.result.result_id)
      base.db.query("UPDATE fixture_enrollments SET receipt=? WHERE semantic_key=?").run(canonical(receipt), admission.grant.subject.semantic_key)
      return receipt
    },
    async readResult(admission, receipt) {
      reads++
      if (!receipt.result) throw new Error("Fixture result missing")
      const row = base.db.query("SELECT content FROM fixture_results WHERE result_id=?").get(receipt.result.result_id) as { content: string } | undefined
      if (!row) throw new Error("Fixture original result missing")
      return { format: "loom-evaluator-result/v1", admission_sha256: digest(admission), result: receipt.result, text: row.content, retrieved }
    },
  }
  const authorize = async () => { if (!allowed) throw new Error("Controlled source authorization denied") }
  const resolve: RetrospectiveSourceResolver = async request => {
    await authorize()
    if (options.resolve) return options.resolve(request)
    const ref = request.source, original = state.learning.automatic.sources.retrospectiveOriginal(ref.kind, ref.id, ref.session_id!, request.recipient_session_id)
    return original ? { ...request, status: "available", source: original.ref, value: original.value } : { ...request, status: "missing" }
  }
  const retrospective = { populations: state.learning.populations, resolve, authorize, authorizeUnion: authorize }
  const runtime = new EvaluatorExecution(state.learning.evaluator, history, state.store, { authority, authorize, retrospective }, () => NOW)
  return { state, actor, population, prepared, interpretation, base, authority, runtime, retrieved, resolve, authorize,
    reads: () => reads, deny: () => { allowed = false }, allow: () => { allowed = true },
    reader: () => new EvaluatorInterpretations(history, state.learning.populations, retrospective),
    execute: () => runtime.execute(actor, pins(prepared), freshSignal()), publish: () => runtime.publish(actor, pins(prepared)),
    close: () => base.close() }
}
