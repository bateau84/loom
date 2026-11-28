import { LearningSources } from "../../src/learning-sources.js"

/** Test-only counters around existing owners. Never adds a source lookup or
 * changes its permission, result, error, byte content or classification. */
export function observeSourceReads() {
  const counters = { retrospective: { calls: 0, available: 0, serialized_original_bytes: 0, elapsed_ms: 0 },
    deterministic: { calls: 0, available: 0, serialized_original_bytes: 0, elapsed_ms: 0 } }
  const seen = { retrospective: new Set<string>(), deterministic: new Set<string>() }
  const original = LearningSources.prototype.retrospectiveOriginal, resolve = LearningSources.prototype.resolve
  function measure<T extends ReturnType<typeof original>>(name: keyof typeof counters, read: () => T): T {
    const counter = counters[name], start = performance.now()
    counter.calls++
    try {
      const value = read()
      if (value) {
        counter.available++
        counter.serialized_original_bytes += Buffer.byteLength(JSON.stringify(value.value))
        seen[name].add(value.ref.kind + ":" + value.ref.id + ":" + value.ref.sha256)
      }
      return value
    } finally { counter.elapsed_ms += performance.now() - start }
  }
  LearningSources.prototype.retrospectiveOriginal = function (...args) { return measure("retrospective", () => original.apply(this, args)) }
  LearningSources.prototype.resolve = function (...args) { return measure("deterministic", () => resolve.apply(this, args)) }
  return {
    snapshot: () => ({ retrospective: { ...counters.retrospective, unique_source_versions: seen.retrospective.size },
      deterministic: { ...counters.deterministic, unique_source_versions: seen.deterministic.size } }),
    close: () => { LearningSources.prototype.retrospectiveOriginal = original; LearningSources.prototype.resolve = resolve },
  }
}
