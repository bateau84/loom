import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { Learning } from "../src/learning.js"
import { Store } from "../src/store.js"
import { digest } from "../src/model.js"
import type { RetrospectiveMember } from "../src/retrospective-contract.js"
import type { RetrospectiveSourceRequest, RetrospectiveSourceResolution } from "../src/retrospective-populations.js"

const actor = { session_id: "authorized-investigator", agent: "researcher" }
function fixture() {
  const action = new Database(":memory:"), derived = new Database(":memory:")
  const store = new Store(action), learning = new Learning(derived, store, action)
  const value = { original: "controlled source-owner view; no actual external authorization claimed" }
  const member: RetrospectiveMember = { key: "source-fixture", source_store_id: learning.automatic.sources.namespace,
    source: { kind: "native-message", id: "original-message", session_id: "source-session", revision: "original-version", sha256: digest(value), required: true },
    permitted_view: "controlled-source-view", availability: "available", basis: [{ kind: "controlled-membership" }],
    historical_scope: null, qualifications: ["structural source-owner contract only"] }
  return { learning, member, value, close() { derived.close(); action.close() } }
}

test("async source-owner boundary awaits actual resolution and binds the reader and purpose", async () => {
  const f = fixture()
  try {
    let release!: () => void, seen: RetrospectiveSourceRequest | undefined, finished = false
    const gate = new Promise<void>(resolve => { release = resolve })
    const operation = f.learning.populations.resolve(actor, f.member, async request => {
      seen = request
      await gate
      return { ...request, status: "available", value: f.value }
    }, "prepare").then(result => { finished = true; return result })
    expect(seen).toMatchObject({ recipient_session_id: actor.session_id, purpose: "prepare",
      source_store_id: f.member.source_store_id, permitted_view: f.member.permitted_view, source: f.member.source })
    expect(finished).toBe(false)
    release()
    expect(await operation).toEqual({ status: "available", value: f.value })
  } finally { f.close() }
})

test("source-owner denial propagates and cannot become an available or merely missing original", async () => {
  const f = fixture()
  try {
    let checks = 0
    await expect(f.learning.populations.resolve(actor, f.member, async () => {
      checks++
      throw new Error("controlled owner authorization denial")
    }, "prepare")).rejects.toThrow("controlled owner authorization denial")
    expect(checks).toBe(1)
  } finally { f.close() }
})

test("source-owner replies cannot change namespace, recipient, permitted view or original identity", async () => {
  const f = fixture()
  try {
    const mutations: Array<(request: RetrospectiveSourceRequest) => Partial<RetrospectiveSourceResolution>> = [
      () => ({ source_store_id: "other-store" }), () => ({ recipient_session_id: "other-reader" }),
      () => ({ permitted_view: "raw-full-history" }),
      request => ({ source: { ...request.source, kind: "external-ref" } }),
      request => ({ source: { ...request.source, id: "different-original" } }),
      request => ({ source: { ...request.source, session_id: "different-producer" } }),
      request => ({ source: { ...request.source, message_id: "different-message" } }),
    ]
    for (const mutate of mutations) await expect(f.learning.populations.resolve(actor, f.member, async request =>
      ({ ...request, status: "available", value: f.value, ...mutate(request) }))).rejects.toThrow("binding mismatch")
  } finally { f.close() }
})

test("changed source versions remain gaps and incorrect digests cannot certify returned bytes", async () => {
  const f = fixture()
  try {
    const changed = { original: "replacement must never be returned as the selected original" }
    const result = await f.learning.populations.resolve(actor, f.member, async request => ({ ...request,
      status: "available", source: { ...request.source, revision: "new-version", sha256: digest(changed) }, value: changed }))
    expect(result).toEqual({ status: "changed" })
    await expect(f.learning.populations.resolve(actor, f.member, async request =>
      ({ ...request, status: "available", value: changed }))).rejects.toThrow("version mismatch")
    await expect(f.learning.populations.resolve(actor, f.member, async request =>
      ({ ...request, status: "missing", value: changed }))).rejects.toThrow("Invalid retrospective source-owner result")
  } finally { f.close() }
})
