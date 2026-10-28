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


test("repository OKF profile matches current corpus types, headings and grounded links", async () => {
  const raw: unknown = YAML.parse(await readFile(new URL("../.okf-profile.yaml", import.meta.url), "utf8"))
  expect(raw && typeof raw === "object" && !Array.isArray(raw)).toBe(true)
  const profile = raw as {
    name: unknown
    version: unknown
    concept_types: Array<{ name: string }>
    relationships: Array<{
      name: string
      heading_aliases: string[]
      inverse: string
      allowed_source_types?: string[]
      allowed_target_types?: string[]
    }>
    invariants: unknown[]
  }
  expect(profile.name).toBe("loom")
  expect(profile.version).toBe("1.0")
  expect(Array.isArray(profile.concept_types)).toBe(true)
  expect(Array.isArray(profile.relationships)).toBe(true)
  expect(profile.relationships.length).toBeGreaterThan(0)
  expect(Array.isArray(profile.invariants)).toBe(true)

  const catalog = new Set(profile.concept_types.map(type => type.name))
  for (const file of await corpus(root)) {
    if (["index.md", "log.md"].includes(basename(file))) continue
    const type = metadata(file, await readFile(file, "utf8")).type as string
    expect(catalog.has(type), `Profile does not declare document type ${type} in ${file}`).toBe(true)
  }

  // Mirrors the heading normalization and duplicate rejection in okf-mcp's
  // profile loader. This is a source-shape check, not server verification.
  const normalize = (heading: string) => heading.trim().toLowerCase().replace(/\s+/g, " ")
  const headings = new Map<string, string>()
  const names = new Set<string>()
  for (const relation of profile.relationships) {
    expect(typeof relation.name).toBe("string")
    expect(relation.name.length).toBeGreaterThan(0)
    expect(names.has(relation.name), `Duplicate relationship: ${relation.name}`).toBe(false)
    names.add(relation.name)
    expect(typeof relation.inverse).toBe("string")
    expect(relation.inverse.length).toBeGreaterThan(0)
    expect(relation.heading_aliases.length).toBeGreaterThan(0)
    for (const alias of relation.heading_aliases) {
      const heading = normalize(alias)
      expect(heading.length).toBeGreaterThan(0)
      expect(headings.has(heading), `Duplicate heading alias: ${heading}`).toBe(false)
      headings.set(heading, relation.name)
    }
    for (const list of [relation.allowed_source_types, relation.allowed_target_types]) {
      if (list !== undefined) expect(Array.isArray(list)).toBe(true)
    }
  }
  expect(headings.get("depends on")).toBe("depends-on")
  expect(headings.get("audited primary sources")).toBe("references")

  // Check the concrete links whose accepted meaning justifies each relation.
  // The nearest section heading is used by the okf-mcp graph extractor.
  const linkedUnder = async (file: string, heading: string, target: string, relation: string) => {
    const doc = await readFile(join(root, file), "utf8")
    const marker = `## ${heading}\n`
    const start = doc.indexOf(marker)
    expect(start, `Missing heading ${heading} in ${file}`).toBeGreaterThanOrEqual(0)
    const rest = doc.slice(start + marker.length)
    const end = rest.search(/\n#{1,6} /)
    const section = end < 0 ? rest : rest.slice(0, end)
    const targets = [...section.matchAll(/\]\(([^)]+)\)/g)].map(match => match[1])
    expect(targets, `Missing ${target} under ${heading} in ${file}`).toContain(target)
    expect(headings.get(normalize(heading))).toBe(relation)
    const sourceType = metadata(file, doc).type as string
    const targetFile = resolve(dirname(join(root, file)), target)
    const targetType = metadata(targetFile, await readFile(targetFile, "utf8")).type as string
    const spec = profile.relationships.find(item => item.name === relation)!
    const allows = (values: string[] | undefined, type: string) => !values?.length || values.includes("*") || values.includes(type)
    expect(allows(spec.allowed_source_types, sourceType)).toBe(true)
    expect(allows(spec.allowed_target_types, targetType)).toBe(true)
  }
  await linkedUnder("model-routing.md", "Depends on", "configuration-parser.md", "depends-on")
  await linkedUnder("model-routing.md", "Depends on", "opencode-2.1.1.md", "depends-on")
  await linkedUnder("configuration-parser.md", "Audited primary sources", "configuration-limits.md", "references")
  await linkedUnder("configuration-parser.md", "Audited primary sources", "processing-limits.md", "references")
})


test("indexed OKF concept prose links resolve to indexed files without unsupported fragments", async () => {
  // This detects the common link shapes that caused the graph-integrity
  // warnings. It is not a replacement for okf-mcp's Go Markdown extractor
  // or an invariant that all concepts must have graph relationships.
  const files = await corpus(root)
  const indexed = new Set(files.filter(file => !["index.md", "log.md"].includes(basename(file))))
  for (const file of indexed) {
    let fence: string | null = null
    const lines = (await readFile(file, "utf8")).split("\n")
    for (const [number, line] of lines.entries()) {
      const matchFence = line.match(/^\s*(\x60{3,}|~{3,})/)
      if (matchFence) {
        if (fence === null) fence = matchFence[1]
        else if (matchFence[1][0] === fence[0] && matchFence[1].length >= fence.length) fence = null
        continue
      }
      if (fence !== null) continue
      const prose = line.replace(/\x60+[^\x60]*\x60+/g, "")
      for (const match of prose.matchAll(/\]\(([^)\s]+)(?:\s+[^)]*)?\)/g)) {
        const target = match[1]
        if (/^(https?:|mailto:|#)/i.test(target) || !/\.md(?:#|$)/i.test(target)) continue
        const location = file + ":" + (number + 1)
        expect(target.includes("#"), location + " has an unsupported file fragment: " + target).toBe(false)
        const absolute = target.startsWith("/")
          ? resolve(root, "..", target.replace(/^\/+/, ""))
          : resolve(dirname(file), target)
        expect(indexed.has(absolute), location + " links to a non-indexed concept: " + target).toBe(true)
      }
    }
  }
})
