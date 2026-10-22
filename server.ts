import { Plugin, Skill } from "@opencode/plugin"
import core from "./src/plugin.js"
import { loomSkill } from "./src/skill.js"
import { registerReviewCompanions } from "./src/review-companions.js"

// The public entrypoint composes ledger tools, the usage guide and read-only review lenses.
export default Plugin.define({
  id: "loom",
  async setup(ctx) {
    const guide = await loomSkill()
    const skill = {
      ...guide,
      id: Skill.ID.make(guide.id),
      name: Skill.Name.make(guide.name),
      path: Skill.Info.fields.path.make(guide.path),
    }
    const registration = await ctx.skill.transform(editor => {
      // Respect an existing user skill. Rebuilds get a fresh, unmodified definition.
      if (!editor.get(skill.id)) editor.add({ ...skill })
    })
    let cleanup: Plugin.Cleanup | void
    let companions: (() => Promise<void>) | undefined
    try {
      cleanup = await core.setup(ctx)
      companions = await registerReviewCompanions(ctx)
      return async () => {
        try { await companions?.() }
        finally {
          try { await cleanup?.() }
          finally { await registration.dispose() }
        }
      }
    } catch (error) {
      // Cleanup failures must not replace the activation error.
      await Promise.allSettled([
        Promise.resolve().then(() => companions?.()),
        Promise.resolve().then(() => cleanup?.()),
        Promise.resolve().then(() => registration.dispose()),
      ])
      throw error
    }
  },
})
