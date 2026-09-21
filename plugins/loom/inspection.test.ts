import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { findPaths, grepText, selectText, statPaths } from "./inspection"

const roots: string[] = []

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "loom-inspection-"))
  roots.push(root)
  await mkdir(join(root, "docs", "reports"), { recursive: true })
  await mkdir(join(root, "src"), { recursive: true })
  await writeFile(join(root, "docs", "reports", "b.md"), "beta\nProduct Acceptance: pending\nomega\n")
  await writeFile(join(root, "docs", "reports", "a.md"), "alpha\nProduct Acceptance: pass\nomega\n")
  await writeFile(join(root, "docs", "reports", "nested.txt"), "root\n")
  await mkdir(join(root, "docs", "reports", "nested"), { recursive: true })
  await writeFile(join(root, "docs", "reports", "nested", "deep.md"), "Product Acceptance: deep\n")
  await writeFile(
    join(root, "src", "results.log"),
    "case PASS 10\ncase FAIL 30\ncase FAIL 20\ncase FAIL 20\n",
  )
  return root
}

afterEach(async () => {
  while (roots.length > 0) {
    await rm(roots.pop()!, { recursive: true, force: true })
  }
})

describe("Loom structured inspection", () => {
  test("finds and sorts bounded paths without shell composition", async () => {
    const root = await fixture()
    const result = await findPaths(root, {
      path: "docs/reports",
      maxDepth: 1,
      type: "file",
      name: "*.md",
      sort: "path",
    })

    expect(result.entries.map((entry) => entry.path)).toEqual([
      "docs/reports/a.md",
      "docs/reports/b.md",
    ])
    expect(result.matched).toBe(2)
  })

  test("grep searches text with glob and context", async () => {
    const root = await fixture()
    const result = await grepText(root, {
      path: "docs/reports",
      pattern: "product acceptance",
      glob: "*.md",
      caseSensitive: false,
      context: 1,
      maxDepth: 1,
      sort: "path",
    })

    expect(result.matches).toHaveLength(2)
    expect(result.matches[0]).toMatchObject({
      path: "docs/reports/a.md",
      line: 2,
      text: "Product Acceptance: pass",
      before: ["alpha"],
      after: ["omega"],
    })
  })

  test("grep supports bounded regular expressions", async () => {
    const root = await fixture()
    const result = await grepText(root, {
      path: "docs/reports",
      pattern: "Acceptance: (pass|pending)",
      regex: true,
      glob: "*.md",
      maxDepth: 1,
    })

    expect(result.matched).toBe(2)
  })

  test("select filters, projects, sorts, and deduplicates fields", async () => {
    const root = await fixture()
    const result = await selectText(root, {
      path: "src/results.log",
      where: { field: 2, op: "eq", value: "FAIL" },
      fields: [2, 3],
      sort: { field: 3, order: "desc", numeric: true },
      unique: true,
    })

    expect(result.rows.map((row) => row.fields)).toEqual([
      ["FAIL", "30"],
      ["FAIL", "20"],
    ])
    expect(result.matched).toBe(2)
  })

  test("select supports tail-style bounded output", async () => {
    const root = await fixture()
    const result = await selectText(root, {
      path: "src/results.log",
      fields: [2, 3],
      from: "end",
      limit: 2,
    })

    expect(result.rows.map((row) => row.fields)).toEqual([
      ["FAIL", "20"],
      ["FAIL", "20"],
    ])
  })

  test("stats reports bytes and optional line counts", async () => {
    const root = await fixture()
    const result = await statPaths(root, {
      paths: ["docs/reports/a.md", "src/results.log"],
      lineCount: true,
    })

    expect(result.count).toBe(2)
    expect(result.totalBytes).toBeGreaterThan(0)
    expect(result.entries.every((entry) => typeof entry.lines === "number")).toBe(true)
  })

  test("rejects lexical path escape", async () => {
    const root = await fixture()
    await expect(findPaths(root, { path: "../outside" })).rejects.toThrow(
      "must stay inside the project",
    )
  })

  test("rejects symlinks that resolve outside the project", async () => {
    const root = await fixture()
    const outside = await mkdtemp(join(tmpdir(), "loom-inspection-outside-"))
    roots.push(outside)
    await writeFile(join(outside, "secret.txt"), "secret\n")
    await symlink(join(outside, "secret.txt"), join(root, "outside-link"))

    await expect(grepText(root, { path: "outside-link", pattern: "secret" })).rejects.toThrow(
      "resolves outside the project",
    )
  })

  test("caps result size even when callers request more", async () => {
    const root = await fixture()
    const result = await findPaths(root, {
      path: "docs/reports",
      maxDepth: 2,
      limit: 10_000,
    })

    expect(result.entries.length).toBeLessThanOrEqual(500)
  })
})
