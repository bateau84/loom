// There is deliberately no network transport or credential fallback.
export function createFixtureProvider() {
  return { languageModel() { throw new Error("Request-local fixture SDK hook is not installed") } }
}
