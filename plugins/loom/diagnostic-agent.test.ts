import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

const diagnosticPath = join(import.meta.dir, "..", "..", "agents", "diagnostic.md")

async function diagnosticDirective() {
  return readFile(diagnosticPath, "utf8")
}

describe("Diagnostic product contract", () => {
  test("root cause remains the completion target beyond mitigations", async () => {
    const directive = await diagnosticDirective()
    expect(directive).toContain("never satisfies a root-cause assignment")
    expect(directive).toContain("Do not use an evidence gap as an early exit")
    expect(directive).toContain("CONFIRMED")
    expect(directive).toContain("PROBABLE")
    expect(directive).toContain("UNRESOLVED")
  })

  test("confirmed causes route by semantic blast radius without granting Diagnostic repair authority", async () => {
    const directive = await diagnosticDirective()
    for (const classification of [
      "implementation-only",
      "experience-design",
      "obligation",
      "architecture",
      "obligation+architecture",
      "unknown",
    ]) {
      expect(directive).toContain(classification)
    }
    expect(directive).toContain(
      "Classification routes authority; it does not grant Diagnostic permission",
    )
  })

  test("temporary mutation stays inside the disposable sandbox and remains evidence only", async () => {
    const directive = await diagnosticDirective()
    expect(directive).toContain("loom_diagnostic_sandbox_start")
    expect(directive).toContain("loom_diagnostic_sandbox_exec")
    expect(directive).toContain("loom_diagnostic_sandbox_diff")
    expect(directive).toContain("experimental laboratory")
    expect(directive).toContain("Never copy/apply a sandbox candidate fix into the real project")
    expect(directive).toContain(
      "exit zero only when the predicted observation occurred",
    )
  })
})
