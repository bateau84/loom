import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export type SkillCompanionKind = "assessment" | "qa"

const SKILLS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../skills")

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

export async function loadSkillCompanion(skill: string, kind: SkillCompanionKind) {
  const normalized = validateSkillName(skill)
  const filename = companionName(kind)
  const path = `skills/${normalized}/${filename}`
  const absolute = resolve(SKILLS_ROOT, normalized, filename)

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
