import { randomUUID } from "node:crypto"
import { canonical, type Actor } from "./model.js"
import type { EvaluatorPreparation } from "./evaluator-preparation.js"
import type { EvaluationStore } from "./evaluation-store.js"
import type { Store } from "./store.js"
import { evaluatorEnrollmentKey, evaluatorReservationHeld, parseEvaluatorAdmission, parseEvaluatorGrant, parseEvaluatorReceipt,
  type EvaluatorExecutionAdmission, type EvaluatorExecutionAuthority, type EvaluatorExecutionReceipt,
  type EvaluatorExecutionGrant, type EvaluatorExecutionSnapshot, type EvaluatorExecutionSubject, type EvaluatorSourceReader } from "./evaluator-execution-contract.js"
import type { RetrospectivePopulations, RetrospectiveSourceResolver } from "./retrospective-populations.js"
import { retrospectiveBudget, type RetrospectiveSources } from "./retrospective-contract.js"
import { evaluatorPublication } from "./evaluator-publication.js"
import { EvaluatorInterpretations } from "./evaluator-interpretations.js"

export type EvaluatorExecutionPins = { batch_id: string; request_id: string; manifest_sha256: string; attempt_id: string }
type Integration = {
  authority: EvaluatorExecutionAuthority; authorize: (actor: Actor) => Promise<void>;
  /** Explicit trusted capability, absent from production. authorize covers the
   * complete population AND selected source-view inspection/disclosure union
   * for this actual reader, including frozen gaps and private scope. It derives
   * that union from the exact population pins; metadata access alone is not
   * sufficient. resolve separately validates each current exact original. */
  retrospective?: {
    populations: RetrospectivePopulations; resolve: RetrospectiveSourceResolver;
    authorize: (recipient: Actor, population: RetrospectiveSources) => Promise<void>;
    /** S5 revisions inherit multiple populations. Their final disclosure gate
     * must decide the complete union together, not combine stale grants. */
    authorizeUnion?: (recipient: Actor, populations: RetrospectiveSources[]) => Promise<void>;
  };
}
type Prepared = ReturnType<EvaluatorPreparation["read"]>
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b)

/** Consumer of a trusted execution owner, not an authority issuer or runtime.
 * Learning constructs this WITHOUT integration. Only qualification code supplies
 * the controlled fixture adapter; no public tool/configuration can install one.
 * There is intentionally no automatic scheduler or retry. Publication is an
 * explicit no-inference read of the already completed original result.
 */
export class EvaluatorExecution {
  constructor(private readonly preparation: EvaluatorPreparation, private readonly history: EvaluationStore,
    private readonly store: Store, private readonly integration?: Integration, private readonly clock = Date.now) {}

