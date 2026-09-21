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

type TextMatch = {
  path: string
  line: number
  text: string
  before?: string[]
  after?: string[]
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

function validateGlob(pattern: string) {
  if (pattern.length === 0) throw new Error("Glob must not be empty.")
  if (pattern.length > MAX_PATTERN_LENGTH) throw new Error("Glob is too long.")
}

function globMatch(pattern: string, value: string) {
  validateGlob(pattern)

  let previous = new Uint8Array(value.length + 1)
  previous[0] = 1

  for (const token of pattern) {
    const current = new Uint8Array(value.length + 1)

    if (token === "*") {
      current[0] = previous[0]
      for (let index = 1; index <= value.length; index += 1) {
        current[index] = previous[index] || current[index - 1] ? 1 : 0
      }
    } else {
      for (let index = 1; index <= value.length; index += 1) {
        const matches = token === "?" || token === value[index - 1]
        current[index] = previous[index - 1] && matches ? 1 : 0
      }
    }

    previous = current
  }

  return previous[value.length] === 1
}

function compareValues(a: string | number, b: string | number) {
  if (typeof a === "number" && typeof b === "number") return a - b
  return String(a).localeCompare(String(b))
}

class BoundedBest<T> {
  private readonly items: T[] = []

  constructor(
    private readonly limit: number,
    private readonly compare: (a: T, b: T) => number,
  ) {}

  get size() {
    return this.items.length
  }

  add(item: T) {
    if (this.items.length < this.limit) {
      this.items.push(item)
      this.siftUp(this.items.length - 1)
      return
    }

    if (this.compare(item, this.items[0]) >= 0) return

    this.items[0] = item
    this.siftDown(0)
  }

  values() {
    return [...this.items].sort(this.compare)
  }

  private worse(a: T, b: T) {
    return this.compare(a, b) > 0
  }

  private siftUp(index: number) {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2)
      if (!this.worse(this.items[index], this.items[parent])) return
      ;[this.items[index], this.items[parent]] = [this.items[parent], this.items[index]]
      index = parent
    }
  }

  private siftDown(index: number) {
    while (true) {
      const left = index * 2 + 1
      const right = left + 1
      let worst = index

      if (left < this.items.length && this.worse(this.items[left], this.items[worst])) {
        worst = left
      }
      if (right < this.items.length && this.worse(this.items[right], this.items[worst])) {
        worst = right
      }
      if (worst === index) return

      ;[this.items[index], this.items[worst]] = [this.items[worst], this.items[index]]
      index = worst
    }
  }
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
  if (options.name) validateGlob(options.name)

  const { entries, scanned } = await collectEntries(projectRoot, target, {
    maxDepth,
    includeHidden: options.includeHidden === true,
  })

  const startRel = displayPath(projectRoot, target)
  const baseDepth = startRel === "." ? 0 : startRel.split("/").length
  const sort = options.sort ?? "path"
  const order = options.order === "desc" ? -1 : 1

  const compareEntries = (a: Entry, b: Entry) => {
    const av = sort === "name" ? a.name : sort === "size" ? a.size : sort === "mtime" ? a.mtime : a.path
    const bv = sort === "name" ? b.name : sort === "size" ? b.size : sort === "mtime" ? b.mtime : b.path
    const primary = compareValues(av, bv)
    if (primary !== 0) return primary * order
    return a.path.localeCompare(b.path) * order
  }

  const retained = new BoundedBest<Entry>(limit, compareEntries)
  let matched = 0

  for (const entry of entries) {
    const depth = entry.path === startRel ? 0 : Math.max(0, entry.path.split("/").length - baseDepth)
    if (depth < minDepth) continue
    if (options.type && entry.type !== options.type) continue
    if (options.name && !globMatch(options.name, entry.name)) continue

    matched += 1
    retained.add(entry)
  }

  return {
    path: displayPath(projectRoot, target),
    scanned,
    matched,
    truncated: matched > limit,
    entries: retained.values(),
  }
}

function literalLineMatches(line: string, pattern: string, caseSensitive: boolean) {
  const candidate = line.slice(0, MAX_LINE_LENGTH)
  if (caseSensitive) return candidate.includes(pattern)
  return candidate.toLowerCase().includes(pattern.toLowerCase())
}

