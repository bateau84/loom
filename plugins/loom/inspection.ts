import { lstat, open, opendir, realpath } from "node:fs/promises"
import { basename, isAbsolute, relative, resolve, sep } from "node:path"

const MAX_DEPTH = 12
const MAX_RESULTS = 500
const MAX_SCANNED_ENTRIES = 20_000
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_TOTAL_SEARCH_BYTES = 8 * 1024 * 1024
const MAX_PATTERN_LENGTH = 256
const MAX_SELECT_ROWS = 20_000
const MAX_FIELDS = 256
const MAX_FIELD_CHARS = 16_384
const MAX_OUTPUT_TEXT_CHARS = 2_000

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

type SelectRow = {
  line: number
  fields: string[]
  sortValue?: string
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

async function readBounded(path: string, maxBytes: number) {
  const handle = await open(path, "r")
  const buffer = Buffer.allocUnsafe(maxBytes + 1)
  let offset = 0

  try {
    while (offset < buffer.byteLength) {
      const result = await handle.read(buffer, offset, buffer.byteLength - offset, offset)
      if (result.bytesRead === 0) break
      offset += result.bytesRead
    }
  } finally {
    await handle.close()
  }

  if (offset > maxBytes) return undefined
  return buffer.subarray(0, offset)
}

async function collectEntries(
  root: string,
  start: string,
  options: { maxDepth: number; includeHidden: boolean },
) {
  const entries: Entry[] = []
  let scanned = 0

  const account = () => {
    scanned += 1
    if (scanned > MAX_SCANNED_ENTRIES) {
      throw new Error("Inspection scanned too many entries; narrow the path or depth.")
    }
  }

  const visit = async (path: string, depth: number, accounted = false): Promise<void> => {
    if (!accounted) account()

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

    const directory = await opendir(path)
    for await (const child of directory) {
      account()
      const childRel = rel === "." ? child.name : rel + "/" + child.name
      if (!options.includeHidden && hiddenRelative(childRel)) continue
      await visit(resolve(path, child.name), depth + 1, true)
    }
  }

  await visit(start, 0)
  return { entries, scanned }
}

function* logicalLines(text: string): Generator<{ line: number; text: string }> {
  let start = 0
  let number = 1

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "\n") continue
    const end = index > start && text[index - 1] === "\r" ? index - 1 : index
    yield { line: number, text: text.slice(start, end) }
    start = index + 1
    number += 1
  }

  if (start < text.length) {
    const end = text.endsWith("\r") ? text.length - 1 : text.length
    yield { line: number, text: text.slice(start, end) }
  }
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
  if (caseSensitive) return line.includes(pattern)
  return line.toLowerCase().includes(pattern.toLowerCase())
}

