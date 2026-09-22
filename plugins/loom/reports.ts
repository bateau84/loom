import { YAML } from "bun"
import { createHash } from "node:crypto"
import { link, lstat, mkdir, readFile, realpath, unlink, writeFile } from "node:fs/promises"
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
  recovered?: boolean
}

export type PreparedReportPromotion = {
  source: string
  destination: string
  reason: string
  bytes: Buffer
  sha256: string
  destinationPath: string
  temporaryPath: string
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

async function resolveDestination(projectRoot: string, destination: string, create: boolean) {
  if (!pathUnder(destination, DURABLE_REPORT_ROOT)) {
    throw new Error(`Report destination must be under ${DURABLE_REPORT_ROOT}/.`)
  }

  if (create) await ensureSafeDirectory(projectRoot, DURABLE_REPORT_ROOT)

  let durableRoot: string
  try {
    durableRoot = await existingDirectory(projectRoot, DURABLE_REPORT_ROOT, "Durable report root")
  } catch (error: any) {
    if (!create && error?.code === "ENOENT") {
      return {
        durableRoot: resolve(projectRoot, DURABLE_REPORT_ROOT),
        destinationPath: resolve(projectRoot, destination),
      }
    }
    throw error
  }

  const destinationRelative = destination.slice(DURABLE_REPORT_ROOT.length).replace(/^\//, "")
  const destinationParentRelative = dirname(destinationRelative) === "." ? "" : dirname(destinationRelative)
  const destinationParent = destinationParentRelative
    ? create
      ? await ensureSafeDirectory(durableRoot, destinationParentRelative)
      : resolve(durableRoot, destinationParentRelative)
    : durableRoot
  const destinationPath = resolve(destinationParent, destination.split("/").at(-1)!)

  if (!pathInside(durableRoot, destinationPath)) {
    throw new Error("Report destination resolves outside the durable report root.")
  }

  if (!create && destinationParentRelative) {
    try {
      const actualParent = await realpath(destinationParent)
      if (!pathInside(durableRoot, actualParent)) {
        throw new Error("Report destination resolves outside the durable report root.")
      }
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error
    }
  }

  return { durableRoot, destinationPath }
}

async function exists(path: string) {
  try {
    return await lstat(path)
  } catch (error: any) {
    if (error?.code === "ENOENT") return undefined
    throw error
  }
}

function temporaryPathFor(destinationPath: string, promotionId: string) {
  return `${destinationPath}.loom-promote-${promotionId}.tmp`
}

export async function prepareReportPromotion(
  projectDirectory: string,
  input: ReportPromotionInput,
  promotionId: string,
): Promise<PreparedReportPromotion> {
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

  const { destinationPath } = await resolveDestination(projectRoot, destination, true)
  if (await exists(destinationPath)) {
    throw new Error("Report destination already exists; promotion never overwrites durable reports.")
  }

  return {
    source,
    destination,
    reason,
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    destinationPath,
    temporaryPath: temporaryPathFor(destinationPath, promotionId),
  }
}

export async function publishPreparedReport(prepared: PreparedReportPromotion) {
  await writeFile(prepared.temporaryPath, prepared.bytes, { flag: "wx" })

  try {
    await link(prepared.temporaryPath, prepared.destinationPath)
  } catch (error: any) {
    await unlink(prepared.temporaryPath).catch(() => {})
    if (error?.code === "EEXIST") {
      throw new Error("Report destination already exists; promotion never overwrites durable reports.")
    }
    throw error
  }

  await unlink(prepared.temporaryPath).catch(() => {})

  return {
    promoted: true,
    source: prepared.source,
    destination: prepared.destination,
    sourceRetained: true,
    bytes: prepared.bytes.byteLength,
    sha256: prepared.sha256,
    reason: prepared.reason,
    authority: "unchanged" as const,
  }
}

export async function reconcilePendingReportPromotion(
  projectDirectory: string,
  record: ReportPromotionRecord,
) {
  if (record.status !== "pending") return record
  if (!record.sha256 || typeof record.bytes !== "number") {
    return {
      ...record,
      status: "failed" as const,
      failedAt: new Date().toISOString(),
      error: "Pending promotion lacks expected content hash/size and cannot be recovered safely.",
    }
  }

  const projectRoot = await realpath(projectDirectory)
  const destination = normalizeProjectPath(record.destination, "Report destination")
  const { durableRoot, destinationPath } = await resolveDestination(projectRoot, destination, false)
  const temporaryPath = temporaryPathFor(destinationPath, record.id)
  const info = await exists(destinationPath)

  if (!info) {
    await unlink(temporaryPath).catch(() => {})
    return {
      ...record,
      status: "failed" as const,
      failedAt: new Date().toISOString(),
      error: "Interrupted before atomic report publication; safe to retry promotion.",
    }
  }

  if (info.isSymbolicLink() || !info.isFile()) {
    return {
      ...record,
      status: "failed" as const,
      failedAt: new Date().toISOString(),
      error: "Published report path is not a regular file; manual reconciliation required.",
    }
  }

  const actual = await realpath(destinationPath)
  if (!pathInside(durableRoot, actual)) {
    return {
      ...record,
      status: "failed" as const,
      failedAt: new Date().toISOString(),
      error: "Published report resolves outside durable report storage; manual reconciliation required.",
    }
  }

  if (info.size > MAX_REPORT_BYTES) {
    return {
      ...record,
      status: "failed" as const,
      failedAt: new Date().toISOString(),
      error: "Published report size differs from pending audit record; manual reconciliation required.",
    }
  }

  const bytes = await readFile(actual)
  const sha256 = createHash("sha256").update(bytes).digest("hex")
  if (bytes.byteLength !== record.bytes || sha256 !== record.sha256) {
    return {
      ...record,
      status: "failed" as const,
      failedAt: new Date().toISOString(),
      error: "Published report content differs from pending audit record; manual reconciliation required.",
    }
  }

  await unlink(temporaryPath).catch(() => {})
  return {
    ...record,
    status: "completed" as const,
    promotedAt: new Date().toISOString(),
    recovered: true,
    error: undefined,
  }
}
