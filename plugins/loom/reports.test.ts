import { afterEach, describe, expect, test } from "bun:test"
import { lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { prepareReportPromotion, publishPreparedReport, reconcilePendingReportPromotion, type ReportPromotionInput, type ReportPromotionRecord } from "./reports"

const roots: string[] = []

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "loom-reports-"))
  roots.push(root)
  await mkdir(join(root, "ephemeral-reports", "critic"), { recursive: true })
  await mkdir(join(root, "docs"), { recursive: true })
  return root
}

const report = `---
type: report critic
title: Readiness Gate
description: Failed readiness gate with actionable findings.
tags: [report, critic, readiness]
---

# Readiness Gate

Verdict: FAIL
`

async function promoteReport(root: string, input: ReportPromotionInput, id = crypto.randomUUID()) {
  const prepared = await prepareReportPromotion(root, input, id)
  return publishPreparedReport(prepared)
}

async function missing(path: string) {
  try {
    await lstat(path)
    return false
  } catch (error: any) {
    if (error?.code === "ENOENT") return true
    throw error
  }
}

afterEach(async () => {
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true })
})

describe("Loom report promotion", () => {
  test("copies an OKF report byte-for-byte and retains the ephemeral source", async () => {
    const root = await fixture()
    const source = join(root, "ephemeral-reports", "critic", "readiness.md")
    await writeFile(source, report)

    const result = await promoteReport(root, {
      source: "ephemeral-reports/critic/readiness.md",
      destination: "docs/reports/critic/readiness.md",
      reason: "Preserve this gate as durable audit evidence.",
    })

    expect(result).toMatchObject({
      promoted: true,
      sourceRetained: true,
      authority: "unchanged",
    })
    expect(await readFile(source, "utf8")).toBe(report)
    expect(await readFile(join(root, "docs", "reports", "critic", "readiness.md"), "utf8")).toBe(report)
  })

  test("rejects reports outside the ephemeral report root", async () => {
    const root = await fixture()
    await writeFile(join(root, "outside.md"), report)

    await expect(
      promoteReport(root, {
        source: "outside.md",
        destination: "docs/reports/outside.md",
        reason: "Keep it.",
      }),
    ).rejects.toThrow("must be under ephemeral-reports")
  })

  test("rejects malformed YAML that only looks like frontmatter", async () => {
    const root = await fixture()
    await writeFile(
      join(root, "ephemeral-reports", "critic", "malformed.md"),
      "---\ntype: report critic\ntitle: Broken\ndescription: Broken\ntags: [report, critic\n---\n",
    )

    await expect(
      promoteReport(root, {
        source: "ephemeral-reports/critic/malformed.md",
        destination: "docs/reports/critic/malformed.md",
        reason: "Keep it.",
      }),
    ).rejects.toThrow("valid YAML")
  })

  test("rejects incorrectly typed OKF report fields", async () => {
    const root = await fixture()
    await writeFile(
      join(root, "ephemeral-reports", "critic", "bad-tags.md"),
      "---\ntype: report critic\ntitle: Bad tags\ndescription: Bad tags\ntags: report\n---\n",
    )

    await expect(
      promoteReport(root, {
        source: "ephemeral-reports/critic/bad-tags.md",
        destination: "docs/reports/critic/bad-tags.md",
        reason: "Keep it.",
      }),
    ).rejects.toThrow("non-empty string array")
  })

  test("rejects non-report or incomplete OKF frontmatter", async () => {
    const root = await fixture()
    await writeFile(
      join(root, "ephemeral-reports", "critic", "bad.md"),
      "---\ntype: note\ntitle: Bad\ndescription: Bad\ntags: [bad]\n---\n",
    )

    await expect(
      promoteReport(root, {
        source: "ephemeral-reports/critic/bad.md",
        destination: "docs/reports/critic/bad.md",
        reason: "Keep it.",
      }),
    ).rejects.toThrow("OKF type")
  })

  test("never overwrites an existing durable report", async () => {
    const root = await fixture()
    await writeFile(join(root, "ephemeral-reports", "critic", "readiness.md"), report)
    await mkdir(join(root, "docs", "reports", "critic"), { recursive: true })
    await writeFile(join(root, "docs", "reports", "critic", "readiness.md"), "existing\n")

    await expect(
      promoteReport(root, {
        source: "ephemeral-reports/critic/readiness.md",
        destination: "docs/reports/critic/readiness.md",
        reason: "Keep it.",
      }),
    ).rejects.toThrow("never overwrites")
  })

  test("rejects a symlinked source even when it resolves inside the project", async () => {
    const root = await fixture()
    await writeFile(join(root, "ephemeral-reports", "critic", "real.md"), report)
    await symlink(
      join(root, "ephemeral-reports", "critic", "real.md"),
      join(root, "ephemeral-reports", "critic", "link.md"),
    )

    await expect(
      promoteReport(root, {
        source: "ephemeral-reports/critic/link.md",
        destination: "docs/reports/critic/link.md",
        reason: "Keep it.",
      }),
    ).rejects.toThrow("not a symlink")
  })

  test("rejects a report type that impersonates another producer namespace", async () => {
    const root = await fixture()
    await mkdir(join(root, "ephemeral-reports", "reviewer"), { recursive: true })
    await writeFile(
      join(root, "ephemeral-reports", "reviewer", "impersonated.md"),
      report,
    )

    await expect(
      promoteReport(root, {
        source: "ephemeral-reports/reviewer/impersonated.md",
        destination: "docs/reports/reviewer/impersonated.md",
        reason: "Keep it.",
      }),
    ).rejects.toThrow("does not match source namespace")
  })

  test("rejects promotion that relabels the producer namespace", async () => {
    const root = await fixture()
    await writeFile(join(root, "ephemeral-reports", "critic", "readiness.md"), report)

    await expect(
      promoteReport(root, {
        source: "ephemeral-reports/critic/readiness.md",
        destination: "docs/reports/reviewer/readiness.md",
        reason: "Keep it.",
      }),
    ).rejects.toThrow("must preserve producer namespace")
  })

  test("rejects durable destinations outside docs/reports", async () => {
    const root = await fixture()
    await writeFile(join(root, "ephemeral-reports", "critic", "readiness.md"), report)

    await expect(
      promoteReport(root, {
        source: "ephemeral-reports/critic/readiness.md",
        destination: "docs/architecture/readiness.md",
        reason: "Keep it.",
      }),
    ).rejects.toThrow("must be under docs/reports")
  })


  test("interruption before atomic publish leaves no durable partial file and is retryable", async () => {
    const root = await fixture()
    await writeFile(join(root, "ephemeral-reports", "critic", "readiness.md"), report)

    const id = "before-publish"
    const prepared = await prepareReportPromotion(
      root,
      {
        source: "ephemeral-reports/critic/readiness.md",
        destination: "docs/reports/critic/readiness.md",
        reason: "Keep it.",
      },
      id,
    )
    const pending: ReportPromotionRecord = {
      id,
      status: "pending",
      source: prepared.source,
      destination: prepared.destination,
      reason: prepared.reason,
      actor: "general",
      startedAt: new Date().toISOString(),
      sha256: prepared.sha256,
      bytes: prepared.bytes.byteLength,
      authority: "unchanged",
    }

    await writeFile(prepared.temporaryPath, prepared.bytes.subarray(0, 8), { flag: "wx" })
    const reconciled = await reconcilePendingReportPromotion(root, pending)

    expect(reconciled).toMatchObject({
      id,
      status: "failed",
      authority: "unchanged",
    })
    expect(reconciled.error).toContain("safe to retry")
    expect(await missing(prepared.destinationPath)).toBe(true)
    expect(await missing(prepared.temporaryPath)).toBe(true)

    const retry = await promoteReport(
      root,
      {
        source: pending.source,
        destination: pending.destination,
        reason: pending.reason,
      },
      "retry-after-interruption",
    )
    expect(retry.promoted).toBe(true)
  })

  test("interruption after atomic publish is recovered from destination hash", async () => {
    const root = await fixture()
    await writeFile(join(root, "ephemeral-reports", "critic", "readiness.md"), report)

    const id = "after-publish"
    const prepared = await prepareReportPromotion(
      root,
      {
        source: "ephemeral-reports/critic/readiness.md",
        destination: "docs/reports/critic/readiness.md",
        reason: "Keep it.",
      },
      id,
    )
    const pending: ReportPromotionRecord = {
      id,
      status: "pending",
      source: prepared.source,
      destination: prepared.destination,
      reason: prepared.reason,
      actor: "general",
      startedAt: new Date().toISOString(),
      sha256: prepared.sha256,
      bytes: prepared.bytes.byteLength,
      authority: "unchanged",
    }

    await publishPreparedReport(prepared)
    const reconciled = await reconcilePendingReportPromotion(root, pending)

    expect(reconciled).toMatchObject({
      id,
      status: "completed",
      recovered: true,
      sha256: prepared.sha256,
      bytes: prepared.bytes.byteLength,
      authority: "unchanged",
    })
    expect(await readFile(prepared.destinationPath, "utf8")).toBe(report)
  })

  test("recovery refuses a durable file whose bytes do not match the pending audit", async () => {
    const root = await fixture()
    await writeFile(join(root, "ephemeral-reports", "critic", "readiness.md"), report)

    const id = "mismatched-publish"
    const prepared = await prepareReportPromotion(
      root,
      {
        source: "ephemeral-reports/critic/readiness.md",
        destination: "docs/reports/critic/readiness.md",
        reason: "Keep it.",
      },
      id,
    )
    const pending: ReportPromotionRecord = {
      id,
      status: "pending",
      source: prepared.source,
      destination: prepared.destination,
      reason: prepared.reason,
      actor: "general",
      startedAt: new Date().toISOString(),
      sha256: prepared.sha256,
      bytes: prepared.bytes.byteLength,
      authority: "unchanged",
    }

    await writeFile(prepared.destinationPath, "different\n", { flag: "wx" })
    const reconciled = await reconcilePendingReportPromotion(root, pending)

    expect(reconciled.status).toBe("failed")
    expect(reconciled.error).toContain("differs from pending audit")
  })
})
