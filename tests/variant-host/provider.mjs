// Local fixture only: SDK hook must install the scripted provider before any request.
export function createVariantProvider() {
  return { languageModel() { throw new Error("Variant SDK hook was not installed") } }
}
