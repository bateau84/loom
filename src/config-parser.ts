import { createRequire } from "node:module"

// The listener contract is version-specific, so both manifest and runtime are pinned.
const require = createRequire(import.meta.url)
type ParserState = { depth: number; position: number; result: unknown }
type Parser = {
  CORE_SCHEMA: unknown
  load(source: string, options: {
    schema: unknown; json: boolean; maxDepth: number; maxTotalMergeKeys: number
    listener(event: "open" | "close", state: ParserState): void
  }): unknown
}
const yaml = require("js-yaml") as Parser
const version = (require("js-yaml/package.json") as { version: string }).version

export const CONFIG_PARSE_LIMITS = Object.freeze({
  sourceBytes: 65536, nodeAttempts: 8192, depth: 32,
  arrayItems: 16384, arrayKeyChars: 65536,
})
export class ConfigParseLimitError extends Error {
  readonly code = "LOOM_CONFIG_PARSE_LIMIT"
  constructor(readonly boundary: string, readonly position: number, readonly attempts: number) {
    super(`Loom YAML ${boundary} limit exceeded; simplify the configuration`)
  }
}

/**
 * Resource checks run inside construction, not over an already decoded document.
 * Scalars are bounded by the source. Aliases share their target; no recursive
 * expansion or stringify of the decoded graph is used. No unbounded fallback.
 */
export function decodeConfigYaml(source: string): unknown {
  if (typeof source !== "string") throw new TypeError("Loom YAML source must be text")
  if (source.length > CONFIG_PARSE_LIMITS.sourceBytes || Buffer.byteLength(source, "utf8") > CONFIG_PARSE_LIMITS.sourceBytes) {
    throw new ConfigParseLimitError("source-byte", 0, 0)
  }
  if (version !== "4.3.2") throw new Error("Loom requires js-yaml 4.3.2; restore the locked dependencies")
  let attempts = 0, arrayItems = 0
  // YAML may use an aliased flat array as a mapping key. Check before the loader
  // converts it to a string, which could otherwise multiply a long scalar alias.
  const checkedArrays = new WeakMap<unknown[], number>()
  try {
    return yaml.load(source, {
      schema: yaml.CORE_SCHEMA, json: true,
      maxDepth: CONFIG_PARSE_LIMITS.depth + 1, maxTotalMergeKeys: CONFIG_PARSE_LIMITS.nodeAttempts,
      listener(event, state) {
        if (event === "open") {
          // composeNode invokes this before reading/allocating this node. Count
          // attempts, including speculative parsing; never refund backtracking.
          if (++attempts > CONFIG_PARSE_LIMITS.nodeAttempts) throw new ConfigParseLimitError("node-attempt", state.position, attempts)
          if (state.depth > CONFIG_PARSE_LIMITS.depth) throw new ConfigParseLimitError("depth", state.position, attempts)
          return
        }
        const value = state.result
        if (!Array.isArray(value) || checkedArrays.get(value) === value.length) return
        let chars = Math.max(0, value.length - 1)
        for (const item of value) {
          if (++arrayItems > CONFIG_PARSE_LIMITS.arrayItems) throw new ConfigParseLimitError("array-inspection", state.position, attempts)
          // Nested array keys are rejected by this pinned loader before String().
          // Objects use its fixed '[object Object]' representation, not a method.
          chars += typeof item === "string" ? item.length : item == null ? 0 : Array.isArray(item) ? 0 : 32
          if (chars > CONFIG_PARSE_LIMITS.arrayKeyChars) throw new ConfigParseLimitError("array-key-text", state.position, attempts)
        }
        checkedArrays.set(value, value.length)
      },
    })
  } catch (error) {
    if (error instanceof ConfigParseLimitError) throw error
    // Do not put a YAML source snippet into role-injection or capture diagnostics.
    const reason = (error as { reason?: unknown } | null)?.reason
    throw new Error(typeof reason === "string" ? `Invalid Loom YAML: ${reason.slice(0, 180)}` : "Loom YAML decoding failed")
  }
}
