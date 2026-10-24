import { test, expect } from "bun:test"
import { YAML } from "bun"
import { readdir, readFile } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

// Contract: this tests the repository's docs corpus, not arbitrary .md
// assets such as native SKILL.md files. It cannot validate an okf-mcp
// server's graph profile or the meaning of document relationships.
const root = fileURLToPath(new URL("../docs/", import.meta.url))

async function corpus(dir: string): Promise<string[]> {
  const result: string[] = []
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, item.name)
    if (item.isDirectory()) result.push(...await corpus(path))
    else if (item.isFile() && item.name.endsWith(".md")) result.push(path)
  }
  return result.sort()
}

function metadata(file: string, value: string): Record<string, unknown> {
  const match = value.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/)
  expect(match, `${file}: missing YAML frontmatter`).not.toBeNull()
  const valueObject: unknown = YAML.parse(match![1])
  expect(valueObject && typeof valueObject === "object" && !Array.isArray(valueObject),
    `${file}: YAML frontmatter must be a mapping`).toBe(true)
  return valueObject as Record<string, unknown>
}

test("every OKF concept in docs has parseable frontmatter and a nonempty type", async () => {
  const files = await corpus(root)
  expect(files.length).toBeGreaterThan(0)
  for (const file of files) {
    if (["index.md", "log.md"].includes(basename(file))) continue
    const doc = metadata(file, await readFile(file, "utf8"))
    expect(typeof doc.type, `${file}: type must be a string`).toBe("string")
    expect((doc.type as string).trim().length, `${file}: type must not be empty`).toBeGreaterThan(0)
  }
})

test("reserved indices inventory direct concepts, logs and each immediate nested bundle", async () => {
  const files = await corpus(root)
  const indices = files.filter(file => basename(file) === "index.md")
  for (const index of indices) {
    const content = await readFile(index, "utf8")
    expect(content.startsWith("---\n"), `${index}: index must have no frontmatter`).toBe(false)
    const links = [...content.matchAll(/\]\(([^)]+)\)/g)]
      .map(match => match[1].split("#")[0])
      .filter(href => href && !href.startsWith("#") && !/^[a-z]+:\/\//i.test(href))
      .map(href => resolve(dirname(index), href))
    const listed = new Set(links)
    const direct = files.filter(file => dirname(file) === dirname(index) && file !== index)
    const children = indices.filter(other => dirname(dirname(other)) === dirname(index))
    for (const target of [...direct, ...children]) {
      expect(listed.has(target), `${index}: missing indexed entry for ${target}`).toBe(true)
    }
  }
})

test("bundle logs preserve the target's Log metadata and newest-first ISO date headings", async () => {
  const logs = (await corpus(root)).filter(file => basename(file) === "log.md")
  for (const file of logs) {
    const s = await readFile(file, "utf8")
    // Target-repository okf-mcp convention: type: Log on reserved logs.
    // This is not a universal OKF v0.2 requirement.
    expect(metadata(file, s).type).toBe("Log")
    const headings = [...s.matchAll(/^## (\d{4}-\d{2}-\d{2})(?:\s|$)/gm)].map(m => m[1])
    expect(headings.length, `${file}: missing ISO dated history`).toBeGreaterThan(0)
    expect(headings).toEqual([...headings].sort().reverse())
  }
})
