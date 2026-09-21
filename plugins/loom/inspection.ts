import { lstat, readFile, readdir, realpath } from "node:fs/promises"
import { basename, isAbsolute, relative, resolve, sep } from "node:path"

const MAX_DEPTH = 12
const MAX_RESULTS = 500
const MAX_SCANNED_ENTRIES = 20_000
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_TOTAL_SEARCH_BYTES = 8 * 1024 * 1024
const MAX_PATTERN_LENGTH = 256
const MAX_LINE_LENGTH = 16_384

export type FindOptions = {
  path?: string
  minDepth?: number
  maxDepth?: number
  type?: "file" | "directory" | "symlink"
  name?: string
  sort?: "path" | "name" | "size" | "mtime"
  order?: "asc" | "desc"
  limit?: number
  includeHidden?: boolean
}

export type GrepOptions = {
  path?: string
  pattern: string
  regex?: boolean
  caseSensitive?: boolean
  glob?: string
  context?: number
  maxDepth?: number
  includeHidden?: boolean
  sort?: "path" | "line"
  order?: "asc" | "desc"
  limit?: number
}

export type SelectOptions = {
  path: string
  delimiter?: string
  where?: {
    field: number
    op: "eq" | "neq" | "contains" | "startsWith" | "endsWith" | "gt" | "gte" | "lt" | "lte"
    value: string
  }
  fields?: number[]
  sort?: {
    field: number
    order?: "asc" | "desc"
    numeric?: boolean
  }
  unique?: boolean
  from?: "start" | "end"
  limit?: number
  skipBlank?: boolean
}

export type StatsOptions = {
  paths: string[]
  lineCount?: boolean
}

type Entry = {
  path: string
  name: string
  type: "file" | "directory" | "symlink" | "other"
  size: number
  mtime: string
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number) {
  if (value === undefined) return fallback
  if (!Number.isInteger(value)) throw new Error("Expected an integer.")
  return Math.max(min, Math.min(value, max))
}

function normalizeRelativePath(value: string | undefined) {
  const raw = (value ?? ".").trim().replaceAll("\\", "/")
  if (!raw || raw === ".") return "."
  if (isAbsolute(raw) || raw.split("/").includes("..")) {
    throw new Error("Inspection paths must stay inside the project.")
  }
  return raw.replace(/^\.\//, "")
}

function inside(root: string, path: string) {
  const rel = relative(root, path)
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))
}

async function resolveInside(root: string, input: string | undefined) {
  const projectRoot = await realpath(root)
  const requested = resolve(projectRoot, normalizeRelativePath(input))
  if (!inside(projectRoot, requested)) throw new Error("Inspection path escapes the project.")

  const target = await realpath(requested)
  if (!inside(projectRoot, target)) {
    throw new Error("Inspection path resolves outside the project.")
  }

  return { projectRoot, target }
}

function displayPath(root: string, path: string) {
  const value = relative(root, path).split(sep).join("/")
  return value || "."
}

function hiddenRelative(path: string) {
  return path.split("/").some((part) => part.startsWith(".") && part !== "." && part !== "..")
}

function globRegex(glob: string) {
  if (glob.length > 256) throw new Error("Glob is too long.")
  let source = "^"
  for (const char of glob) {
    if (char === "*") source += ".*"
    else if (char === "?") source += "."
    else source += char.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&")
  }
  source += "$"
  return new RegExp(source)
}

function compareValues(a: string | number, b: string | number) {
  if (typeof a === "number" && typeof b === "number") return a - b
  return String(a).localeCompare(String(b))
}

async function collectEntries(
  root: string,
  start: string,
  options: { maxDepth: number; includeHidden: boolean },
) {
  const entries: Entry[] = []
  let scanned = 0

  const visit = async (path: string, depth: number): Promise<void> => {
    scanned += 1
    if (scanned > MAX_SCANNED_ENTRIES) {
      throw new Error("Inspection scanned too many entries; narrow the path or depth.")
    }

    const info = await lstat(path)
    const rel = displayPath(root, path)
    const type: Entry["type"] = info.isSymbolicLink()
      ? "symlink"
      : info.isFile()
        ? "file"
        : info.isDirectory()
          ? "directory"
          : "other"

    entries.push({
      path: rel,
      name: basename(path),
      type,
      size: info.size,
      mtime: info.mtime.toISOString(),
    })

    if (depth >= options.maxDepth || type !== "directory") return

    const children = await readdir(path, { withFileTypes: true })
    children.sort((a, b) => a.name.localeCompare(b.name))

    for (const child of children) {
      const childRel = rel === "." ? child.name : rel + "/" + child.name
      if (!options.includeHidden && hiddenRelative(childRel)) continue
      await visit(resolve(path, child.name), depth + 1)
    }
  }

  await visit(start, 0)
  return { entries, scanned }
}

