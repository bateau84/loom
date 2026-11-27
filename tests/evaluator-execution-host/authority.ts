/** TEST ONLY: trusted owner of this in-process zero-cost provider, never real authority. */
import { readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createHash, randomUUID } from "node:crypto"
import type { EvaluatorExecutionAuthority, EvaluatorExecutionSubject, EvaluatorExecutionGrant,
  EvaluatorExecutionAdmission, EvaluatorExecutionReceipt, EvaluatorExecutionSnapshot } from "../../src/evaluator-execution-contract.js"
import type { EvaluatorMethodManifest, EvaluatorPolicyRef } from "../../src/evaluator-method.js"
import { FixtureStore, ACCOUNT, MODEL, PROVIDER, RESULT, SOURCE_TOOL } from "./fixture-store.js"

const HOST = "isolated-opencode-230-fixture"
const sha = (text: string) => createHash("sha256").update(text).digest("hex")
type Saved = { grant_json: string; admission_json: string | null; receipt_json: string | null }
type Policy = { enabled: boolean; expires_at: string; capacity: number; account: string;
  mode: "complete" | "hold" | "reject"; method: EvaluatorMethodManifest; configuration_sha256: string; lose_ack?: boolean;
  preparation_source?: "stage3" | "retrospective" }
type Digest = (value: unknown) => string

