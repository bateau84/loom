import { Plugin } from "@opencode/plugin"
import core from "./src/plugin.js"
import { loomSkill } from "./src/skill.js"

// The public entrypoint composes the core with its on-demand usage guide.
export default Plugin.define({
  id: "loom",
  async setup(ctx) {
    const skill = await loomSkill()
    const registration = await ctx.skill.transform(editor => {
      // Respect an existing user skill. Rebuilds get a fresh, unmodified definition.
      if (!editor.get(skill.id)) editor.add({
        ...skill,
        // The pinned SDK brands IDs; this is the fixed, plugin-owned literal.
        id: skill.id as Parameters<typeof editor.add>[0]["id"],
      })
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
