import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { defaults, mergeConfig, loadConfig } from "../.test-build/config.js"
import { planModelRoutes, resolveModelPolicy, validateModelRouting } from "../.test-build/model-routing.js"

function configured() {
  return mergeConfig(defaults(), {
    "model-routing": {
      enabled: true, "default-class": "balanced", "default-reasoning": "medium",
      "provider-order": ["opencode-go", "openai", "github-copilot"],
      "paid-fallback": false,
    },
    "model-classes": {
      strong: { models: ["gpt-6.1-sol", "gpt-6-astra", "kimi-k3"] },
      balanced: { models: ["gpt-6.1-luna", "kimi-k3"] },
    },
    "model-aliases": { "gpt-6.1-sol": { "opencode-go": "go-sol", openai: "gpt-6.1-sol" } },
    agents: {
      architect: { roles: ["architecture", "planning"] },
      coder: { roles: ["implementation", "documentation"] },
      debugger: { roles: ["exploration", "research"], "model-class": "strong", reasoning: "high" },
    },
    roles: {
      architecture: { "model-class": "strong", reasoning: "medium" },
      planning: { reasoning: "medium" },
      implementation: { "model-class": "balanced", reasoning: "low" },
      research: { "model-class": "balanced", reasoning: "low" },
    },
  })
}

function route(providerID, modelID, extra = {}) {
  return { providerID, modelID, enabled: true, tools: true, billing: "included", quota: "unknown", ...extra }
}

test("same logical model at the next provider is preferred over the next model at the preferred provider", () => {
  const c = configured()
  const inventory = [
    route("opencode-go", "go-sol", { quota: "exhausted" }),
    route("openai", "gpt-6.1-sol"),
    route("opencode-go", "gpt-6-astra"),
    route("opencode-go", "kimi-k3"),
  ]
  const plan = planModelRoutes(c, "architect", inventory)
  assert.equal(plan.status, "ready")
  assert.equal(plan.selected.logicalModel, "gpt-6.1-sol")
  assert.equal(plan.selected.providerID, "openai")
  assert.equal(plan.candidates[1].logicalModel, "gpt-6-astra")
  assert.equal(plan.candidates[1].providerID, "opencode-go")
})

test("multiple providers serving the same model are ordered before any lower-ranked model", () => {
  const c = configured()
  const plan = planModelRoutes(c, "architect", [
    route("github-copilot", "gpt-6.1-sol"),
    route("opencode-go", "go-sol"),
    route("openai", "gpt-6.1-sol"),
    route("opencode-go", "gpt-6-astra"),
  ])
  assert.equal(plan.status, "ready")
  assert.deepEqual(plan.candidates.map(c => c.providerID + "/" + c.modelID), [
    "opencode-go/go-sol", "openai/gpt-6.1-sol", "github-copilot/gpt-6.1-sol", "opencode-go/gpt-6-astra",
  ])
})

test("quota exhaustion and unavailable tool support exclude a route without altering its model identity", () => {
  const plan = planModelRoutes(configured(), "architect", [
    route("opencode-go", "go-sol", { quota: "exhausted" }),
    route("openai", "gpt-6.1-sol", { tools: false }),
    route("github-copilot", "gpt-6.1-sol", { quota: "available" }),
    route("opencode-go", "gpt-6-astra"),
  ])
  assert.equal(plan.status, "ready")
  assert.equal(plan.selected.providerID, "github-copilot")
})

test("different provider model IDs need exact explicit aliases; fuzzy model matching is forbidden", () => {
  const p = planModelRoutes(configured(), "architect", [
    route("openai", "gpt-6.1-sol-preview"),
    route("opencode-go", "go-sol"),
    route("openai", "gpt-6-astra"),
  ])
  assert.equal(p.status, "ready")
  assert.deepEqual(p.candidates.map(c => c.providerID + "/" + c.modelID), [
    "opencode-go/go-sol", "openai/gpt-6-astra",
  ])
})

test("paid and unverified billing never enter routes with paid-fallback off", () => {
  const p = planModelRoutes(configured(), "architect", [
    route("opencode-go", "go-sol", { billing: "unknown" }),
    route("openai", "gpt-6.1-sol", { billing: "metered" }),
  ])
  assert.equal(p.status, "unavailable")
})

test("opt-in paid fallback is behind all included models, and unknown billing remains excluded", () => {
  const c = mergeConfig(configured(), { "model-routing": { "paid-fallback": true } })
  const p = planModelRoutes(c, "architect", [
    route("openai", "gpt-6.1-sol", { billing: "metered" }),
    route("opencode-go", "go-sol", { billing: "unknown" }),
    route("opencode-go", "gpt-6-astra", { billing: "included" }),
  ])
  assert.equal(p.status, "ready")
  assert.equal(p.selected.logicalModel, "gpt-6-astra")
  assert.deepEqual(p.candidates.map(c => c.billing), ["included", "metered"])
})

