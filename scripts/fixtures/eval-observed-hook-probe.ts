import { appendFile } from "node:fs/promises"
import { join } from "node:path"
import { Plugin } from "@opencode/plugin"

type Event = Readonly<Record<string, unknown>>
type Registration = { dispose(): Promise<void> }
type ObservedHookContext = {
  hook(name: string, callback: (event: Event) => void | Promise<void>): Promise<Registration>
}

export default Plugin.define({
  id: "loom.eval-observed-hook-probe",
  async setup(ctx) {
    // The base image's Promise plugin types predate this opt-in experimental
    // runtime hook. Use a narrow structural adapter; runtime activation is
    // separately exercised against the exact experimental image.
    const hooks = ctx.tool as unknown as ObservedHookContext
    const path = join(ctx.location.directory, ".loom-eval-local-observed.jsonl")
    const registration = await hooks.hook("execute.observed", async (event) => {
      if (process.env.EVAL_OBSERVER_FIXTURE_THROW === "1") {
        throw new Error("diagnostic observer callback failure")
      }
      await appendFile(path, JSON.stringify(event) + "\n", { encoding: "utf-8" })
    })
    return () => registration.dispose()
  },
})
