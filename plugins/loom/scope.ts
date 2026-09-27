import { isAbsolute } from "node:path"

export type ScopeElevation = {
  id: string
  attempt: number
  byAgent: string
  bySessionId: string
  paths: string[]
  reason: string
  elevatedAt: string
  crossesRoleDefault?: boolean
}

export type TaskScope = {
  workflowId: string
  stepId: string
  write: string[]
  elevations?: ScopeElevation[]
}

function normalize(value: string) {
  return value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "")
}

function validateBoundedWriteScope(paths: string[], label: string) {
  if (paths.length === 0) throw new Error(`${label} must not be empty.`)

  for (const raw of paths) {
    const path = normalize(raw)
    const firstSegment = path.split("/")[0] ?? ""

    if (
      !path ||
      path === "." ||
      path === "*" ||
      path === "**" ||
      path === "**/*" ||
      /[*?\[\]{}]/.test(firstSegment)
    ) {
      throw new Error(
        `${label} must name a bounded project file or folder; repository-wide or wildcard-root scopes are not allowed.`,
      )
    }
    if (
      path.startsWith("/") ||
      path === ".." ||
      path.startsWith("../") ||
      path.split("/").includes("..")
    ) {
      throw new Error(`${label} must be project-relative: ${raw}`)
    }
  }

  return paths
}

/**
 * Validate a normal in-project runtime scope elevation. Role defaults are
 * observability defaults, not authority ceilings. Hard-boundary paths are
 * classified before this helper is called.
 */
export function validateScopeElevation(paths: string[]) {
  return validateBoundedWriteScope(paths, "Scope elevation")
}

export function mergeWriteScope(
  current: readonly string[],
  additions: readonly string[],
) {
  return [...new Set([...current.map(normalize), ...additions.map(normalize)])].sort()
}

export function committableWriteScope(paths: readonly string[]) {
  return paths
    .map(normalize)
    .filter(
      (path) =>
        path !== "ephemeral-reports" &&
        !path.startsWith("ephemeral-reports/"),
    )
}

export function validateWriteScope(paths: string[]) {
  if (paths.length === 0) return paths
  return validateBoundedWriteScope(paths, "Worker starting write scope")
}

function escapedGlob(pattern: string) {
  return normalize(pattern)
    .replace(/[.*+?^$()|[\]\\{}]/g, "\\$&")
    .replaceAll("\\*\\*", ".*")
    .replaceAll("\\*", ".*")
    .replaceAll("\\?", ".")
}

function globRegex(pattern: string, allowAbsolutePrefix = false) {
  return new RegExp(
    (allowAbsolutePrefix ? "^(?:.*/)?" : "^") +
    escapedGlob(pattern) +
    "$",
  )
}

export function resourceMatchesScope(resource: string, pattern: string) {
  const absolute = isAbsolute(resource)
  return globRegex(pattern, absolute).test(normalize(resource))
}

/**
 * Hard-boundary authorizations use canonical absolute paths. Unlike normal
 * project scope matching, they must never suffix-match another absolute path.
 */
export function absoluteResourceMatchesScope(
  resource: string,
  absolutePattern: string,
) {
  const normalizedPattern = normalize(absolutePattern)
  if (!normalizedPattern.startsWith("/")) return false
  return new RegExp("^" + escapedGlob(normalizedPattern) + "$").test(
    normalize(resource),
  )
}

export function resourcesWithinScope(
  resources: readonly string[],
  patterns: string[],
) {
  return resources.every((resource) =>
    patterns.some((pattern) => resourceMatchesScope(resource, pattern)),
  )
}
