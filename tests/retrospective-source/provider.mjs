// The SDK hook supplies the scripted local model. Never route this to a network.
export function createSourceProvider() {
  return { languageModel() { throw new Error("QA-B source SDK hook missing") } }
}
