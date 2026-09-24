import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { loadSkillCompanion, validateSkillName } from "./methodology"

const SOFTWARE_ENGINEERING_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../skills/software-engineering",
)

describe("Loom skill methodology loading", () => {
  test("loads Reviewer and Critic companions from the native skill directory", async () => {
    const assessment = await loadSkillCompanion(
      "software-engineering",
      "assessment",
      SOFTWARE_ENGINEERING_DIR,
    )
    expect(assessment.available).toBe(true)
    if (assessment.available) {
      expect(assessment.path).toBe("skills/software-engineering/ASSESSMENT.md")
      expect(assessment.content).toContain("## Review criteria")
      expect(assessment.sha256).toMatch(/^[a-f0-9]{64}$/)
    }

    const qa = await loadSkillCompanion(
      "software-engineering",
      "qa",
      SOFTWARE_ENGINEERING_DIR,
    )
    expect(qa.available).toBe(true)
    if (qa.available) {
      expect(qa.path).toBe("skills/software-engineering/QA.md")
      expect(qa.content).toContain("## QA criteria")
      expect(qa.sha256).toMatch(/^[a-f0-9]{64}$/)
    }
  })

  test("rejects path-like skill names and mismatched native directories", async () => {
    expect(() => validateSkillName("../software-engineering")).toThrow("Skill name")
    expect(() => validateSkillName("SoftwareEngineering")).toThrow("Skill name")
    await expect(
      loadSkillCompanion("software-engineering", "assessment", dirname(SOFTWARE_ENGINEERING_DIR)),
    ).rejects.toThrow("does not match")
  })

  test("reports an absent optional companion from the native skill directory", async () => {
    const temp = await mkdtemp(join(tmpdir(), "loom-skill-methodology-"))
    const skillDirectory = join(temp, "does-not-exist")
    await mkdir(skillDirectory)
    try {
      const missing = await loadSkillCompanion("does-not-exist", "assessment", skillDirectory)
      expect(missing).toEqual({
        skill: "does-not-exist",
        methodology: "assessment",
        available: false,
        path: "skills/does-not-exist/ASSESSMENT.md",
      })
    } finally {
      await rm(temp, { recursive: true, force: true })
    }
  })
})
