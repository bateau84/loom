/** Bounded external model script inputs, never native dispatch/receipt logic. */
export type NativeReviewCall =
  | { tool: "subagent"; input: { agent: "reviewer" | "evaluator"; description: string; prompt: string; sessionID?: string; background?: boolean } }
  | { tool: "skill"; input: { id: string } }
  | { tool: "read"; input: { path: string } }

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
}

function bounded(value: unknown, limit: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= limit
}

function invalid(): never { throw new Error("Native review fixture input is unsupported") }

export function nativeReviewScript(job: unknown): { calls?: NativeReviewCall[]; finalText?: string } {
  const value = record(job)
  const finalText = value?.finalText
  if (finalText !== undefined && !bounded(finalText, 16384)) invalid()
  const proposed = value?.nativeCalls
  if (proposed === undefined) return { calls: undefined, finalText: finalText as string | undefined }
  if (!Array.isArray(proposed) || proposed.length < 1 || proposed.length > 4) invalid()
  const calls = proposed.map(item => {
    const call = record(item), input = record(call?.input)
    if (!call || !input || Object.keys(call).some(key => !["tool", "input"].includes(key))) invalid()
    if (call.tool === "subagent") {
      if (Object.keys(input).some(key => !["agent", "description", "prompt", "sessionID", "background"].includes(key))
        || (input.agent !== "reviewer" && input.agent !== "evaluator")
        || !bounded(input.description, 200)
        || !bounded(input.prompt, 32768) || !/^LOOM_HARNESS_JOB:[a-f0-9]{16}(?:\n|$)/.test(input.prompt)
        || (input.sessionID !== undefined && !bounded(input.sessionID, 512))
        || (input.background !== undefined && typeof input.background !== "boolean")) invalid()
    } else if (call.tool === "read") {
      if (Object.keys(input).length !== 1 || typeof input.path !== "string"
        || !["evidence-a.txt", "evidence-b.txt", "protected-b.txt", "missing.txt"].includes(input.path)) invalid()
    } else if (call.tool === "skill") {
      if (Object.keys(input).length !== 1 || input.id !== "agent-run-audit") invalid()
    } else invalid()
    // These remain provider tool-call inputs. The native host creates/executes
    // Sessions, admissions and tools; this parser creates none of those receipts.
    return { tool: call.tool, input: { ...input } } as NativeReviewCall
  })
  return { calls, finalText: finalText as string | undefined }
}

export function providerIdentity(headers: unknown): Record<string, string> {
  const source = record(headers)
  return Object.fromEntries(["x-opencode-session-id", "x-opencode-parent-session-id"].flatMap(key =>
    typeof source?.[key] === "string" ? [[key, source[key]]] : []))
}