export async function findPaths(root: string, options: FindOptions = {}) {
  const { projectRoot, target } = await resolveInside(root, options.path)
  const maxDepth = clampInteger(options.maxDepth, 4, 0, MAX_DEPTH)
  const minDepth = clampInteger(options.minDepth, 0, 0, maxDepth)
  const limit = clampInteger(options.limit, 100, 1, MAX_RESULTS)
  const nameMatcher = options.name ? globRegex(options.name) : undefined

  const { entries, scanned } = await collectEntries(projectRoot, target, {
    maxDepth,
    includeHidden: options.includeHidden === true,
  })

  const startRel = displayPath(projectRoot, target)
  const baseDepth = startRel === "." ? 0 : startRel.split("/").length

  let matches = entries.filter((entry) => {
    const depth = entry.path === startRel ? 0 : Math.max(0, entry.path.split("/").length - baseDepth)
    if (depth < minDepth) return false
    if (options.type && entry.type !== options.type) return false
    if (nameMatcher && !nameMatcher.test(entry.name)) return false
    return true
  })

  const sort = options.sort ?? "path"
  const order = options.order === "desc" ? -1 : 1
  matches.sort((a, b) => {
    const av = sort === "name" ? a.name : sort === "size" ? a.size : sort === "mtime" ? a.mtime : a.path
    const bv = sort === "name" ? b.name : sort === "size" ? b.size : sort === "mtime" ? b.mtime : b.path
    return compareValues(av, bv) * order
  })

  return {
    path: displayPath(projectRoot, target),
    scanned,
    matched: matches.length,
    truncated: matches.length > limit,
    entries: matches.slice(0, limit),
  }
}

function boundedRegex(pattern: string, caseSensitive: boolean) {
  if (pattern.length === 0) throw new Error("Search pattern must not be empty.")
  if (pattern.length > MAX_PATTERN_LENGTH) throw new Error("Search pattern is too long.")
  return new RegExp(pattern, caseSensitive ? "" : "i")
}

function lineMatches(line: string, pattern: string, regex: RegExp | undefined, caseSensitive: boolean) {
  const candidate = line.slice(0, MAX_LINE_LENGTH)
  if (regex) return regex.test(candidate)
  if (caseSensitive) return candidate.includes(pattern)
  return candidate.toLowerCase().includes(pattern.toLowerCase())
}

export async function grepText(root: string, options: GrepOptions) {
  if (!options.pattern) throw new Error("Search pattern must not be empty.")
  if (options.pattern.length > MAX_PATTERN_LENGTH) throw new Error("Search pattern is too long.")

  const { projectRoot, target } = await resolveInside(root, options.path)
  const maxDepth = clampInteger(options.maxDepth, 8, 0, MAX_DEPTH)
  const context = clampInteger(options.context, 0, 0, 5)
  const limit = clampInteger(options.limit, 100, 1, MAX_RESULTS)
  const caseSensitive = options.caseSensitive === true
  const matcher = options.regex ? boundedRegex(options.pattern, caseSensitive) : undefined
  const glob = options.glob ? globRegex(options.glob) : undefined

  const { entries, scanned } = await collectEntries(projectRoot, target, {
    maxDepth,
    includeHidden: options.includeHidden === true,
  })

  const files = entries.filter((entry) => {
    if (entry.type !== "file") return false
    if (!glob) return true
    return glob.test(entry.path) || glob.test(entry.name)
  })

  const matches: Array<{
    path: string
    line: number
    text: string
    before?: string[]
    after?: string[]
  }> = []
  let bytesRead = 0
  let skippedLarge = 0
  let skippedBinary = 0
  let budgetExhausted = false

  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) {
      skippedLarge += 1
      continue
    }
    if (bytesRead + file.size > MAX_TOTAL_SEARCH_BYTES) {
      budgetExhausted = true
      break
    }

    const absolute = resolve(projectRoot, file.path)
    const actual = await realpath(absolute)
    if (!inside(projectRoot, actual)) continue

    const buffer = await readFile(actual)
    bytesRead += buffer.byteLength
    if (buffer.includes(0)) {
      skippedBinary += 1
      continue
    }

    const lines = buffer.toString("utf8").split(/\r?\n/)
    for (let index = 0; index < lines.length; index += 1) {
      if (!lineMatches(lines[index], options.pattern, matcher, caseSensitive)) continue
      matches.push({
        path: file.path,
        line: index + 1,
        text: lines[index].slice(0, 2000),
        ...(context > 0 ? { before: lines.slice(Math.max(0, index - context), index).map((line) => line.slice(0, 2000)) } : {}),
        ...(context > 0 ? { after: lines.slice(index + 1, index + 1 + context).map((line) => line.slice(0, 2000)) } : {}),
      })
    }
  }

  const sort = options.sort ?? "path"
  const order = options.order === "desc" ? -1 : 1
  matches.sort((a, b) => {
    const primary = sort === "line" ? a.line - b.line : a.path.localeCompare(b.path)
    if (primary !== 0) return primary * order
    return (a.line - b.line) * order
  })

  return {
    path: displayPath(projectRoot, target),
    scanned,
    files: files.length,
    bytesRead,
    skippedLarge,
    skippedBinary,
    matched: matches.length,
    truncated: matches.length > limit || budgetExhausted,
    matches: matches.slice(0, limit),
  }
}

