import { Plugin, Skill } from "@opencode/plugin"
import core from "./src/plugin.js"
import { loomSkill } from "./src/skill.js"

// The public entrypoint composes the core with its on-demand usage guide.
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
    try {
      const cleanup = await core.setup(ctx)
      return async () => {
        try { await cleanup?.() }
        finally { await registration.dispose() }
      }
    } catch (error) {
      await Promise.allSettled([registration.dispose()])
      throw error
    }
  },
})
