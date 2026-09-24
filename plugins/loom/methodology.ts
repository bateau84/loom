import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { basename, resolve } from "node:path"

export type SkillCompanionKind = "assessment" | "qa"

function companionName(kind: SkillCompanionKind) {
  return kind === "assessment" ? "ASSESSMENT.md" : "QA.md"
}

export function validateSkillName(skill: string) {
  const normalized = skill.trim()
  if (!/^[a-z0-9][a-z0-9-]*$/.test(normalized)) {
    throw new Error("Skill name must contain only lowercase letters, numbers, and hyphens.")
  }
  return normalized
}

export async function loadSkillCompanion(
  skill: string,
  kind: SkillCompanionKind,
  skillDirectory: string,
) {
  const normalized = validateSkillName(skill)
  const root = resolve(skillDirectory)
  if (basename(root) !== normalized) {
    throw new Error(`Native skill directory does not match requested skill ${normalized}.`)
  }

  const filename = companionName(kind)
  const path = `skills/${normalized}/${filename}`
  const absolute = resolve(root, filename)

  try {
    const content = await readFile(absolute, "utf8")
    return {
      skill: normalized,
      methodology: kind,
      available: true as const,
      path,
      sha256: createHash("sha256").update(content).digest("hex"),
      content,
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return {
        skill: normalized,
        methodology: kind,
        available: false as const,
        path,
      }
    }
    throw error
  }
}
