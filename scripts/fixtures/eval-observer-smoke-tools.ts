import { Plugin } from "@opencode/plugin"

const marker = (input: unknown): string => {
  if (!input || typeof input !== "object" || !("marker" in input) || typeof input.marker !== "string") {
    throw new Error("marker must be a string")
  }
  return input.marker
}

const input = {
  type: "object" as const,
  properties: { marker: { type: "string" } },
  required: ["marker"],
  additionalProperties: false,
}

export default Plugin.define({
  id: "loom.eval-observer-smoke-tools",
  async setup(ctx) {
    await ctx.tool.transform((editor) => {
      editor.namespace({ name: "evalFixture", description: "Deterministic observer smoke tools" })
      editor.add({
        name: "native_sentinel",
        description: "Return a deterministic native-call sentinel",
        input,
        options: { namespace: "evalFixture", codemode: false },
        execute: async (args) => ({ content: JSON.stringify({ native: marker(args) }) }),
      })
      editor.add({
        name: "inner_sentinel",
        description: "Return a deterministic Code Mode sentinel",
        input,
        options: { namespace: "evalFixture", codemode: true },
        execute: async (args) => ({ content: JSON.stringify({ inner: marker(args) }) }),
      })
      editor.add({
        name: "thrower",
        description: "Throw a deterministic tool error for Code Mode catch tests",
        input,
        options: { namespace: "evalFixture", codemode: true },
        execute: async (args) => {
          throw new Error(`fixture thrown error: ${marker(args)}`)
        },
      })
    })
    await ctx.tool.hook("execute.after", (event) => {
      if (event.tool !== "evalFixture_inner_sentinel" || event.status !== "completed") return
      const value = event.input as { marker?: unknown }
      if (typeof value.marker === "string" && Array.isArray(event.result.content)) {
        event.result = {
          ...event.result,
          content: [...event.result.content, { type: "text", text: `FINAL-${value.marker}` }],
        }
      }
    })
  },
})
