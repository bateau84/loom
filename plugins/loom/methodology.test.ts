import { describe, expect, test } from "bun:test"
import { loadSkillCompanion, validateSkillName } from "./methodology"

describe("Loom skill methodology loading", () => {
  test("loads Reviewer and Critic companions by validated skill name", async () => {
    const assessment = await loadSkillCompanion("software-engineering", "assessment")
    expect(assessment.available).toBe(true)
    if (assessment.available) {
      expect(assessment.path).toBe("skills/software-engineering/ASSESSMENT.md")
      expect(assessment.content).toContain("## Review criteria")
      expect(assessment.sha256).toMatch(/^[a-f0-9]{64}$/)
    }

    const qa = await loadSkillCompanion("software-engineering", "qa")
    expect(qa.available).toBe(true)
    if (qa.available) {
      expect(qa.path).toBe("skills/software-engineering/QA.md")
      expect(qa.content).toContain("## QA criteria")
      expect(qa.sha256).toMatch(/^[a-f0-9]{64}$/)
    }
  })

  test("rejects path-like skill names", () => {
    expect(() => validateSkillName("../software-engineering")).toThrow("Skill name")
    expect(() => validateSkillName("SoftwareEngineering")).toThrow("Skill name")
  })

  test("reports an absent optional companion without guessing paths", async () => {
    const missing = await loadSkillCompanion("does-not-exist", "assessment")
    expect(missing).toEqual({
      skill: "does-not-exist",
      methodology: "assessment",
      available: false,
      path: "skills/does-not-exist/ASSESSMENT.md",
    })
  })
})
