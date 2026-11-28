import { expect } from "bun:test"

export const INTERPRETATION_UNAVAILABLE = "Evaluator interpretation unavailable; check current source permissions or reduce the report-list limit"

/** The public boundary must not distinguish hidden source state, cardinality,
 * report existence or a failed final grant through error details or payloads. */
export async function expectInterpretationUnavailable(work: Promise<unknown>) {
  const error = await work.then(() => undefined, failure => failure)
  expect(error).toBeInstanceOf(Error)
  expect(error.message).toBe(INTERPRETATION_UNAVAILABLE)
  expect(String(error)).toBe("Error: " + INTERPRETATION_UNAVAILABLE)
  // Bun attaches source-location fields to this newly constructed boundary
  // error. They are engine metadata, not an owner-supplied result or cause.
  const engineFields = new Set(["message", "stack", "originalLine", "originalColumn", "line", "column", "sourceURL"])
  expect(Object.getOwnPropertyNames(error).filter(name => !engineFields.has(name))).toEqual([])
}
