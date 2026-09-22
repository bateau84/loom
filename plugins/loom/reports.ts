import { YAML } from "bun"
import { createHash } from "node:crypto"
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises"
import { dirname, extname, isAbsolute, relative, resolve } from "node:path"

export const EPHEMERAL_REPORT_ROOT = "ephemeral-reports"
export const DURABLE_REPORT_ROOT = "docs/reports"

const MAX_REPORT_BYTES = 2 * 1024 * 1024
export type ReportPromotionInput = {
  source: string
  destination: string
  reason: string
}

export type ReportPromotionRecord = {
  id: string
  status: "pending" | "completed" | "failed"
  source: string
  destination: string
  reason: string
  actor: string
  startedAt: string
  promotedAt?: string
  failedAt?: string
  sha256?: string
  bytes?: number
  authority: "unchanged"
  error?: string
}

function normalizeProjectPath(raw: string, label: string) {
  const value = raw.trim().replaceAll("\\", "/").replace(/^\.\//, "")
  if (!value || isAbsolute(value) || value.split("/").includes("..")) {
    throw new Error(`${label} must be a project-relative path without '..'.`)
  }
  return value
}

function pathInside(root: string, path: string) {
  const value = relative(root, path)
  return value === "" || (!value.startsWith("..") && !isAbsolute(value))
}

function pathUnder(path: string, root: string) {
  return path === root || path.startsWith(root + "/")
}

function reportFrontmatter(text: string) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!match) {
    throw new Error("Ephemeral report must start with OKF YAML frontmatter.")
  }

  let parsed: unknown
  try {
    parsed = YAML.parse(match[1])
  } catch {
    throw new Error("Ephemeral report frontmatter must be valid YAML.")
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Ephemeral report frontmatter must be a YAML mapping.")
  }

  const frontmatter = parsed as Record<string, unknown>
  const type = typeof frontmatter.type === "string" ? frontmatter.type.trim() : ""
  const title = typeof frontmatter.title === "string" ? frontmatter.title.trim() : ""
  const description =
    typeof frontmatter.description === "string" ? frontmatter.description.trim() : ""
  const tags = frontmatter.tags

  if (!/^report(?:\s|$)/.test(type)) {
    throw new Error("Ephemeral report OKF type must be 'report' or start with 'report '.")
  }
  if (!title) throw new Error("Ephemeral report requires a non-empty OKF title.")
  if (!description) throw new Error("Ephemeral report requires a non-empty OKF description.")
  if (
    !Array.isArray(tags) ||
    tags.length === 0 ||
    tags.some((tag) => typeof tag !== "string" || tag.trim().length === 0)
  ) {
    throw new Error("Ephemeral report OKF tags must be a non-empty string array.")
  }
}

async function existingDirectory(root: string, relativePath: string, label: string) {
  const path = resolve(root, relativePath)
  const info = await lstat(path)
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error(`${label} must be a real directory, not a symlink.`)
  }
  const actual = await realpath(path)
  if (!pathInside(root, actual)) {
    throw new Error(`${label} resolves outside the project.`)
  }
  return actual
}

async function ensureSafeDirectory(root: string, relativePath: string) {
  let current = root
  for (const part of relativePath.split("/").filter(Boolean)) {
    const next = resolve(current, part)
    try {
      const info = await lstat(next)
      if (info.isSymbolicLink() || !info.isDirectory()) {
        throw new Error("Report destination directory may not contain symlinks.")
      }
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error
      await mkdir(next)
    }
    current = await realpath(next)
    if (!pathInside(root, current)) {
      throw new Error("Report destination resolves outside the project.")
    }
  }
  return current
}

export async function promoteReport(projectDirectory: string, input: ReportPromotionInput) {
  const projectRoot = await realpath(projectDirectory)
  const source = normalizeProjectPath(input.source, "Report source")
  const destination = normalizeProjectPath(input.destination, "Report destination")
  const reason = input.reason.trim()

  if (!reason) throw new Error("Promotion reason is required.")
  if (!pathUnder(source, EPHEMERAL_REPORT_ROOT)) {
    throw new Error(`Report source must be under ${EPHEMERAL_REPORT_ROOT}/.`)
  }
  if (!pathUnder(destination, DURABLE_REPORT_ROOT)) {
    throw new Error(`Report destination must be under ${DURABLE_REPORT_ROOT}/.`)
  }
  if (extname(source).toLowerCase() !== ".md" || extname(destination).toLowerCase() !== ".md") {
    throw new Error("Only Markdown reports may be promoted.")
  }

  const ephemeralRoot = await existingDirectory(projectRoot, EPHEMERAL_REPORT_ROOT, "Ephemeral report root")
  const sourceLexical = resolve(projectRoot, source)
  const sourceLexicalInfo = await lstat(sourceLexical)
  if (sourceLexicalInfo.isSymbolicLink() || !sourceLexicalInfo.isFile()) {
    throw new Error("Report source must be a regular file, not a symlink.")
  }

  const sourceActual = await realpath(sourceLexical)
  if (!pathInside(ephemeralRoot, sourceActual)) {
    throw new Error("Report source resolves outside the ephemeral report root.")
  }
  if (sourceLexicalInfo.size > MAX_REPORT_BYTES) {
    throw new Error("Report is too large to promote.")
  }

  const bytes = await readFile(sourceActual)
  if (bytes.includes(0)) throw new Error("Report must be text Markdown.")
  reportFrontmatter(bytes.toString("utf8"))

  await ensureSafeDirectory(projectRoot, DURABLE_REPORT_ROOT)
  const destinationRelative = destination.slice(DURABLE_REPORT_ROOT.length).replace(/^\//, "")
  const destinationParentRelative = dirname(destinationRelative) === "." ? "" : dirname(destinationRelative)
  const durableRoot = await existingDirectory(projectRoot, DURABLE_REPORT_ROOT, "Durable report root")
  const destinationParent = destinationParentRelative
    ? await ensureSafeDirectory(durableRoot, destinationParentRelative)
    : durableRoot
  const destinationPath = resolve(destinationParent, destination.split("/").at(-1)!)

  if (!pathInside(durableRoot, destinationPath)) {
    throw new Error("Report destination resolves outside the durable report root.")
  }

  try {
    await writeFile(destinationPath, bytes, { flag: "wx" })
  } catch (error: any) {
    if (error?.code === "EEXIST") {
      throw new Error("Report destination already exists; promotion never overwrites durable reports.")
    }
    throw error
  }

  return {
    promoted: true,
    source,
    destination,
    sourceRetained: true,
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    reason,
    authority: "unchanged",
  }
}
