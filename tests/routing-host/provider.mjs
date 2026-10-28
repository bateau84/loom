// The V2 fixture supplies a local AI SDK language model at runtime.
// Any attempt to bypass the in-memory fixture fails rather than using network.
export function createFixtureProvider() {
  return { languageModel() { throw new Error("Routing test fixture hook not installed") } }
}
