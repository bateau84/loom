/**
 * Fault-injection wrapper for the EXACT npm-packed Loom server entrypoint.
 *
 * This is a local-only installed-host acceptance fixture. It registers Loom
 * callbacks inside one real OpenCode 2.2.6 plugin State.group. An external
 * marker triggers a later native registry rebuild; editor operations fail
 * inside Loom's optional callbacks, not in a synthetic plugin runtime.
 *
 * "control" intentionally throws from an uncontained transform to prove
 * the host would disable a plugin and dispose its model.request guard.
 */
import { Plugin } from "@opencode/plugin"
import { appendFileSync, existsSync } from "node:fs"
import { isAbsolute, join } from "node:path"
import { pathToFileURL } from "node:url"

type Fault = "skill" | "review" | "control"
const faults: Fault[] = ["skill", "review", "control"]

export default Plugin.define({
  id: "loom",
  async setup(ctx) {
    const root = process.env.LOOM_REPLAY_ROOT
    const entry = process.env.LOOM_REPLAY_PACKED_SERVER
    const mode = process.env.LOOM_REPLAY_FAULT as Fault | undefined
    if (!root || !isAbsolute(root) || !entry || !isAbsolute(entry) ||
        !entry.endsWith("/server.ts") || !faults.includes(mode as Fault)) {
      throw new Error("Private replay root, packed Loom server and exact fault mode are required")
    }
    const audit = (event: string) => {
      appendFileSync(join(root, "replay-events.ndjson"), JSON.stringify({ event, mode }) + "\n")
    }
    const candidate = (await import(pathToFileURL(entry).href)).default
    if (!candidate || candidate.id !== "loom" || typeof candidate.setup !== "function")
      throw new Error("Packed Loom entrypoint is not a valid plugin")

    let armed = false
    const bridged = {
      ...ctx,
      skill: {
        ...ctx.skill,
        transform: (callback: any) => ctx.skill.transform(editor => callback({
          ...editor,
          get: (id: any) => {
            if (armed && mode === "skill") {
              audit("injected-skill-get-fault")
              throw new Error("LOOM_REPLAY_INJECTED_SKILL_GET")
            }
            return editor.get(id)
          },
        })),
      },
      tool: {
        ...ctx.tool,
        transform: (callback: any) => ctx.tool.transform(editor => callback({
          ...editor,
          add: (item: any) => {
            if (armed && mode === "review" && ["assessment", "qa"].includes(item.name)) {
              audit("injected-review-add-fault")
              throw new Error("LOOM_REPLAY_INJECTED_REVIEW_ADD")
            }
            return editor.add(item)
          },
        })),
      },
    } as typeof ctx

    const cleanup = await candidate.setup(bridged)
    const control = mode === "control"
      ? await ctx.skill.transform(() => {
          if (armed) {
            audit("injected-uncontained-control-fault")
            throw new Error("LOOM_REPLAY_UNCONTAINED_CONTROL")
          }
        })
      : undefined

    const marker = join(root, "trigger-replay")
    let fired = false
    const pulse = setInterval(() => {
      if (fired || !existsSync(marker)) return
      fired = true
      clearInterval(pulse)
      armed = true
      audit("replay-triggered")
      void Promise.resolve(mode === "review" ? ctx.tool.reload() : ctx.skill.reload())
        .then(() => audit("replay-returned"))
        .catch(() => audit("replay-rejected"))
    }, 50)

    audit("packed-loom-loaded")
    return async () => {
      clearInterval(pulse)
      try { await cleanup?.() }
      finally { await control?.dispose() }
    }
  },
})
