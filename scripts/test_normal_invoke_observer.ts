import { describe, expect, test } from "bun:test"
import { observerMustOmitEvent, observerOmissionReason } from "./fixtures/loom-normal-invoke-observer"

describe("pre-persistence normal-invoke secret omission", () => {
  test("omits literal, nested, quoted, and newline-escaped credential values", () => {
    const secret = 'bearer "two\nlines"'
    const encoded = JSON.stringify(JSON.stringify(secret))
    for (const payload of [
      { result: secret },
      { nested: { content: secret } },
      { serialized: encoded },
    ]) {
      expect(observerMustOmitEvent(payload, [secret])).toBe(true)
    }
  })

  test("omits sensitive object keys even when host secret provenance is unavailable", () => {
    expect(observerMustOmitEvent({ input: { credential: "synthetic" } }, [])).toBe(true)
    expect(observerMustOmitEvent({ metadata: { authorization: { header: "x" } } }, [])).toBe(true)
  })

  test("omits config-only and short environment values supplied by the host collector", () => {
    expect(observerMustOmitEvent({ output: "config-only-synthetic" }, ["config-only-synthetic"])).toBe(true)
    expect(observerMustOmitEvent({ output: "prefix:xy:end" }, ["xy"])).toBe(true)
  })

  test("omits already-clipped credential edge fragments", () => {
    const secret = "sensitive-token-value"
    expect(observerMustOmitEvent({ result: secret.slice(0, 7) }, [secret])).toBe(true)
    expect(observerMustOmitEvent({ result: secret.slice(-7) }, [secret])).toBe(true)
    expect(observerMustOmitEvent({ schema: "opencode-local-observation/v1" }, [secret])).toBe(false)
    expect(observerMustOmitEvent({ schema: "opencode-local-observation/v1" }, ["local"])).toBe(false)
    expect(observerMustOmitEvent({ result: "local" }, ["local"])).toBe(true)
  })

  test("does not exempt payload fields named schema and catches a seven-character clip", () => {
    const secret = "seventyprefix-synthetic-key"
    expect(observerMustOmitEvent({ input: { state: "available", value: { schema: secret } } }, [secret])).toBe(true)
    expect(observerMustOmitEvent({ result: { state: "available", value: { schema: secret } } }, [secret])).toBe(true)
    expect(observerMustOmitEvent({ result: { state: "available", value: secret.slice(0, 7) } }, [secret])).toBe(true)
    expect(observerMustOmitEvent({ result: { state: "available", value: { text: secret.slice(-7) } } }, [secret])).toBe(true)
    expect(observerMustOmitEvent({ result: { state: "available", value: { schema: "xy" } } }, ["xy"])).toBe(true)
  })

  test("does not omit unrelated ordinary diagnostic values", () => {
    expect(observerMustOmitEvent({ input: { value: "safe" }, output: "result" }, ["secret-token"])).toBe(false)
  })

  test("omits opaque payloads by default and only retains declared synthetic fixture payloads", () => {
    const call = { kind: "call_start", schema: "opencode-local-observation/v1", sequence: 1,
      observer_failures: 0, actor: { agent: "general", session_id: "s", message_id: "m" },
      parent: { invocation_id: "i", session_id: "s", message_id: "m", call_id: "c" },
      invocation_id: "child", tool: "loom.status", catalog_path: "loom.code.status",
      boundary: "executable-input", input: { state: "available", value: { marker: "safe-fixture-value" } } }
    expect(observerOmissionReason(call, [], "omit-opaque-payloads/v1")).toBe("opaque_payload_unverified")
    expect(observerOmissionReason(call, [], "synthetic-secret-free-fixture/v1")).toBeNull()
    expect(observerOmissionReason({ ...call, input: { state: "available", value: { marker: "secret" } } }, ["secret"],
      "synthetic-secret-free-fixture/v1")).toBe("sensitive_value")
    expect(observerOmissionReason({ ...call, new_runtime_payload: "unknown" }, [],
      "synthetic-secret-free-fixture/v1")).toBe("unsupported_event_field")
  })

  test("rejects opaque fields nested under otherwise metadata-only event kinds before persistence", () => {
    const secret = "aB9cD7eF5gH3jK1m"
    const parentStart = {
      schema: "opencode-local-observation/v1", sequence: 1, observer_failures: 0,
      kind: "parent_start", boundary: "codemode-engine", mode: "code_mode",
      actor: { agent: "general", session_id: "s", message_id: "m", note: secret },
      parent: { invocation_id: "i", session_id: "s", message_id: "m", call_id: "c" },
      result: { state: "available", value: secret },
    }
    expect(observerOmissionReason(parentStart, [secret], "omit-opaque-payloads/v1")).toBe("sensitive_value")
    expect(observerOmissionReason(parentStart, [], "synthetic-secret-free-fixture/v1")).toBe("unsupported_event_field")
    const clipped = { ...parentStart, actor: { agent: "general", session_id: "s", message_id: "m", note: "response: aB9cD7e" },
      result: { state: "available", value: "response: aB9cD7e" } }
    expect(observerOmissionReason(clipped, [secret], "omit-opaque-payloads/v1")).toBe("unsupported_event_field")
  })

  test("accepts the pinned native call_start parent-null constructor without permitting opaque parent payloads", () => {
    const nativeStart = {
      schema: "opencode-native-observation/v2", sequence: 1,
      actor: { agent: "general", session_id: "s", message_id: "m" },
      observer_failures: 0, kind: "call_start", invocation_id: "i", call_id: "c",
      tool: "evalFixture_native_sentinel", mode: "native", parent: null,
      input: { state: "available", value: { marker: "native-sentinel" } },
      boundary: "executable-input",
    }
    expect(observerOmissionReason(nativeStart, [], "synthetic-secret-free-fixture/v1")).toBeNull()
    expect(observerOmissionReason(nativeStart, [], "omit-opaque-payloads/v1")).toBe("opaque_payload_unverified")
    expect(observerOmissionReason({ ...nativeStart, parent: { call_id: "c", note: "secret" } }, [],
      "synthetic-secret-free-fixture/v1")).toBe("unsupported_event_field")
  })

  test("validates every retained metadata shape across native and local event families", () => {
    const actor = { agent: "general", session_id: "s", message_id: "m" }
    const parent = { invocation_id: "i", session_id: "s", message_id: "m", call_id: "c" }
    const nativeStart = { schema: "opencode-native-observation/v2", sequence: 1, observer_failures: 0,
      actor, kind: "call_start", invocation_id: "i", call_id: "c", tool: "execute", mode: "native",
      parent: null, boundary: "executable-input", input: { state: "available", value: {} } }
    const localParentStart = { schema: "opencode-local-observation/v1", sequence: 2, observer_failures: 0,
      actor, parent, kind: "parent_start", boundary: "codemode-engine", mode: "code_mode" }
    const localStart = { schema: "opencode-local-observation/v1", sequence: 3, observer_failures: 0,
      actor, parent, kind: "call_start", invocation_id: "child", tool: "loom.status",
      catalog_path: "loom.code.status", boundary: "executable-input", input: { state: "available", value: {} } }
    const localEnd = { schema: "opencode-local-observation/v1", sequence: 4, observer_failures: 0,
      actor, parent, kind: "call_end", invocation_id: "child", dispatched: true,
      boundary: "codemode-json-return", outcome: "returned", result: { state: "available", value: {} } }
    const localParentEnd = { schema: "opencode-local-observation/v1", sequence: 5, observer_failures: 0,
      actor, parent, kind: "parent_end", admitted: 1, dispatched: 1, terminals: 1,
      missing_terminals: 0, unsupported_dispatches: 0, unavailable_fields: 0,
      scope: "one-codemode-engine-invocation", evidence_eligible: false }
    const nativeEnd = { schema: "opencode-native-observation/v2", sequence: 6, observer_failures: 0,
      actor, kind: "call_end", invocation_id: "i", call_id: "c", boundary: "session-tool-terminal",
      unavailable_fields: 0, outcome: "returned", result: { state: "available", value: {} } }
    const canonical = [nativeStart, localParentStart, localStart, localEnd, localParentEnd, nativeEnd]
    for (const event of canonical) {
      expect(observerOmissionReason(event, [], "synthetic-secret-free-fixture/v1")).toBeNull()
      for (const field of Object.keys(event)) {
        if (["input", "result", "error", "actor", "parent"].includes(field)) continue
        expect(observerOmissionReason({ ...event, [field]: { note: "invalid-container" } }, [],
          "synthetic-secret-free-fixture/v1")).toBe("unsupported_event_field")
      }
    }
    for (const field of ["agent", "session_id", "message_id"]) {
      expect(observerOmissionReason({ ...localParentStart, actor: { ...actor, [field]: ["bad"] } }, [],
        "synthetic-secret-free-fixture/v1")).toBe("unsupported_event_field")
    }
    for (const field of ["invocation_id", "session_id", "message_id", "call_id"]) {
      expect(observerOmissionReason({ ...localParentStart, parent: { ...parent, [field]: { nested: true } } }, [],
        "synthetic-secret-free-fixture/v1")).toBe("unsupported_event_field")
    }
    expect(observerOmissionReason({ ...nativeStart, parent: { ...parent } }, [],
      "synthetic-secret-free-fixture/v1")).toBe("unsupported_event_field")
    expect(observerOmissionReason({ ...localParentStart, mode: "other" }, [],
      "synthetic-secret-free-fixture/v1")).toBe("unsupported_event_field")
    expect(observerOmissionReason({ ...nativeStart, mode: "code_mode" }, [],
      "synthetic-secret-free-fixture/v1")).toBe("unsupported_event_field")
    expect(observerOmissionReason({ ...localStart, boundary: "other" }, [],
      "synthetic-secret-free-fixture/v1")).toBe("unsupported_event_field")
    expect(observerOmissionReason({ ...localEnd, outcome: "other" }, [],
      "synthetic-secret-free-fixture/v1")).toBe("unsupported_event_field")
    expect(observerOmissionReason({ ...localEnd, error_representation: { type: "error" } }, [],
      "synthetic-secret-free-fixture/v1")).toBe("unsupported_event_field")
  })
})