function compareTextMatches(sort: "path" | "line", order: "asc" | "desc") {
  const direction = order === "desc" ? -1 : 1

  return (a: TextMatch, b: TextMatch) => {
    const primary =
      sort === "line"
        ? a.line - b.line
        : a.path.localeCompare(b.path)

    if (primary !== 0) return primary * direction

    const secondary =
      sort === "line"
        ? a.path.localeCompare(b.path)
        : a.line - b.line

    return secondary * direction
  }
}

export async function grepText(root: string, options: GrepOptions) {
  if (!options.pattern) throw new Error("Search pattern must not be empty.")
  if (options.pattern.length > MAX_PATTERN_LENGTH) throw new Error("Search pattern is too long.")
  if (options.glob) validateGlob(options.glob)

  const { projectRoot, target } = await resolveInside(root, options.path)
  const maxDepth = clampInteger(options.maxDepth, 8, 0, MAX_DEPTH)
  const context = clampInteger(options.context, 0, 0, 5)
  const limit = clampInteger(options.limit, 100, 1, MAX_RESULTS)
  const caseSensitive = options.caseSensitive === true

  const { entries, scanned } = await collectEntries(projectRoot, target, {
    maxDepth,
    includeHidden: options.includeHidden === true,
  })

  const files = entries.filter((entry) => {
    if (entry.type !== "file") return false
    if (!options.glob) return true
    return globMatch(options.glob, entry.path) || globMatch(options.glob, entry.name)
  })

  const compare = compareTextMatches(options.sort ?? "path", options.order ?? "asc")
  const retained = new BoundedBest<TextMatch>(limit, compare)

  let bytesRead = 0
  let skippedLarge = 0
  let skippedBinary = 0
  let matched = 0
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

    if (buffer.byteLength > MAX_FILE_BYTES) {
      skippedLarge += 1
      continue
    }
    if (buffer.includes(0)) {
      skippedBinary += 1
      continue
    }

    const lines = buffer.toString("utf8").split(/\r?\n/)
    for (let index = 0; index < lines.length; index += 1) {
      if (!literalLineMatches(lines[index], options.pattern, caseSensitive)) continue

      matched += 1
      retained.add({
        path: file.path,
        line: index + 1,
        text: lines[index].slice(0, 2000),
        ...(context > 0
          ? {
              before: lines
                .slice(Math.max(0, index - context), index)
                .map((line) => line.slice(0, 2000)),
            }
          : {}),
        ...(context > 0
          ? {
              after: lines
                .slice(index + 1, index + 1 + context)
                .map((line) => line.slice(0, 2000)),
            }
          : {}),
      })
    }
  }

  return {
    path: displayPath(projectRoot, target),
    scanned,
    files: files.length,
    bytesRead,
    skippedLarge,
    skippedBinary,
    matched,
    truncated: matched > limit || budgetExhausted,
    matches: retained.values(),
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
    case "eq":
      return actual === where.value
    case "neq":
      return actual !== where.value
    case "contains":
      return actual.includes(where.value)
    case "startsWith":
      return actual.startsWith(where.value)
    case "endsWith":
      return actual.endsWith(where.value)
    case "gt":
      return Number(actual) > Number(where.value)
    case "gte":
      return Number(actual) >= Number(where.value)
    case "lt":
      return Number(actual) < Number(where.value)
    case "lte":
      return Number(actual) <= Number(where.value)
  }
}

export async function selectText(root: string, options: SelectOptions) {
  const { projectRoot, target } = await resolveInside(root, options.path)
  const info = await lstat(target)
  if (!info.isFile()) throw new Error("text_select requires a file.")
  if (info.size > MAX_FILE_BYTES) throw new Error("File is too large for text_select.")

  const buffer = await readFile(target)
  if (buffer.byteLength > MAX_FILE_BYTES) throw new Error("File is too large for text_select.")
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
    const type = info.isFile()
      ? "file"
      : info.isDirectory()
        ? "directory"
        : info.isSymbolicLink()
          ? "symlink"
          : "other"
    let lines: number | undefined

    if (options.lineCount && info.isFile() && info.size <= MAX_FILE_BYTES) {
      const buffer = await readFile(target)
      if (buffer.byteLength <= MAX_FILE_BYTES && !buffer.includes(0)) {
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
