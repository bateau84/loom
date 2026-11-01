import { test } from "node:test"
import assert from "node:assert/strict"
import { defaults, mergeConfig } from "../.test-build/config.js"
import {
  connectionID, nativeChatGPTAttestation, supportedReasoning, inventoryEntry,
  planInitialModels, assertInitialRoute,
} from "../.test-build/model-routing-runtime.js"

const oauth = { type: "credential", method: "oauth", id: "opaque-account-123" }
const native = {
  id: "sol", providerID: "openai", enabled: true, capabilities: { tools: true }, cost: [],
  variants: [
    { id: "low", settings: { reasoningEffort: "low" } },
    { id: "medium", settings: { reasoningEffort: "medium" } },
    { id: "high", settings: { reasoningEffort: "high" } },
  ],
}
const codex = {
  id: "openai", settings: { baseURL: "https://chatgpt.com/backend-api/codex" },
  headers: { originator: "opencode", "x-codex-beta-features": "remote_compaction_v2" },
}
function policy() {
  return mergeConfig(defaults(), {
    "model-routing": {
      enabled: true, "default-class": "strong", "default-reasoning": "medium",
      "provider-order": ["opencode-go", "openai"], "paid-fallback": false,
    },
    "model-classes": { strong: { models: ["sol", "astra"] } },
    agents: { architect: { roles: ["architecture"] } },
    roles: { architecture: { "model-class": "strong", reasoning: "medium" } },
  })
}
const key = (p, m) => JSON.stringify([p, m])

test("native OpenAI ChatGPT proof requires OAuth, Codex endpoint, native headers and native zero cost", () => {
  const proof = nativeChatGPTAttestation(native, codex, oauth)
  assert.equal(proof?.billing, "included")
  assert.equal(proof?.connectionID, "opaque-account-123")
  assert.equal(nativeChatGPTAttestation(native, codex, { ...oauth, method: "key" }), undefined)
  assert.equal(nativeChatGPTAttestation(native, codex, { ...oauth, status: { status: "needs_auth" } }), undefined)
  assert.equal(nativeChatGPTAttestation({ ...native, cost: [0] }, codex, oauth), undefined)
  assert.equal(nativeChatGPTAttestation({ ...native, enabled: false }, codex, oauth), undefined)
  assert.equal(nativeChatGPTAttestation(native, { ...codex, headers: {} }, oauth), undefined)
  assert.equal(nativeChatGPTAttestation(native, { ...codex, settings: {} }, oauth), undefined)
  assert.equal(nativeChatGPTAttestation({ ...native, providerID: "fake" }, codex, oauth), undefined)
  assert.equal(connectionID({ type: "env", name: "MY_KEY" }), "env:MY_KEY")
  assert.equal(connectionID(undefined), undefined)
})

test("reasoning translates only exact working native variants", () => {
  assert.deepEqual(supportedReasoning(native), ["low", "medium", "high"])
  assert.deepEqual(supportedReasoning({
    ...native, variants: [{ id: "high", settings: {} }, { id: "medium" }, { id: "low", body: { reasoning: { effort: "low" } } }],
  }), ["low"])
})

test("no implicit billing: unverified, wrong account or expired attestation fail closed", () => {
  const good = nativeChatGPTAttestation(native, codex, oauth)
  const base = inventoryEntry(native, oauth, good, 5)
  assert.equal(base.billing, "included")
  assert.equal(base.quota, "unknown")
  for (const attestation of [
    undefined, { ...good, verified: false }, { ...good, connectionID: "different" },
    { ...good, modelID: "wrong" }, { ...good, billing: "unknown" },
  ]) {
    const candidate = inventoryEntry(native, oauth, attestation, 10)
    assert.equal(candidate.billing, "unknown")
  }
  assert.equal(inventoryEntry(native, oauth, { ...good, cooldownUntil: 20 }, 10).quota, "exhausted")
  assert.equal(inventoryEntry(native, oauth, { ...good, quota: "exhausted" }, 10).quota, "exhausted")
  assert.equal(inventoryEntry(native, oauth, good, 10).enabled, true)
  assert.equal(inventoryEntry(native, { ...oauth, status: { status: "needs_auth" } }, good, 10).enabled, false)
})

