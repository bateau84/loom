import { test, expect } from "bun:test"
import { registeredLoom } from "./helpers/registered-loom.js"

// Replaces the retired assignment protocol's positive contract tests.
// Historical preservation is exercised against the frozen populated producer.
test("assignment/delivery operations, views and fields are not registered and fail explicitly", async () => {
  const f = await registeredLoom()
  try {
    expect(f.tools.size).toBe(8)
    const schema = f.tools.get("record").input.properties
    for (const operation of ["assign", "authorize-continuation", "withdraw-continuation", "retry-delivery"]) {
      expect(schema.operation.enum).not.toContain(operation)
      await expect(f.invoke("record", { operation })).rejects.toThrow()
    }
    for (const view of ["assignments", "deliveries"]) {
      expect(schema.view.enum).not.toContain(view)
      await expect(f.invoke("record", { operation: "query", view })).rejects.toThrow()
    }
    for (const key of ["assignment_id", "worker_session_id", "delivery_id", "continuation", "attempt_after", "attempt_limit"])
      expect(schema[key]).toBeUndefined()
    const action = (await f.invoke("action", { operation: "create", title: "Retirement", goal: "No old writes" })).result
    for (const key of ["assignment_id", "worker_session_id", "delivery_id", "continuation", "attempt_after", "attempt_limit"])
      await expect(f.invoke("record", { operation: "query", action_id: action.id, [key]: "legacy" })).rejects.toThrow("not supported")
    for (const kind of ["assignment", "delivery-intent", "delivery-event", "continuation-authorization", "continuation-withdrawal"])
      await expect(f.invoke("record", { operation: "add", action_id: action.id, kind, statement: "Forge current capability" })).rejects.toThrow()
    await expect(f.invoke("record", { operation: "ask", action_id: action.id, assignment_id: "old", statement: "Question", respondent: "user" })).rejects.toThrow("not supported")
    expect((await f.invoke("record", { operation: "query", action_id: action.id })).result.items).toEqual([])
  } finally { await f.close() }
})