  private connected(): Integration {
    if (!this.integration) throw new Error("evaluator-execution-authority-unavailable")
    return this.integration
  }
  private pins(input: EvaluatorExecutionPins): void {
    if (!input || typeof input !== "object" || Array.isArray(input)
        || Object.keys(input).sort().join() !== "attempt_id,batch_id,manifest_sha256,request_id"
        || Object.values(input).some(v => typeof v !== "string" || !v)) throw new Error("Invalid evaluator execution pins")
  }
  private prepared(actor: Actor, pins: EvaluatorExecutionPins): Prepared {
    this.pins(pins)
    const p = this.preparation.read(actor.session_id, pins.batch_id)
    if (p.request.format === "loom-evaluation-request/v2" && !this.connected().retrospective)
      throw new Error("retrospective-execution-disconnected")
    if (p.state !== "prepared" || p.request_id !== pins.request_id || p.manifest_sha256 !== pins.manifest_sha256
        || p.issue?.attempt.attempt_id !== pins.attempt_id) throw new Error("Evaluator execution preparation mismatch")
    return p
  }
  private subject(actor: Actor, p: Prepared): EvaluatorExecutionSubject {
    if (!p.issue) throw new Error("Evaluator execution issue unavailable")
    // Stage 3 can allocate another local batch UUID after an older restore.
    // Exclude that allocation, but retain the exact original source vector,
    // membership, method and policies. This is an idempotency key, NOT a grant.
    const source = p.request.format === "loom-evaluation-request/v2" ? p.request.source : undefined
    const semantic_key = evaluatorEnrollmentKey({ source_store_id: p.manifest.source_store_id,
      owner_session: actor.session_id, boundary: p.manifest.boundary, membership_sha256: p.manifest.membership_sha256,
      method: p.request.method, source_policy: p.request.source_policy, route_policy: p.request.route_policy,
      budget_policy: p.request.budget_policy, ...(source ? { source } : {}) })
    return { source_store_id: p.manifest.source_store_id, owner_session: actor.session_id, batch_id: p.batch_id,
      request_id: p.request_id, attempt_id: p.issue.attempt.attempt_id, manifest_sha256: p.manifest_sha256, semantic_key,
      ...(source ? { source } : {}) }
  }
  private async population(actor: Actor, pins: EvaluatorExecutionPins, recipient: Actor = actor) {
    this.pins(pins)
    const source = this.preparation.retrospectiveReference(actor.session_id, pins.batch_id)
    if (!source) return null
    const integration = this.connected().retrospective
    if (!integration) throw new Error("retrospective-execution-disconnected")
    const metadata = this.history.retrospectiveSources(source.population_id, actor.session_id)
    if (metadata.manifest_sha256 !== source.manifest_sha256
        || metadata.contains_private_reviews && recipient.session_id !== metadata.owner_session)
      throw new Error("Retrospective execution population unavailable")
    // Authorize metadata before hydrating the manifest, including when every
    // member is a frozen gap and no original resolver will be called.
    await integration.authorize(recipient, metadata)
    if (!same(metadata, this.history.retrospectiveSources(source.population_id, actor.session_id)))
      throw new Error("Retrospective execution population changed")
    const population = this.history.retrospectivePopulation(source.population_id, actor.session_id)
    if (population.manifest_sha256 !== source.manifest_sha256) throw new Error("Retrospective execution population changed")
    return population
  }
  private async validatePopulation(actor: Actor, pins: EvaluatorExecutionPins, grant: EvaluatorExecutionGrant, signal: AbortSignal) {
    const recipient: Actor = { session_id: grant.recipient.session_id, agent: grant.recipient.agent }
    const population = await this.population(actor, pins, recipient)
    if (!population) return
    const integration = this.connected().retrospective!
    await integration.populations.validateSources(recipient, population, async request => {
      signal.throwIfAborted()
      this.live(grant.expires_at)
      const result = await integration.resolve(request)
      signal.throwIfAborted()
      this.live(grant.expires_at)
      return result
    }, "execute")
    await this.connected().authorize(actor)
    await this.population(actor, pins, recipient)
    signal.throwIfAborted()
    this.live(grant.expires_at)
  }
  private bound(subject: EvaluatorExecutionSubject, raw: unknown, prepared?: Prepared): EvaluatorExecutionAdmission {
    const admission = parseEvaluatorAdmission(raw)
    if (!same(admission.grant.subject, subject)) throw new Error("Evaluator execution restore or authority binding conflict")
    if (prepared && !same(admission.grant.method, prepared.method_manifest)) throw new Error("Evaluator effective method changed")
    return admission
  }
  private live(expiresAt: string): void {
    if (Date.parse(expiresAt) <= this.clock()) throw new Error("Evaluator execution authority expired")
  }
  private remember(actor: Actor, subject: EvaluatorExecutionSubject, snapshot: EvaluatorExecutionSnapshot) {
    const admission = this.bound(subject, snapshot.admission)
    const observation = parseEvaluatorReceipt(snapshot.receipt, admission)
    const issue = this.store.reviews.readIssue(actor, subject.request_id)
    if (issue.attempt.attempt_id !== subject.attempt_id) throw new Error("Evaluator canonical issue changed")
    this.history.saveExecutionAdmission(subject.batch_id, actor.session_id, admission)
    const current = this.history.appendExecutionReceipt(subject.batch_id, actor.session_id, observation)
    // A concurrent reconciliation can replay an exact older observation. The
    // store preserves it idempotently; return the latest accepted receipt too.
    const receipt = current.receipts.at(-1)!
    // Reconciliation cannot acquire a missing/restored claim. Preserve a known
    // original claimant only; an effect receipt never mints a new permit.
    // Effect non-admission can follow native inbox admission and source exposure.
    // It cannot prove native pre-admission rejection or resolve that uncertainty.
    if (issue.attempt.claimant_id) this.store.reviews.issues.recordOutcome(issue.intent, issue.attempt.claimant_id, {
      status: ["admitted", "completed", "failed"].includes(receipt.execution) || receipt.result ? "issued" : "unknown",
      source_ref: receipt.receipt_id, reason: "execution-owner-observation-not-Q4-provenance",
    })
    return { admission, receipt }
  }
  private async disclose(actor: Actor, pins: EvaluatorExecutionPins, snapshot: EvaluatorExecutionSnapshot) {
    await this.connected().authorize(actor)
    if (snapshot.admission.grant.subject.source) {
      const population = await this.population(actor, pins)
      if (!population) throw new Error("Retrospective execution population unavailable")
      const integration = this.connected().retrospective!
      // Accounting has already been retained. Like v1, result disclosure still
      // requires the actual reader's current originals and source permissions;
      // it does not require a live inference grant or execution-recipient rights.
      await integration.populations.validateSources(actor, population, integration.resolve, "inspect")
      await this.connected().authorize(actor)
      await this.population(actor, pins)
    }
    this.prepared(actor, pins)
    return { ...snapshot, interpretation: null, qualification: "execution-consumer-only" as const }
  }
  private async existing(actor: Actor, pins: EvaluatorExecutionPins) {
    this.pins(pins)
    const saved = this.history.readExecution(pins.batch_id, actor.session_id)
    if (saved?.admission.grant.subject.source && !this.connected().retrospective)
      throw new Error("retrospective-execution-disconnected")
    const subject = saved?.admission.grant.subject ?? this.subject(actor, this.prepared(actor, pins))
    if (subject.batch_id !== pins.batch_id || subject.request_id !== pins.request_id
        || subject.attempt_id !== pins.attempt_id || subject.manifest_sha256 !== pins.manifest_sha256)
      throw new Error("Evaluator execution pins disagree with saved admission")
    return { saved, subject }
  }