export class NativeFixtureAuthority implements EvaluatorExecutionAuthority {
  readonly journal: FixtureStore
  constructor(readonly root: string, readonly digest: Digest,
    readonly selectedSources: Array<{ member: string; index: number }>) { this.journal = new FixtureStore(root) }
  policy(): Policy { return JSON.parse(readFileSync(join(this.root, "policy.json"), "utf8")) }
  async native(method: string, path: string, value?: unknown): Promise<any> {
    if (!path.startsWith("/api/session")) throw new Error("Fixture native endpoint outside owned Sessions")
    const endpoint = JSON.parse(readFileSync(join(this.root, "native.json"), "utf8"))
    const url = new URL(endpoint.url)
    if (url.hostname !== "127.0.0.1" || url.protocol !== "http:") throw new Error("Fixture requires loopback native host")
    const response = await fetch(endpoint.url + path, { method,
      headers: { Authorization: "Basic " + Buffer.from("opencode:" + endpoint.password).toString("base64"),
        "Content-Type": "application/json" }, body: value === undefined ? undefined : JSON.stringify(value),
      signal: AbortSignal.timeout(10000), redirect: "error" })
    if (!response.ok) throw new Error("Native fixture API rejected " + method + " " + path + ": " + response.status)
    const raw = await response.text()
    if (raw.length > 2097152) throw new Error("Native fixture read budget exceeded")
    const parsed = raw ? JSON.parse(raw) : null
    return parsed?.data ?? parsed
  }
  private saved(key: string): Saved | null {
    return this.journal.db.query("SELECT grant_json,admission_json,receipt_json FROM fixture_grants WHERE semantic_key=?")
      .get(key) as Saved | null
  }
  private assertSubject(saved: Saved, subject: EvaluatorExecutionSubject) {
    if (this.digest(JSON.parse(saved.grant_json).subject) !== this.digest(subject))
      throw new Error("Fixture semantic enrollment conflicts with restored local identity")
  }
  private permitted(grant?: EvaluatorExecutionGrant) {
    const policy = this.policy()
    if (!policy.enabled || policy.account !== ACCOUNT || Date.parse(policy.expires_at) <= Date.now())
      throw new Error("Fixture authority missing, revoked or expired")
    if (sha(readFileSync(join(this.root, "config/opencode/opencode.json"), "utf8")) !== policy.configuration_sha256)
      throw new Error("Fixture installed configuration changed")
    if (grant && (grant.account.account_id !== ACCOUNT || grant.account.credential_revision !== "fixture-credential-1"
      || this.digest(grant.method) !== this.digest(policy.method) || grant.expires_at !== policy.expires_at))
      throw new Error("Fixture effective method/account changed")
    return policy
  }
  private async recipient(grant: EvaluatorExecutionGrant) {
    const actual = await this.native("GET", "/api/session/" + grant.recipient.session_id)
    if (actual.id !== grant.recipient.session_id || actual.agent !== "evaluator"
      || actual.model?.providerID !== PROVIDER || actual.model?.id !== MODEL
      || actual.location?.directory !== join(this.root, "project"))
      throw new Error("Fixture actual recipient/model changed")
  }
  async prepare(subject: EvaluatorExecutionSubject, method: EvaluatorMethodManifest, _budget: EvaluatorPolicyRef) {
    const policy = this.permitted()
    if (this.digest(method) !== this.digest(policy.method)) throw new Error("Fixture method is not the installed fixture method")
    const existing = this.saved(subject.semantic_key)
    if (existing) { this.assertSubject(existing, subject); return JSON.parse(existing.grant_json) }
    const session = await this.native("POST", "/api/session", {
      id: "ses_eval_" + subject.semantic_key.slice(0, 32), agent: "evaluator", title: "Scripted restricted evaluation",
      location: { directory: join(this.root, "project") }, model: { providerID: PROVIDER, id: MODEL },
      permissions: policy.preparation_source === "retrospective"
        ? [{ action: "*", resource: "*", effect: "deny" }, { action: SOURCE_TOOL, resource: "*", effect: "allow" }]
        : [{ action: "*", resource: "*", effect: "deny" }],
    })
    const grant: EvaluatorExecutionGrant = {
      authority_id: "local-scripted-authority", grant_id: "fixture-grant:" + subject.semantic_key,
      expires_at: policy.expires_at, subject, method,
      recipient: { host_id: HOST, session_id: session.id, agent: "evaluator" },
      account: { provider_id: PROVIDER, model_id: MODEL, account_id: ACCOUNT, credential_revision: "fixture-credential-1" },
      source_authority_ref: "fixture-source-owner", account_authority_ref: "fixture-local-provider-owner",
      budget_authority_ref: "fixture-policy-pool", limits: policy.preparation_source === "retrospective"
        ? { requests: 2, input_tokens: 2, output_tokens: 2 } : { requests: 1, input_tokens: 1, output_tokens: 1 },
    }
    await this.recipient(grant)
    const prior = await this.native("GET", "/api/session/" + session.id + "/message?order=asc&limit=1")
    if (!Array.isArray(prior) || prior.length) throw new Error("Fixture recipient already has native history")
    return this.journal.db.transaction(() => {
      const raced = this.saved(subject.semantic_key)
      if (raced) { this.assertSubject(raced, subject); return JSON.parse(raced.grant_json) as EvaluatorExecutionGrant }
      this.journal.db.query("INSERT INTO fixture_grants(semantic_key,grant_json) VALUES (?,?)")
        .run(subject.semantic_key, JSON.stringify(grant))
      return grant
    }).immediate()
  }
  async reserve(grant: EvaluatorExecutionGrant) {
    this.permitted(grant); await this.recipient(grant)
    return this.journal.db.transaction(() => {
      const saved = this.saved(grant.subject.semantic_key)
      if (!saved || this.digest(JSON.parse(saved.grant_json)) !== this.digest(grant)) throw new Error("Forged fixture grant")
      if (saved.admission_json) return JSON.parse(saved.admission_json) as EvaluatorExecutionAdmission
      const poolID = "fixture-shared-account-pool"
      const policy = this.permitted(grant)
      this.journal.db.query("INSERT OR IGNORE INTO fixture_pools(pool_key,capacity) VALUES (?,?)").run(poolID, policy.capacity)
      const pool = this.journal.db.query("SELECT capacity,reserved FROM fixture_pools WHERE pool_key=?").get(poolID) as { capacity: number; reserved: number }
      if (pool.capacity !== policy.capacity || pool.reserved + grant.limits.requests > pool.capacity) throw new Error("Fixture shared pool has insufficient capacity")
      const admission: EvaluatorExecutionAdmission = { format: "loom-evaluation-admission/v1", grant,
        reservation_id: "fixture-reservation:" + grant.subject.semantic_key, pool_id: poolID, authority_epoch: "fixture-epoch-1" }
      const receipt = this.receipt(admission, 1, "reserved", "held", false, null, null)
      this.journal.db.query("UPDATE fixture_pools SET reserved=reserved+? WHERE pool_key=?").run(grant.limits.requests, poolID)
      this.journal.db.query("UPDATE fixture_grants SET admission_json=?,receipt_json=? WHERE semantic_key=?")
        .run(JSON.stringify(admission), JSON.stringify(receipt), grant.subject.semantic_key)
      this.journal.db.query(`INSERT INTO fixture_enrollments(issue_key,session_id,input_id,binding_sha256,
        pool_key,prompt_sha256,mode,expires_at_ms,request_limit) VALUES (?,?,?,?,?,?,?,?,?)`).run(grant.subject.semantic_key,
          grant.recipient.session_id, "msg_eval_" + grant.subject.semantic_key.slice(0, 32), this.digest(admission),
          poolID, "unadmitted", policy.mode, Date.parse(grant.expires_at), grant.limits.requests)
      return admission
    }).immediate()
  }
  async validate(admission: EvaluatorExecutionAdmission, boundary: "claim" | "source", recheckCaller?: () => Promise<void>) {
    this.permitted(admission.grant); await this.recipient(admission.grant)
    if (boundary === "claim") {
      if (!recheckCaller) throw new Error("Fixture claim validation requires caller recheck")
      await recheckCaller()
    }
    this.permitted(admission.grant)
    const saved = this.saved(admission.grant.subject.semantic_key), entry = this.journal.enrollment(admission.grant.subject.semantic_key)
    if (!saved?.admission_json || this.digest(JSON.parse(saved.admission_json)) !== this.digest(admission) || !entry || entry.revoked)
      throw new Error("Fixture authority revoked or admission mismatched")
    return JSON.parse(saved.receipt_json!) as EvaluatorExecutionReceipt
  }
  private receipt(admission: EvaluatorExecutionAdmission, sequence: number,
    execution: EvaluatorExecutionReceipt["execution"], budget: EvaluatorExecutionReceipt["budget"], fenced: boolean,
    usage: EvaluatorExecutionReceipt["usage"], result: EvaluatorExecutionReceipt["result"]): EvaluatorExecutionReceipt {
    return { format: "loom-evaluation-execution-receipt/v1", authority_id: admission.grant.authority_id,
      receipt_id: "fixture-receipt:" + admission.grant.subject.semantic_key + ":" + sequence, sequence,
      admission_sha256: this.digest(admission), reservation_id: admission.reservation_id, execution, budget, fenced, usage, result }
  }
  private observe(admission: EvaluatorExecutionAdmission, execution: EvaluatorExecutionReceipt["execution"],
    budget: EvaluatorExecutionReceipt["budget"], fenced: boolean, usage: EvaluatorExecutionReceipt["usage"],
    result: EvaluatorExecutionReceipt["result"]) {
    return this.journal.db.transaction(() => {
      const saved = this.saved(admission.grant.subject.semantic_key)
      if (!saved?.admission_json || this.digest(JSON.parse(saved.admission_json)) !== this.digest(admission))
        throw new Error("Fixture admission unavailable or forged")
      const previous = JSON.parse(saved.receipt_json!) as EvaluatorExecutionReceipt
      if (previous.execution === execution && previous.budget === budget && previous.fenced === fenced
        && this.digest(previous.usage) === this.digest(usage) && this.digest(previous.result) === this.digest(result)) return previous
      const receipt = this.receipt(admission, previous.sequence + 1, execution, budget, fenced, usage, result)
      this.journal.db.query("UPDATE fixture_grants SET receipt_json=? WHERE semantic_key=?")
        .run(JSON.stringify(receipt), admission.grant.subject.semantic_key)
      return receipt
    }).immediate()
  }
  async reconcile(subject: EvaluatorExecutionSubject): Promise<EvaluatorExecutionSnapshot | null> {
    const saved = this.saved(subject.semantic_key)
    if (!saved) return null
    this.assertSubject(saved, subject)
    if (!saved.admission_json) return null // No reservation/effect enrollment exists yet.
    const admission = JSON.parse(saved.admission_json) as EvaluatorExecutionAdmission
    let receipt = JSON.parse(saved.receipt_json!) as EvaluatorExecutionReceipt
    const entry = this.journal.enrollment(subject.semantic_key)
    if (!entry) throw new Error("Fixture external enrollment missing")
    if (receipt.budget === "settled" || receipt.budget === "released" || receipt.execution === "reserved") return { admission, receipt }
    const messages = await this.native("GET", "/api/session/" + entry.session_id + "/message?order=asc&limit=200")
    const list = Array.isArray(messages) ? messages : messages.data
    if (!Array.isArray(list) || list.length === 200) throw new Error("Fixture native history not bounded and complete")
    const original = list.find((message: any) => message.id === entry.input_id && message.type === "user")
    if (original && sha(original.text) !== entry.prompt_sha256) throw new Error("Fixture admitted original input changed")
    const results = list.filter((message: any) => message.type === "assistant" && message.agent === "evaluator"
      && message.model?.providerID === PROVIDER && message.model?.id === MODEL
      && message.finish === "stop" && message.time?.completed && !message.error
      && Array.isArray(message.content) && message.content.some((part: any) => part.type === "text" && part.text === RESULT))
    if (results.length > 1) throw new Error("Fixture native result identity ambiguous")
    const result = results[0]
    if (result && original && entry.consumed && entry.sends === entry.request_limit) {
      this.journal.db.query("UPDATE fixture_enrollments SET enabled=0 WHERE issue_key=?").run(subject.semantic_key)
      receipt = this.observe(admission, "completed", "settled", true,
        { requests: entry.sends, input_tokens: entry.sends, output_tokens: entry.sends },
        { host_id: HOST, session_id: entry.session_id, input_id: entry.input_id, result_id: result.id, sha256: sha(RESULT) })
    }
    return { admission, receipt }
  }
  async execute(admission: EvaluatorExecutionAdmission,
    source: (memberKey: string, sourceIndex: number) => Promise<unknown>, signal: AbortSignal) {
    this.permitted(admission.grant); await this.recipient(admission.grant)
    const key = admission.grant.subject.semantic_key, row = this.journal.enrollment(key)
    if (!row || row.binding_sha256 !== this.digest(admission) || row.revoked) throw new Error("Fixture permit revoked or mismatched")
    if (row.enabled || row.consumed) return (await this.reconcile(admission.grant.subject))!.receipt
    const retrospective = row.request_limit === 2
    // The native Evaluator retrieves v2 originals itself through one private
    // fixture tool. This ephemeral bridge retains the packed consumer's source
    // callback; it has no independent source policy or persisted source bodies.
    let callback: ReturnType<typeof Bun.serve> | undefined, started = false, callbackInstalled = false
    const callbackPath = join(this.root, "source-callback-" + key + ".json")
    try {
      if (retrospective) {
        const token = randomUUID()
        callback = Bun.serve({ hostname: "127.0.0.1", port: 0, maxRequestBodySize: 2048, fetch: async request => {
          try {
            if (request.method !== "POST" || new URL(request.url).pathname !== "/source"
              || request.headers.get("authorization") !== "Bearer " + token) throw new Error("Fixture source callback denied")
            const context = await request.json() as { session_id?: string; agent?: string; call_id?: string; message_id?: string }
            const current = this.journal.enrollment(key)
            if (started || context.session_id !== admission.grant.recipient.session_id || context.agent !== "evaluator"
              || context.call_id !== "call_eval_" + key.slice(0, 32) || typeof context.message_id !== "string"
              || !current || !current.enabled || current.revoked || current.sends !== 1 || current.source_delivery_count)
              throw new Error("Fixture actual source recipient or request stage denied")
            this.permitted(admission.grant)
            started = true // Claim synchronously before the first awaited recipient/source operation.
            await this.recipient(admission.grant)
            const originals = []
            for (const selected of this.selectedSources) originals.push(await source(selected.member, selected.index))
            signal.throwIfAborted()
            this.permitted(admission.grant); await this.recipient(admission.grant)
            const body = JSON.stringify({ format: "loom-controlled-retrospective-evidence/v1",
              subject: admission.grant.subject, recipient: admission.grant.recipient, originals })
            this.journal.event("consumer-source-returned", { issue_key: key, session_id: context.session_id,
              agent: context.agent, call_id: context.call_id, message_id: context.message_id,
              member_count: originals.length, sha256: sha(body), bytes: Buffer.byteLength(body) })
            return new Response(body, { headers: { "content-type": "application/json" } })
          } catch (error) {
            this.journal.event("consumer-source-denied", { issue_key: key,
              error: error instanceof Error ? error.message : String(error) })
            return new Response("Fixture source unavailable", { status: 403 })
          }
        } })
        writeFileSync(callbackPath, JSON.stringify({ url: callback.url.href + "source", token }), { mode: 0o600, flag: "wx" })
        callbackInstalled = true
      }
      const original = retrospective ? undefined : await source(this.selectedSources[0]!.member, this.selectedSources[0]!.index)
      if (signal.aborted) return this.cancel(admission)
      const text = retrospective ? "SCRIPTED_FIXTURE_RETROSPECTIVE\n" + JSON.stringify({ subject: admission.grant.subject,
        sources: this.selectedSources }) : "SCRIPTED_FIXTURE_ORIGINAL_SOURCE\n" + JSON.stringify(original)
      const receipt = this.journal.db.transaction(() => {
        this.permitted(admission.grant)
        const current = this.journal.enrollment(key)!
        if (current.enabled || current.consumed || current.revoked) throw new Error("Fixture effect already claimed")
        const reservation = JSON.parse(this.saved(key)!.receipt_json!) as EvaluatorExecutionReceipt
        if (reservation.execution !== "reserved" || reservation.budget !== "held" || reservation.fenced)
          throw new Error("Fixture execution reservation is not held")
        this.journal.db.query("UPDATE fixture_enrollments SET enabled=1,prompt_sha256=? WHERE issue_key=?").run(sha(text), key)
        return this.observe(admission, "unknown", "uncertain", false, null, null)
      }).immediate()
      await this.native("POST", "/api/session/" + row.session_id + "/prompt", {
        id: row.input_id, text, delivery: "steer", resume: true,
      })
      const deadline = Date.now() + 20000
      while (Date.now() < deadline) {
        if (signal.aborted) return this.cancel(admission)
        const entry = this.journal.enrollment(key)!
        // Keep the source bridge alive until the two-turn fixture reaches the
        // actual held second request. Lost acknowledgement never invents a result.
        if (this.policy().lose_ack && (!retrospective || entry.sends === entry.request_limit))
          throw new Error("Fixture lost acknowledgement after native admission")
        const snapshot = await this.reconcile(admission.grant.subject)
        if (snapshot?.receipt.budget === "settled") return snapshot.receipt
        if (entry.mode === "hold" && entry.sends === entry.request_limit) return receipt
        if (entry.mode === "reject" && entry.denied_sends) return this.cancel(admission)
        // A transformed/truncated native tool result cannot authorize the
        // second request. The first request already consumed capacity; retain
        // uncertainty without inventing zero usage or retry permission.
        if (entry.sends > 0 && entry.sends < entry.request_limit && entry.denied_sends) return receipt
        await new Promise(done => setTimeout(done, 25))
      }
      throw new Error("Fixture native result remains uncertain")
    } finally {
      callback?.stop(true)
      if (callbackInstalled) rmSync(callbackPath, { force: true })
    }
  }
  async cancel(admission: EvaluatorExecutionAdmission) {
    const key = admission.grant.subject.semantic_key
    const receipt = this.journal.db.transaction(() => {
      const entry = this.journal.enrollment(key)
      if (!entry || entry.binding_sha256 !== this.digest(admission)) throw new Error("Fixture cancellation binding mismatch")
      const previous = JSON.parse(this.saved(key)!.receipt_json!) as EvaluatorExecutionReceipt
      if (previous.budget === "settled" || previous.budget === "released") return previous
      this.journal.db.query("UPDATE fixture_enrollments SET enabled=0,revoked=1 WHERE issue_key=?").run(key)
      if (entry.consumed) return this.observe(admission, "unknown", "uncertain", true, null, null)
      this.journal.db.query("UPDATE fixture_pools SET reserved=reserved-? WHERE pool_key=?").run(entry.request_limit, entry.pool_key)
      return this.observe(admission, "not-admitted", "released", true, { requests: 0, input_tokens: 0, output_tokens: 0 }, null)
    }).immediate()
    await this.native("POST", "/api/session/" + admission.grant.recipient.session_id + "/interrupt?resume=false")
    return receipt
  }
  close() { this.journal.close() }
}