test("confirmed exhaustion chooses the SAME logical model at the next provider, before another model", () => {
  const go = { ...native, providerID: "opencode-go" }
  const other = { ...native, id: "astra", providerID: "opencode-go" }
  const proof = nativeChatGPTAttestation(native, codex, oauth)
  const source = (m, p, id, quota="unknown") =>
    ({ providerID: p, modelID: m, connectionID: id, billing: "included", verified: true, quota })
  const plans = planInitialModels(policy(), [go, native, other], {
    "opencode-go": { ...oauth, id: "opaque-go-account" }, openai: oauth,
  }, {
    [key("opencode-go", "sol")]: source("sol", "opencode-go", "opaque-go-account", "exhausted"),
    [key("openai", "sol")]: proof,
    [key("opencode-go", "astra")]: source("astra", "opencode-go", "opaque-go-account"),
  }, 123)
  assert.equal(plans.plan.architect.status, "ready")
  assert.equal(plans.plan.architect.selected.providerID, "openai")
  assert.deepEqual(plans.plan.architect.candidates.map(x => x.providerID + "/" + x.modelID),
    ["openai/sol", "opencode-go/astra"])
  assert.doesNotThrow(() => assertInitialRoute(plans.plan.architect, { providerID: "openai", id: "sol", variant: "medium" }))
  assert.throws(() => assertInitialRoute(plans.plan.architect, { providerID: "opencode-go", id: "astra", variant: "medium" }), /MISMATCH/)
  assert.throws(() => assertInitialRoute(plans.plan.architect, { providerID: "openai", id: "sol", variant: "low" }), /MISMATCH/)
})

test("missing attestation and unsupported capabilities never leave the global native fallback open", () => {
  const c = policy()
  const state = planInitialModels(c, [
    { ...native, variants: [] },
    { ...native, providerID: "opencode-go", capabilities: { tools: false } },
  ], { openai: oauth, "opencode-go": oauth }, {}, 100)
  assert.equal(state.plan.architect.status, "unavailable")
  assert.throws(() => assertInitialRoute(state.plan.architect,
    { providerID: "any-paid-global-model", id: "astra" }), /UNAVAILABLE/)
  assert.doesNotThrow(() => assertInitialRoute(undefined, { providerID: "openai", id: "sol" }))
  const disabled = planInitialModels(defaults(), [native], { openai: oauth }, {}, 100)
  assert.deepEqual(disabled.plan, {})
})


test("Go model plus active Console key or OAuth connection is not subscription billing proof", () => {
  const config = mergeConfig(policy(), {
    "model-classes": { strong: { models: ["kimi-k3"] } },
  })
  // Native catalog pricing describes a model price, not an included-use entitlement.
  const go = { ...native, id: "kimi-k3", providerID: "opencode-go", cost: [{ input: 3, output: 15 }] }
  const provider = { id: "opencode-go", integrationID: "opencode" }
  const connections = [
    { type: "credential", method: "key", id: "console-key-1" },
    { type: "credential", method: "oauth", id: "console-oauth-1" },
    { type: "env", name: "OPENCODE_API_KEY" },
    { type: "credential", method: "key", id: "expired-go", status: { status: "needs_auth" } },
  ]
  for (const current of connections) {
    assert.equal(nativeChatGPTAttestation(go, provider, current), undefined)
    assert.equal(inventoryEntry(go, current, undefined, 100).billing, "unknown")
    for (const paidFallback of [false, true]) {
      const configured = paidFallback ? mergeConfig(config, { "model-routing": { "paid-fallback": true } }) : config
      const state = planInitialModels(configured, [go], { "opencode-go": current }, {}, 100)
      assert.equal(state.plan.architect.status, "unavailable")
      assert.throws(() => assertInitialRoute(state.plan.architect, {
        providerID: "opencode-go", id: "kimi-k3", variant: "medium",
      }), /UNAVAILABLE/)
    }
  }
  // A zero-price listing is equally insufficient; neither field is billing evidence.
  const zeroCost = { ...go, cost: [] }
  assert.equal(nativeChatGPTAttestation(zeroCost, provider, oauth), undefined)
  assert.equal(inventoryEntry(zeroCost, oauth, undefined, 100).billing, "unknown")
})

test("Go attestation cannot authorize a different native account or model", () => {
  const go = { ...native, id: "kimi-k3", providerID: "opencode-go" }
  // Deliberately synthetic external evidence: NO such native Go attestation is
  // provided by OpenCode 2.1.4. This tests fail-closed identity handling only.
  const evidence = {
    providerID: "opencode-go", modelID: "kimi-k3", connectionID: "key-A",
    billing: "included", verified: true, quota: "available",
  }
  assert.equal(inventoryEntry(go, { type: "credential", method: "key", id: "key-B" }, evidence, 100).billing, "unknown")
  assert.equal(inventoryEntry({ ...go, id: "glm-5.3" },
    { type: "credential", method: "key", id: "key-A" }, evidence, 100).billing, "unknown")
  assert.equal(inventoryEntry(go, { type: "credential", method: "key", id: "key-A",
    status: { status: "needs_auth" } }, evidence, 100).enabled, false)
})
