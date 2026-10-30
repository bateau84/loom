import { test, expect } from "bun:test"
import { createScriptedSourceModel } from "./server.js"

type Source = ReturnType<typeof createScriptedSourceModel>

const marked = (phase: string) => ({ prompt: [
  { role: "user", content: [{ type: "text", text: "QA_B_SOURCE_PHASE:" + phase + "\nSource task" }] },
] })
const continuation = { prompt: [
  { role: "tool", content: [{ type: "tool-result", toolName: "edit", toolCallId: "call_1",
    output: { type: "text", value: "Native tool returned" } }] },
] }

async function events(model: Source, input: any): Promise<any[]> {
  const result = await model.doStream(input)
  const rows: any[] = []
  for await (const event of result.stream) rows.push(event)
  return rows
}

test("scripted worker retry survives a markerless native tool continuation", async () => {
  const model = createScriptedSourceModel()
  expect((await events(model, marked("worker-retry"))).find(e => e.type === "tool-call")?.toolName)
    .toBe("edit")
  expect((await events(model, continuation)).find(e => e.type === "tool-call")?.toolName)
    .toBe("shell")
  const terminal = await events(model, continuation)
  expect(terminal.find(e => e.type === "text-delta")?.delta).toContain("Retried native edit")
  expect(terminal.at(-1)?.finishReason?.unified).toBe("stop")
  await expect(events(model, continuation)).rejects.toThrow(/phase marker/)
})

test("scripted first edit and verification retain source step order without repeated user messages", async () => {
  const model = createScriptedSourceModel()
  const first = await events(model, marked("worker-fail"))
  expect(first.find(e => e.type === "tool-call")?.toolName).toBe("edit")
  expect((await events(model, continuation)).find(e => e.type === "text-delta")?.delta)
    .toContain("Native edit attempted")
  expect((await events(model, marked("worker-verify"))).find(e => e.type === "tool-call")?.toolName)
    .toBe("shell")
  expect((await events(model, continuation)).find(e => e.type === "text-delta")?.delta)
    .toContain("Verified by running test_settings.py")
})

test("unmarked requests cannot start a phase or cross a completed source turn", async () => {
  const model = createScriptedSourceModel()
  await expect(events(model, continuation)).rejects.toThrow(/phase marker/)
  expect((await events(model, marked("coordinator"))).find(e => e.type === "text-delta")?.delta)
    .toContain("Assigned settings update")
  await expect(events(model, continuation)).rejects.toThrow(/phase marker/)
  await expect(events(model, marked("unrecognized"))).rejects.toThrow(/Unknown QA-B source phase/)
})

test("cannot switch to a different source phase while a native tool continuation is pending", async () => {
  const model = createScriptedSourceModel()
  await events(model, marked("worker-retry"))
  await expect(events(model, marked("reviewer"))).rejects.toThrow(/pending/)
  expect((await events(model, continuation)).find(e => e.type === "tool-call")?.toolName)
    .toBe("shell")
})
