import { Plugin, Skill } from "@opencode/plugin"
import core from "./src/plugin.js"
import { loomSkill } from "./src/skill.js"
import { registerReviewCompanions } from "./src/review-companions.js"

// Optional feature errors must not unwind OpenCode's plugin group: a
// deferred transform-replay exception would also dispose core's deny hook.
function warnOptional(feature: string, error: unknown) {
  try {
    console.warn("Loom: " + feature + ":", error instanceof Error ? error.message : String(error))
  } catch { /* Reporting a degraded optional feature must not remove the guard. */ }
}

// Register core before optional skill/tool features. For a managed policy,
// core.setup() installs the pre-transport deny hook on versioned hosts.
export default Plugin.define({
  id: "loom",
  async setup(ctx) {
    const cleanup = await core.setup(ctx)
    let registration: { dispose(): Promise<void> } | undefined
    let companions: (() => Promise<void>) | undefined

    try {
      const guide = await loomSkill()
      const skill = {
        ...guide,
        id: Skill.ID.make(guide.id),
        name: Skill.Name.make(guide.name),
        path: Skill.Info.fields.path.make(guide.path),
      }
      registration = await ctx.skill.transform(editor => {
        // OpenCode replays this synchronously during native registry rebuilds.
        // Catch failures HERE, not only around the registration Promise.
        try {
          if (!editor.get(skill.id)) editor.add({ ...skill })
        } catch (error) {
          warnOptional("native skill transform unavailable", error)
        }
      })
    } catch (error) {
      warnOptional("native skill registration unavailable", error)
    }

    try {
      companions = await registerReviewCompanions(ctx)
    } catch (error) {
      warnOptional("review companion registration unavailable", error)
    }

    return async () => {
      // Core shutdown and cancellation must precede optional disposal.
      // Always attempt all three; never replace the first (core) failure
      // with a later optional cleanup failure.
      const failures: Array<{ feature: string; error: unknown }> = []
      const attempt = async (feature: string, dispose: () => Promise<void> | void) => {
        try { await dispose() } catch (error) { failures.push({ feature, error }) }
      }
      await attempt("core", () => cleanup?.())
      await attempt("review companions", () => companions?.())
      await attempt("skill registration", () => registration?.dispose())
      for (const secondary of failures.slice(1))
        warnOptional("secondary cleanup failure (" + secondary.feature + ")", secondary.error)
      if (failures.length) throw failures[0].error
    }
  },
})
