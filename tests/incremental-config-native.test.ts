import { expect, test } from "bun:test"
import { defaults, mergeConfig } from "../src/config.js"

test("incremental defaults keep deterministic work independent from model authority", () => {
  const config = defaults()
  expect(config.learning).toEqual({ incremental_enabled: true, max_sources: 128, coalesce_ms: 250,
    interpretation: { enabled: false, method: null, budget_policy: null, min_sources: 16, max_age_ms: 60000, min_interval_ms: 60000 } })
  expect(mergeConfig(config, { learning: { incremental: false, "max-sources": 7, "coalesce-ms": 0 } }).learning.max_sources).toBe(7)
  expect(config.learning.max_sources).toBe(128)
})

test("increment and interpretation resource settings are bounded and reject invented authority", () => {
  for (const learning of [{ "max-sources": 0 }, { "max-sources": 1001 }, { "coalesce-ms": -1 },
    { interpretation: { enabled: true } }, { interpretation: { authority: "approved" } },
    { interpretation: { "min-sources": 1001 } }, { interpretation: { "max-age-ms": 86400001 } },
    { interpretation: { method: { model: "cheap" } } }]) {
    expect(() => mergeConfig(defaults(), { learning })).toThrow()
  }
})
