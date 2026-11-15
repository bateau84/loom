/** Script validation only; these tests do not qualify native host behavior. */
import { expect, test } from "bun:test"
import { nativeReviewScript, providerIdentity } from "./review-script.js"
import type { NativeReviewCall } from "./review-script.js"

test("preserves independent native calls and final review text", () => {
  const calls: NativeReviewCall[] = [
    { tool: "subagent", input: { agent: "reviewer", description: "First review", prompt: "LOOM_HARNESS_JOB:0123456789abcdef\nSecurity only", sessionID: "ses_existing", background: true } },
    { tool: "subagent", input: { agent: "reviewer", description: "Second review", prompt: "LOOM_HARNESS_JOB:fedcba9876543210\nCorrectness and reliability" } },
  ]
  expect(nativeReviewScript({ nativeCalls: calls, finalText: "Claimed citation: evidence-a.txt" }))
    .toEqual({ calls, finalText: "Claimed citation: evidence-a.txt" })
})

test("rejects unsupported, oversized or ambiguous native script inputs", () => {
  const call = { tool: "subagent", input: { agent: "reviewer", description: "Review", prompt: "LOOM_HARNESS_JOB:0123456789abcdef\nQuestion" } }
  for (const job of [
    { nativeCalls: [] },
    { nativeCalls: Array(5).fill(call) },
    { nativeCalls: [{ tool: "shell", input: { command: "echo unsupported" } }] },
    { nativeCalls: [{ ...call, input: { ...call.input, agent: "general" } }] },
    { nativeCalls: [{ ...call, input: { ...call.input, agent: ["reviewer"] } }] },
    { nativeCalls: [{ ...call, input: { ...call.input, model: "external/model" } }] },
    { nativeCalls: [{ ...call, input: { ...call.input, prompt: "not a fixture job" } }] },
    { nativeCalls: [{ ...call, input: { ...call.input, prompt: call.input.prompt + "x".repeat(32768) } }] },
    { nativeCalls: [{ ...call, input: { ...call.input, sessionID: "" } }] },
    { nativeCalls: [{ ...call, input: { ...call.input, background: "true" } }] },
    { nativeCalls: [{ tool: "read", input: { path: "/private/evidence.txt" } }] },
    { nativeCalls: [{ tool: "read", input: { path: ["evidence-a.txt"] } }] },
    { nativeCalls: [{ tool: "read", input: { path: "evidence-a.txt", offset: 1 } }] },
    { nativeCalls: [{ tool: "skill", input: { id: "unknown-skill" } }] },
    { finalText: "x".repeat(16385) },
    { finalText: {} },
  ]) expect(() => nativeReviewScript(job)).toThrow("Native review fixture")
})

test("leaves legacy scripts alone and supports only disposable read and skill inputs", () => {
  expect(nativeReviewScript({ code: "return 1", nativeSkill: true })).toEqual({ calls: undefined, finalText: undefined })
  const calls: NativeReviewCall[] = [
    ...["evidence-a.txt", "evidence-b.txt", "protected-b.txt", "missing.txt"].map(path => ({ tool: "read" as const, input: { path } })),
  ]
  expect(nativeReviewScript({ nativeCalls: calls }).calls).toEqual(calls)
  expect(nativeReviewScript({ nativeCalls: [{ tool: "skill", input: { id: "agent-run-audit" } }] }).calls)
    .toEqual([{ tool: "skill", input: { id: "agent-run-audit" } }])
})

test("records only host Session identity headers, preserving missing observations", () => {
  expect(providerIdentity({
    "x-opencode-session-id": "ses_child",
    "x-opencode-parent-session-id": "ses_parent",
    "authorization": "PRIVATE_SECRET",
    "x-session-affinity": "not-an-invocation",
  })).toEqual({ "x-opencode-session-id": "ses_child", "x-opencode-parent-session-id": "ses_parent" })
  expect(providerIdentity(undefined)).toEqual({})
  expect(providerIdentity({ "x-opencode-session-id": undefined, "Authorization": "PRIVATE_SECRET" })).toEqual({})
})
