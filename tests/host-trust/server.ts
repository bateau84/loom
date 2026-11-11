/** Disposable, provider-free native trust-boundary observer. Never ships with Loom. */
import { Plugin } from "@opencode/plugin"
import { appendFileSync } from "node:fs"
import { join, resolve } from "node:path"

export default Plugin.define({
  id: "loom.host-trust.qualification.fixture",
  async setup(ctx) {
    const root = process.env.LOOM_HOST_TRUST_FIXTURE_ROOT
    if (!root || resolve(ctx.location.directory) !== resolve(join(root, "project")))
      throw new Error("Trust probe must run in its disposable project")
    const audit = (type: string) => appendFileSync(join(root, "host-trust-events.ndjson"),
      JSON.stringify({ type, host: ctx.app.version }) + "\n")
    const disposers: Array<{ dispose(): Promise<void> }> = []
    try {
      disposers.push(await ctx.provider.transform(editor => {
        for (const existing of editor.list()) editor.remove(existing.provider.id)
      }))
      disposers.push(await ctx.session.hook("model.request", () => {
        audit("forbidden-model-request")
        throw new Error("Host trust probe forbids all model requests")
      }))
      audit("fixture-ready")
    } catch (error) {
      await Promise.allSettled(disposers.map(disposer => disposer.dispose()))
      throw error
    }
    return async () => { await Promise.allSettled(disposers.map(disposer => disposer.dispose())) }
  },
})
