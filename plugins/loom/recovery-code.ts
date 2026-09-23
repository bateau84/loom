/**
 * Cancelled children may reach one recovery/history tool through Code Mode,
 * never a general program. Arguments must be a JSON object: no expressions,
 * computed keys, spreads, getters, assignments, or a second statement.
 * The selected tool still enforces its normal schema, owner and grant checks.
 */
export function recoveryCodeCall(input: unknown): { name: string; input: Record<string, unknown> } | undefined {
  const code = (input as { code?: unknown } | undefined)?.code
  if (typeof code !== "string" || code.length > 16_384) return undefined
  const match = /^(?:return[ \t]+)?await[ \t]+tools\.loom\.code\.([a-z_]+)\([ \t\r\n]*(\{[\s\S]*\})[ \t\r\n]*\)[ \t]*;?$/.exec(code.trim())
  if (!match) return undefined
  try {
    const value = JSON.parse(match[2]!)
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
    // JSON's __proto__ property has different semantics in an object literal.
    // Do not admit prototype-changing data, even to a read-only tool.
    JSON.stringify(value, (key, entry) => {
      if (key === "__proto__") throw new Error("Prototype key is not recovery data.")
      return entry
    })
    return { name: match[1]!, input: value }
  } catch {
    return undefined
  }
}