test("reasoning capability does not silently downgrade an agent", () => {
  const p = planModelRoutes(configured(), "debugger", [
    route("opencode-go", "go-sol", { reasoning: ["low", "medium"] }),
    route("openai", "gpt-6.1-sol", { reasoning: ["high"] }),
  ])
  assert.equal(p.status, "ready")
  assert.equal(p.selected.providerID, "openai")
  assert.equal(p.selected.reasoning, "high")
})

test("role inheritance, default and explicit agent override are deterministic", () => {
  const c = configured()
  assert.deepEqual(resolveModelPolicy(c, "architect"), { modelClass: "strong", reasoning: "medium" })
  assert.deepEqual(resolveModelPolicy(c, "coder"), { modelClass: "balanced", reasoning: "low" })
  assert.deepEqual(resolveModelPolicy(c, "debugger"), { modelClass: "strong", reasoning: "high" })
  assert.equal(resolveModelPolicy(c, "unconfigured-agent"), undefined)
  const disabled = mergeConfig(c, { agents: { architect: { enabled: false } } })
  assert.equal(resolveModelPolicy(disabled, "architect"), undefined)
})

test("conflicting role policies require explicit agent override", () => {
  const c = mergeConfig(configured(), {
    roles: { planning: { "model-class": "balanced", reasoning: "high" } },
  })
  assert.throws(() => validateModelRouting(c), /conflicting role model-class/)
  assert.throws(() => planModelRoutes(c, "architect", []), /conflicting role model-class/)
  const resolved = mergeConfig(c, { agents: { architect: { "model-class": "strong", reasoning: "medium" } } })
  assert.doesNotThrow(() => validateModelRouting(resolved))
})

test("unknown model classes and invalid provider lists are rejected", () => {
  const c = mergeConfig(configured(), { agents: { coder: { "model-class": "missing" } } })
  assert.throws(() => validateModelRouting(c), /unknown model-class/)
  assert.throws(() => mergeConfig(defaults(), { "model-routing": { "provider-order": ["openai", "openai"] } }), /duplicates/)
  assert.throws(() => mergeConfig(defaults(), { "model-classes": { x: { models: ["a", "a"] } } }), /duplicates/)
  assert.throws(() => mergeConfig(defaults(), { "model-aliases": { sol: { "__proto__": "bad" } } }), /Invalid name|Unknown setting/)
})

test("layered model class lists replace; aliases merge; null removes inherited aliases", () => {
  const c = mergeConfig(configured(), {
    "model-classes": { strong: { models: ["gpt-6.1-sol"] } },
    "model-aliases": { "gpt-6.1-sol": { openai: null, "github-copilot": "gpt-6.1-sol" } },
  })
  assert.deepEqual(c.modelClasses.strong.models, ["gpt-6.1-sol"])
  assert.equal(c.modelAliases["gpt-6.1-sol"].openai, undefined)
  assert.equal(c.modelAliases["gpt-6.1-sol"]["opencode-go"], "go-sol")
  assert.equal(c.modelAliases["gpt-6.1-sol"]["github-copilot"], "gpt-6.1-sol")
})

test("invalid effective policy fails closed across config layers, and repaired config reloads", async t => {
  const dir = await mkdtemp(join(tmpdir(), "loom-model-policy-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, ".loom.yaml")
  const source = `model-routing:
  enabled: true
  default-class: does-not-exist
agents:
  architect:
    roles: [architecture]
`
  await writeFile(path, source)
  const first = await loadConfig([path], text => JSON.parse(JSON.stringify(requireYamlSafeFixture(text))))
  assert.equal(first.config.instructions.enabled, false)
  assert.equal(first.config.ledger.capture, "off")
  assert.match(first.errors[0], /unknown model-class|enabled without model-classes/)
  await writeFile(path, JSON.stringify({
    "model-routing": { enabled: true, "default-class": "balanced" },
    "model-classes": { balanced: { models: ["test-model"] } },
    agents: { architect: { roles: ["architecture"] } },
  }))
  const second = await loadConfig([path], JSON.parse)
  assert.deepEqual(second.errors, [])
  assert.deepEqual(resolveModelPolicy(second.config, "architect"), { modelClass: "balanced", reasoning: "medium" })
})

// The first invalid layer is JSON to keep this Node-only contract independent of YAML.
function requireYamlSafeFixture(text) {
  return { "model-routing": { enabled: true, "default-class": "does-not-exist" },
    agents: { architect: { roles: ["architecture"] } } }
}

test("disabled routing preserves current Loom behavior", () => {
  const p = planModelRoutes(defaults(), "any", [route("opencode-go", "go-sol")])
  assert.deepEqual(p, { status: "disabled", candidates: [] })
})
