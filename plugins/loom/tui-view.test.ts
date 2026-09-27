import { describe, expect, test } from "bun:test"
import { selectedModelText } from "./tui-view"

describe("selectedModelText", () => {
  test("omits model status when the host does not expose model selection", () => {
    expect(selectedModelText({})).toBeUndefined()
    expect(selectedModelText({ model: { current: () => undefined } })).toBeUndefined()
  })

  test("renders the selected provider and model", () => {
    expect(selectedModelText({
      model: {
        current: () => ({ providerID: "openai", modelID: "gpt-5.6-luna" }),
      },
    })).toBe("Model: openai/gpt-5.6-luna")
  })

  test("adds the selected variant when one is active", () => {
    expect(selectedModelText({
      model: {
        current: () => ({
          providerID: "openai",
          modelID: "gpt-5.6-luna",
          variant: "high",
        }),
      },
    })).toBe("Model: openai/gpt-5.6-luna#high")
  })
})