function splitFields(line: string, delimiter: string | undefined) {
  if (!delimiter || delimiter === "whitespace") return line.trim().split(/\s+/)
  if (delimiter === "tab") return line.split("\t")
  if (delimiter === "comma") return line.split(",")
  if (delimiter.length > 8) throw new Error("Custom delimiter must be at most 8 characters.")
  return line.split(delimiter)
}

function requireField(fields: string[], field: number) {
  if (!Number.isInteger(field) || field < 1 || field > 256) {
    throw new Error("Field indexes are 1-based integers from 1 to 256.")
  }
  return fields[field - 1] ?? ""
}

function passesWhere(fields: string[], where: NonNullable<SelectOptions["where"]>) {
  const actual = requireField(fields, where.field)
  switch (where.op) {
    case "eq": return actual === where.value
    case "neq": return actual !== where.value
    case "contains": return actual.includes(where.value)
    case "startsWith": return actual.startsWith(where.value)
    case "endsWith": return actual.endsWith(where.value)
    case "gt": return Number(actual) > Number(where.value)
    case "gte": return Number(actual) >= Number(where.value)
    case "lt": return Number(actual) < Number(where.value)
    case "lte": return Number(actual) <= Number(where.value)
  }
}

export async function selectText(root: string, options: SelectOptions) {
  const { projectRoot, target } = await resolveInside(root, options.path)
  const info = await lstat(target)
  if (!info.isFile()) throw new Error("text_select requires a file.")
  if (info.size > MAX_FILE_BYTES) throw new Error("File is too large for text_select.")

  const buffer = await readFile(target)
  if (buffer.includes(0)) throw new Error("text_select does not read binary files.")

  const limit = clampInteger(options.limit, 100, 1, MAX_RESULTS)
  const skipBlank = options.skipBlank !== false
  const rows = buffer
    .toString("utf8")
    .split(/\r?\n/)
    .map((text, index) => ({ line: index + 1, text, fields: splitFields(text, options.delimiter) }))
    .filter((row) => !skipBlank || row.text.trim().length > 0)
    .filter((row) => !options.where || passesWhere(row.fields, options.where))

  if (options.sort) {
    const { field, numeric, order = "asc" } = options.sort
    rows.sort((a, b) => {
      const av = requireField(a.fields, field)
      const bv = requireField(b.fields, field)
      const compared = numeric ? Number(av) - Number(bv) : av.localeCompare(bv)
      return compared * (order === "desc" ? -1 : 1)
    })
  }

  const projected = rows.map((row) => {
    const fields = options.fields?.length
      ? options.fields.map((field) => requireField(row.fields, field))
      : row.fields
    return { line: row.line, fields }
  })

  const unique = options.unique
    ? [...new Map(projected.map((row) => [JSON.stringify(row.fields), row])).values()]
    : projected

  const selected = options.from === "end" ? unique.slice(-limit) : unique.slice(0, limit)

  return {
    path: displayPath(projectRoot, target),
    matched: unique.length,
    truncated: unique.length > limit,
    rows: selected,
  }
}

export async function statPaths(root: string, options: StatsOptions) {
  if (!Array.isArray(options.paths) || options.paths.length === 0) {
    throw new Error("At least one path is required.")
  }
  if (options.paths.length > 100) throw new Error("At most 100 paths may be inspected at once.")

  const projectRoot = await realpath(root)
  const entries = []
  let totalBytes = 0
  let totalLines = 0

  for (const raw of options.paths) {
    const { target } = await resolveInside(projectRoot, raw)
    const info = await lstat(target)
    const type = info.isFile() ? "file" : info.isDirectory() ? "directory" : info.isSymbolicLink() ? "symlink" : "other"
    let lines: number | undefined

    if (options.lineCount && info.isFile() && info.size <= MAX_FILE_BYTES) {
      const buffer = await readFile(target)
      if (!buffer.includes(0)) {
        const text = buffer.toString("utf8")
        lines = text.length === 0 ? 0 : text.split(/\r?\n/).length
        totalLines += lines
      }
    }

    totalBytes += info.size
    entries.push({
      path: displayPath(projectRoot, target),
      type,
      size: info.size,
      mtime: info.mtime.toISOString(),
      ...(lines === undefined ? {} : { lines }),
    })
  }

  return {
    count: entries.length,
    totalBytes,
    ...(options.lineCount ? { totalLines } : {}),
    entries,
  }
}
