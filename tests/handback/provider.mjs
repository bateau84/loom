/** The native dynamic-provider loader runs before custom SDK hooks.
 * Supply a real local factory; the fixture hook replaces it before any model call.
 * Missing replacement fails closed instead of reaching an external provider.
 */
export function createFixtureProvider() {
  return { languageModel() { throw new Error("Scripted provider hook was not installed") } }
}
