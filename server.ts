import { Plugin, Skill } from "@opencode/plugin"
import core from "./src/plugin.js"
import { loomSkill } from "./src/skill.js"
import { registerReviewCompanions } from "./src/review-companions.js"

// Register core before optional skill/tool features. For a managed policy,
// core.setup() installs the pre-transport deny hook on versioned hosts; a
// later optional registration failure must not unload that guard.
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
        // Respect an existing user skill. Rebuilds get a fresh, unmodified definition.
        if (!editor.get(skill.id)) editor.add({ ...skill })
      })
    } catch (error) {
      // Treat the guide as optional. Throwing here would unload core's deny
      // hook on hosts that continue to dispatch after a failed plugin setup.
      console.warn("Loom: native skill registration unavailable:", error instanceof Error ? error.message : String(error))
    }

    try {
      companions = await registerReviewCompanions(ctx)
    } catch (error) {
      // The read-only review tools are optional too; keep core/guard alive.
      console.warn("Loom: review companion registration unavailable:", error instanceof Error ? error.message : String(error))
    }

    return async () => {
      try { await companions?.() }
      finally {
        try { await registration?.dispose() }
        finally { await cleanup?.() }
      }
    }
  },
})