  /** Accounting recovery is permitted after inference expiry/revocation. Current
   * source/readback permission is still required before returning any result ID. */
  async recover(actor: Actor, pins: EvaluatorExecutionPins) {
    const { authority } = this.connected(), { subject } = await this.existing(actor, pins)
    const snapshot = await authority.reconcile(subject)
    if (!snapshot) throw new Error("Evaluator execution inventory unavailable; no absence inferred")
    const remembered = this.remember(actor, subject, snapshot)
    return this.disclose(actor, pins, remembered)
  }
  /** S5 consumes only the existing owner's original completed result. There is
   * no public result-body argument and no execution path inside publication. */
  async publish(actor: Actor, pins: EvaluatorExecutionPins, signal?: AbortSignal) {
    const integration = this.connected(), { authority, retrospective } = integration
    if (!authority.readResult || !retrospective) throw new Error("evaluator-result-readback-unavailable")
    signal?.throwIfAborted()
    const recovered = await this.recover(actor, pins)
    signal?.throwIfAborted()
    if (recovered.receipt.execution !== "completed" || recovered.receipt.budget !== "settled")
      throw new Error("Evaluator publication requires a completed result with authoritative accounting")
    const original = await authority.readResult(recovered.admission, recovered.receipt)
    signal?.throwIfAborted()
    await integration.authorize(actor)
    const population = await this.population(actor, pins)
    if (!population) throw new Error("Evaluator publication requires a frozen retrospective population")
    const body = evaluatorPublication(recovered.admission, recovered.receipt, original, population)
    const interpretations = new EvaluatorInterpretations(this.history, retrospective.populations, retrospective)
    // The final source/disclosure decision must follow this caller await. A
    // permission change during it must not commit or reveal a report identity.
    await integration.authorize(actor)
    await interpretations.authorizePublication(actor, population, body, signal)
    signal?.throwIfAborted()
    this.prepared(actor, pins)
    const report = this.history.publishEvaluatorInterpretation(pins.batch_id, actor.session_id, body).report
    return { batch_id: pins.batch_id, report_id: report.id, report_sha256: report.sha256, qualification: "publication-mechanics-only" as const }
  }
  async cancel(actor: Actor, pins: EvaluatorExecutionPins) {
    const { authority } = this.connected(), { subject } = await this.existing(actor, pins)
    const snapshot = await authority.reconcile(subject)
    if (!snapshot) throw new Error("Evaluator execution inventory unavailable; no cancellation inferred")
    const admission = this.bound(subject, snapshot.admission)
    this.remember(actor, subject, snapshot)
    const receipt = await authority.cancel(admission)
    return this.disclose(actor, pins, this.remember(actor, subject, { admission, receipt }))
  }

