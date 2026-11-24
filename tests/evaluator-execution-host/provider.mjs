// Local-only factory. Missing fixture registration must never fall through to a network provider.
export function createFixtureProvider() {
  return { languageModel() { throw new Error('Evaluator execution fixture hook missing') } }
}