function compareTextMatches(sort: "path" | "line", order: "asc" | "desc") {
  const direction = order === "desc" ? -1 : 1

  return (a: TextMatch, b: TextMatch) => {
    const primary = sort === "line" ? a.line - b.line : a.path.localeCompare(b.path)
    if (primary !== 0) return primary * direction

    const secondary = sort === "line" ? a.path.localeCompare(b.path) : a.line - b.line
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

    const buffer = await readBounded(actual, MAX_FILE_BYTES)
    if (!buffer) {
      skippedLarge += 1
      continue
    }

    bytesRead += buffer.byteLength
    if (bytesRead > MAX_TOTAL_SEARCH_BYTES) {
      budgetExhausted = true
      break
    }
    if (buffer.includes(0)) {
      skippedBinary += 1
      continue
    }

    const before: string[] = []
    const pending: Array<{ match: TextMatch; remaining: number }> = []

    for (const current of logicalLines(buffer.toString("utf8"))) {
      const clipped = current.text.slice(0, MAX_OUTPUT_TEXT_CHARS)

      for (let index = pending.length - 1; index >= 0; index -= 1) {
        const item = pending[index]
        item.match.after!.push(clipped)
        item.remaining -= 1
        if (item.remaining === 0) {
          retained.add(item.match)
          pending.splice(index, 1)
        }
      }

      if (literalLineMatches(current.text, options.pattern, caseSensitive)) {
        matched += 1
        const match: TextMatch = {
          path: file.path,
          line: current.line,
          text: clipped,
          ...(context > 0 ? { before: [...before], after: [] } : {}),
        }

        if (context === 0) retained.add(match)
        else pending.push({ match, remaining: context })
      }

      if (context > 0) {
        before.push(clipped)
        if (before.length > context) before.shift()
      }
    }

    for (const item of pending) retained.add(item.match)
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

function isWhitespace(character: string) {
  return /\s/u.test(character)
}

function checkedField(value: string) {
  if (value.length > MAX_FIELD_CHARS) {
    throw new Error("text_select field is too large; narrow the input or choose another delimiter.")
  }
  return value
}

function splitWhitespaceFields(line: string) {
  const fields: string[] = []
  let index = 0

  while (index < line.length) {
    while (index < line.length && isWhitespace(line[index])) index += 1
    if (index >= line.length) break

    const start = index
    while (index < line.length && !isWhitespace(line[index])) index += 1

    if (fields.length >= MAX_FIELDS) {
      throw new Error("text_select row has too many fields.")
    }
    fields.push(checkedField(line.slice(start, index)))
  }

  return fields
}

function splitLiteralFields(line: string, delimiter: string) {
  if (delimiter.length === 0) throw new Error("Custom delimiter must not be empty.")
  if (delimiter.length > 8) throw new Error("Custom delimiter must be at most 8 characters.")

  const fields: string[] = []
  let start = 0

  while (true) {
    if (fields.length >= MAX_FIELDS) {
      throw new Error("text_select row has too many fields.")
    }

    const index = line.indexOf(delimiter, start)
    if (index < 0) {
      fields.push(checkedField(line.slice(start)))
      break
    }

    fields.push(checkedField(line.slice(start, index)))
    start = index + delimiter.length
  }

  return fields
}

function splitFields(line: string, delimiter: string | undefined) {
  if (!delimiter || delimiter === "whitespace") {
    if (delimiter === "") throw new Error("Custom delimiter must not be empty.")
    return splitWhitespaceFields(line)
  }
  if (delimiter === "tab") return splitLiteralFields(line, "\t")
  if (delimiter === "comma") return splitLiteralFields(line, ",")
  return splitLiteralFields(line, delimiter)
}

function requireField(fields: string[], field: number) {
  if (!Number.isInteger(field) || field < 1 || field > MAX_FIELDS) {
    throw new Error("Field indexes are 1-based integers from 1 to " + MAX_FIELDS + ".")
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

function compareSelectRows(options: SelectOptions) {
  if (!options.sort) {
    const direction = options.from === "end" ? -1 : 1
    return (a: SelectRow, b: SelectRow) => (a.line - b.line) * direction
  }

  const direction = options.sort.order === "desc" ? -1 : 1
  return (a: SelectRow, b: SelectRow) => {
    const left = a.sortValue ?? ""
    const right = b.sortValue ?? ""

    let primary: number
    if (options.sort?.numeric) {
      const leftNumber = Number(left)
      const rightNumber = Number(right)
      primary =
        Number.isFinite(leftNumber) && Number.isFinite(rightNumber)
          ? leftNumber - rightNumber
          : left.localeCompare(right)
    } else {
      primary = left.localeCompare(right)
    }

    if (primary !== 0) return primary * direction
    return (a.line - b.line) * direction
  }
}

export async function selectText(root: string, options: SelectOptions) {
  const { projectRoot, target } = await resolveInside(root, options.path)
  const info = await lstat(target)
  if (!info.isFile()) throw new Error("text_select requires a file.")
  if (info.size > MAX_FILE_BYTES) throw new Error("File is too large for text_select.")
  if (options.delimiter === "") throw new Error("Custom delimiter must not be empty.")
  if (options.delimiter && options.delimiter.length > 8 && options.delimiter !== "whitespace") {
    throw new Error("Custom delimiter must be at most 8 characters.")
  }

  const buffer = await readBounded(target, MAX_FILE_BYTES)
  if (!buffer) throw new Error("File is too large for text_select.")
  if (buffer.includes(0)) throw new Error("text_select does not read binary files.")

  const limit = clampInteger(options.limit, 100, 1, MAX_RESULTS)
  const skipBlank = options.skipBlank !== false
  const compare = compareSelectRows(options)
  const retained = new BoundedBest<SelectRow>(limit, compare)
  const uniqueRows = options.unique ? new Map<string, SelectRow>() : undefined

  let processedRows = 0
  let qualifyingRows = 0

  for (const current of logicalLines(buffer.toString("utf8"))) {
    processedRows += 1
    if (processedRows > MAX_SELECT_ROWS) {
      throw new Error("text_select input has too many rows; narrow the input.")
    }
    if (skipBlank && current.text.trim().length === 0) continue

    const fields = splitFields(current.text, options.delimiter)
    if (options.where && !passesWhere(fields, options.where)) continue

    const projected = options.fields?.length
      ? options.fields.map((field) => checkedField(requireField(fields, field)))
      : fields
    const row: SelectRow = {
      line: current.line,
      fields: projected,
      ...(options.sort ? { sortValue: requireField(fields, options.sort.field) } : {}),
    }

    if (uniqueRows) {
      const key = JSON.stringify(row.fields)
      const previous = uniqueRows.get(key)
      if (!previous || compare(row, previous) < 0) uniqueRows.set(key, row)
      continue
    }

    qualifyingRows += 1
    retained.add(row)
  }

  if (uniqueRows) {
    qualifyingRows = uniqueRows.size
    for (const row of uniqueRows.values()) retained.add(row)
  }

  return {
    path: displayPath(projectRoot, target),
    matched: qualifyingRows,
    truncated: qualifyingRows > limit,
    rows: retained.values().map(({ line, fields }) => ({ line, fields })),
  }
}

function countLogicalLines(text: string) {
  let count = 0
  for (const _line of logicalLines(text)) count += 1
  return count
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
      const buffer = await readBounded(target, MAX_FILE_BYTES)
      if (buffer && !buffer.includes(0)) {
        lines = countLogicalLines(buffer.toString("utf8"))
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
