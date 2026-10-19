import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

export const LOOM_SKILL_ID = "loom"

/** Load a packaged asset once, before OpenCode replays the synchronous transform. */
export async function loomSkill() {
  const path = fileURLToPath(new URL("./skills/loom/SKILL.md", import.meta.url))
  return {
    id: LOOM_SKILL_ID,
    name: "Loom",
    description: "Use when working with Loom Actions, Plans, task context, evidence, completion, handoffs, Assessment or QA. Not general engineering guidance.",
    path,
    content: await readFile(path, "utf8"),
    // V2 uses this to advertise metadata, NOT to inject the full guide eagerly.
    autoinvoke: true,
  }
}
