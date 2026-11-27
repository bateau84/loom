import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

export const LOOM_SKILL_ID = "loom"

/** Load a packaged asset once, before OpenCode replays the synchronous transform. */
export async function loomSkill() {
  const path = fileURLToPath(new URL("./skills/loom/SKILL.md", import.meta.url))
  return {
    id: LOOM_SKILL_ID,
    name: "Loom",
    description: "Use Loom for optional work coordination, questions/reviews, selective history, source-linked objectives and approved frozen evidence populations. Not general engineering guidance.",
    path,
    content: await readFile(path, "utf8"),
    // V2 uses this to advertise metadata, NOT to inject the full guide eagerly.
    autoinvoke: true,
  }
}
