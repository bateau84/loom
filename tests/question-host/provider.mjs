// Local-only factory. Native SDK hook supplies the scripted external model.
// Failure to install that hook must never reach a network provider.
export function createFixtureProvider() {
  return { languageModel() { throw new Error('Local question provider hook missing') } }
}