  async execute(actor: Actor, pins: EvaluatorExecutionPins, signal: AbortSignal) {
    const { authority, authorize } = this.connected()
    await authorize(actor)
    signal.throwIfAborted()
    this.pins(pins)
    if (this.preparation.retrospectiveReference(actor.session_id, pins.batch_id)) {
      await this.population(actor, pins)
      signal.throwIfAborted()
    }
    let prepared = this.prepared(actor, pins)
    const subject = this.subject(actor, prepared), saved = this.history.readExecution(pins.batch_id, actor.session_id)
    // Always consult the owner's inventory, including on a pristine local store.
    // A semantic collision after rollback must recover the original or fence.
    const remote = await authority.reconcile(subject)
    let admission: EvaluatorExecutionAdmission
    if (remote) {
      admission = this.bound(subject, remote.admission, prepared)
      const known = this.remember(actor, subject, remote)
      if (!evaluatorReservationHeld(known.receipt) || prepared.issue?.attempt.claimant_id)
        return this.disclose(actor, pins, known)
    } else {
      if (saved || prepared.issue?.attempt.claimant_id || prepared.issue?.attempt.state !== "prepared")
        throw new Error("Evaluator execution history disagreement; reconciliation required")
      if (!prepared.request.budget_policy) throw new Error("Evaluator execution budget authority required")
      const grant = parseEvaluatorGrant(await authority.prepare(subject, prepared.method_manifest, prepared.request.budget_policy))
      if (!same(grant.subject, subject) || !same(grant.method, prepared.method_manifest)) throw new Error("Evaluator prepared authority changed")
      this.live(grant.expires_at)
      if (subject.source) await this.validatePopulation(actor, pins, grant, signal)
      else await authorize(actor)
      signal.throwIfAborted()
      prepared = this.prepared(actor, pins)
      if (!same(this.subject(actor, prepared), subject)) throw new Error("Evaluator execution source changed")
      // A lost reserve ACK is an uncertain reservation, not permission to repeat.
      // The caller may recover; a repeated execute first inventories the owner.
      admission = this.bound(subject, await authority.reserve(grant), prepared)
      if (!same(admission.grant, grant)) throw new Error("Evaluator reserved authority changed")
      this.history.saveExecutionAdmission(pins.batch_id, actor.session_id, admission)
    }

    const claimantID = randomUUID()
    let claimAcknowledged = false
    try {
      await authorize(actor)
      signal.throwIfAborted()
      prepared = this.prepared(actor, pins)
      this.bound(this.subject(actor, prepared), admission, prepared)
      this.live(admission.grant.expires_at)
      let callerRechecked = false
      const claimReceipt = await authority.validate(admission, "claim", async () => {
        // The owner observes current reservation state only after this final
        // awaited caller check. Neither an old inventory read nor reserve's
        // immutable envelope proves that capacity is still held now.
        signal.throwIfAborted()
        if (subject.source) await this.validatePopulation(actor, pins, admission.grant, signal)
        else await authorize(actor)
        signal.throwIfAborted()
        this.live(admission.grant.expires_at)
        const current = this.prepared(actor, pins)
        this.bound(this.subject(actor, current), admission, current)
        callerRechecked = true
      })
      if (!callerRechecked) throw new Error("Evaluator claim authority omitted caller revalidation")
      const current = this.remember(actor, subject, { admission, receipt: claimReceipt })
      if (!evaluatorReservationHeld(current.receipt)) return this.disclose(actor, pins, current)
      // No awaited work separates the final authority observation and local
      // claim. The authority still owns concurrent revocation at actual sends.
      signal.throwIfAborted()
      this.live(admission.grant.expires_at)
      prepared = this.prepared(actor, pins)
      this.bound(this.subject(actor, prepared), admission, prepared)
      const claim = this.store.reviews.claimIssue(actor, { request_id: subject.request_id, kind: "initial" }, claimantID)
      if (claim.status !== "claimed-now") return this.recover(actor, pins)
      claimAcknowledged = true
      await authorize(actor)
      signal.throwIfAborted()
      if (subject.source) {
        await this.validatePopulation(actor, pins, admission.grant, signal)
        signal.throwIfAborted()
      }
      prepared = this.prepared(actor, pins)
      this.bound(this.subject(actor, prepared), admission, prepared)
      this.live(admission.grant.expires_at)
      const recheckSource = async () => {
        signal.throwIfAborted()
        await authorize(actor)
        this.live(admission.grant.expires_at)
        await authority.validate(admission, "source")
        signal.throwIfAborted()
        // The authority check may await native I/O. Caller read permission and
        // the deadline must still hold when the original bytes are returned.
        await authorize(actor)
        signal.throwIfAborted()
        this.live(admission.grant.expires_at)
        // Original owner reads are preserved; the trusted adapter independently
        // authorizes this exact recipient/transfer before receiving these bytes.
        this.bound(this.subject(actor, this.prepared(actor, pins)), admission)
      }
      const source = async (memberKey: string, sourceIndex: number) => {
        await recheckSource()
        if (!admission.grant.subject.source)
          return this.preparation.source(actor.session_id, pins.batch_id, pins.request_id, pins.manifest_sha256, memberKey, sourceIndex)
        const recipient: Actor = { session_id: admission.grant.recipient.session_id, agent: admission.grant.recipient.agent }
        const population = await this.population(actor, pins, recipient)
        if (!population) throw new Error("Retrospective execution population unavailable")
        signal.throwIfAborted()
        this.live(admission.grant.expires_at)
        const member = population.manifest.members.find(item => item.key === memberKey)
        if (!member || sourceIndex !== 0) throw new Error("Invalid evaluator preparation source selection")
        const integration = this.connected().retrospective!
        const resolved = await integration.populations.resolve(recipient, member, integration.resolve, "execute")
        if (member.availability === "available" && resolved.status !== "available")
          throw new Error("Retrospective execution source unavailable or changed")
        // These are current permission observations, not a native atomic Q5
        // release fence. The qualified source owner still owns actual release.
        await authority.validate(admission, "source")
        await authorize(actor)
        await this.population(actor, pins, recipient)
        signal.throwIfAborted()
        this.live(admission.grant.expires_at)
        this.bound(this.subject(actor, this.prepared(actor, pins)), admission)
        const { members: _members, ...header } = population.manifest
        const result = { batch_id: pins.batch_id, request_id: pins.request_id, manifest_sha256: pins.manifest_sha256,
          population_id: population.population_id, population_manifest_sha256: population.manifest_sha256,
          population_manifest: header, member_key: member.key, source_index: sourceIndex,
          member, source: member.source, source_store_id: member.source_store_id, permitted_view: member.permitted_view,
          ...resolved, receiving_session: recipient.session_id, native_evaluator_retrieval: "authority-must-observe" }
        canonical(result, retrospectiveBudget())
        return result
      }
      const recipient: Actor = { session_id: admission.grant.recipient.session_id, agent: admission.grant.recipient.agent }
      const contextPopulation = admission.grant.subject.source ? await this.population(actor, pins, recipient) : null
      const retrospective = this.connected().retrospective
      const unavailable = async () => { throw new Error("Earlier interpretation context requires an admitted retrospective population") }
      const contextReader = contextPopulation && retrospective
        ? new EvaluatorInterpretations(this.history, retrospective.populations, retrospective)
          .executionReader(actor, recipient, contextPopulation, recheckSource, signal)
        : { list: unavailable, read: unavailable, source: unavailable }
      const read: EvaluatorSourceReader = Object.assign(source, { interpretations: contextReader })
      const receipt = await authority.execute(admission, read, signal)
      const remembered = this.remember(actor, subject, { admission, receipt })
      // A result can arrive after an abort that the native owner did not yet
      // observe. Retain it, then fence/cancel through the catch path; do not
      // report an uncancelled completion or discard the late original result.
      signal.throwIfAborted()
      const visible = await this.disclose(actor, pins, remembered)
      signal.throwIfAborted()
      return visible
    } catch (error) {
      // A caller's failure/abort does not cancel another contender's shared
      // admission. Read durable ownership, including a possibly lost claim ACK;
      // missing or unreadable ownership supplies no cancellation authority.
      let ownsClaim = false
      if (signal.aborted || !claimAcknowledged) {
        try {
          const issue = this.store.reviews.readIssue(actor, subject.request_id)
          ownsClaim = issue.attempt.attempt_id === subject.attempt_id && issue.attempt.claimant_id === claimantID
        } catch { /* Ownership is unproven; reconciliation is the only cleanup. */ }
      }
      if (ownsClaim) {
        try { this.remember(actor, subject, { admission, receipt: await authority.cancel(admission) }) }
        catch { /* Preserve the original failure and uncertain owner reservation. */ }
      } else {
        try {
          const outcome = await authority.reconcile(subject)
          if (outcome) this.remember(actor, subject, outcome)
        } catch { /* No authoritative observation; the consumed claim stays held. */ }
      }
      throw error
    }
  }
}
