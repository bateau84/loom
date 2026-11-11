import { Plugin, Skill } from "@opencode/plugin"
import core from "./src/plugin.js"
import { loomSkill } from "./src/skill.js"
import { registerReviewCompanions, type CompanionReceipt } from "./src/review-companions.js"

// Optional registry replay errors must not unwind the OpenCode plugin group,
// which would dispose the core pre-transport model-request guard.
function warnOptional(feature: string, error: unknown) {
  try {
    console.warn("Loom: " + feature + ":", error instanceof Error ? error.message : String(error))
  } catch { /* Diagnostic reporting must not remove a registered safety guard. */ }
}

export default Plugin.define({
  id: "loom",
  async setup(ctx) {
    // Core installs the native pre-transport guard before any optional registration.
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
        // OpenCode may replay this callback on subsequent registry rebuilds.
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
      const recorder = cleanup && typeof cleanup === "function"
        ? (cleanup as typeof cleanup & { captureCompanion?: (receipt: CompanionReceipt) => Promise<void> }).captureCompanion
        : undefined
      companions = await registerReviewCompanions(ctx, recorder)
    } catch (error) {
      warnOptional("review companion registration unavailable", error)
    }

    return async () => {
      // Stop core processing first. Attempt every optional cleanup even if core
      // fails; preserve the first error rather than replacing it with a later one.
      const failures: Array<{ feature: string; error: unknown }> = []
      const attempt = async (feature: string, dispose: () => Promise<void> | void) => {
        try { await dispose() } catch (error) { failures.push({ feature, error }) }
      }
      await attempt("core", () => cleanup?.())
      await attempt("review companions", () => companions?.())
      await attempt("skill registration", () => registration?.dispose())
      for (const failure of failures.slice(1))
        warnOptional("secondary cleanup failure (" + failure.feature + ")", failure.error)
      if (failures.length) throw failures[0]!.error
    }
  },
})
