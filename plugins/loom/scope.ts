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

const forbiddenAuthorityRoots = [
  "docs/anchors/",
  "docs/design/",
  "docs/requirements/",
  "docs/architecture/",
]

function normalize(value: string) {
  return value.replaceAll("\\", "/").replace(/^\.\//, "")
}

function validateBoundedWriteScope(paths: string[], label: string) {
  if (paths.length === 0) throw new Error(`${label} must not be empty.`)

  for (const raw of paths) {
    const path = normalize(raw)

    if (!path || path === "*" || path === "**" || path === "**/*") {
      throw new Error(`${label} must be bounded; repository-wide wildcards are not allowed.`)
    }
    if (path.startsWith("/") || path.includes("../")) {
      throw new Error(`${label} must be project-relative: ${raw}`)
    }
  }

  return paths
}

function patternWithinCeiling(pattern: string, ceiling: string) {
  const normalizedPattern = normalize(pattern)
  const normalizedCeiling = normalize(ceiling)

  if (normalizedCeiling.endsWith("/**")) {
    const root = normalizedCeiling.slice(0, -3)
    return normalizedPattern === root || normalizedPattern.startsWith(root + "/")
  }

  return normalizedPattern === normalizedCeiling
}

export function validateStepWriteScope(
  paths: string[],
  roleCeiling: readonly string[],
  label = "Step write scope",
) {
  validateBoundedWriteScope(paths, label)
  if (roleCeiling.length === 0) {
    throw new Error(`${label} has no role-owned artifact surface.`)
  }

  for (const raw of paths) {
    if (!roleCeiling.some((ceiling) => patternWithinCeiling(raw, ceiling))) {
      throw new Error(
        `${label} may narrow role authority but cannot grant ${raw}; allowed roots: ${roleCeiling.join(", ")}`,
      )
    }
  }

  return paths
}

/**
 * Validate a normal in-project runtime scope elevation. Unlike the historical
 * specialist ceiling check, this deliberately does not decide role authority:
 * the attached step may widen its own project-local mutation surface and Loom
 * records that elevation for review. Hard-boundary paths are handled before
 * this helper is called.
 */
export function validateScopeElevation(paths: string[]) {
  return validateBoundedWriteScope(paths, "Scope elevation")
}

export function mergeWriteScope(current: readonly string[], additions: readonly string[]) {
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
  validateBoundedWriteScope(paths, "Worker write scope")

  for (const raw of paths) {
    const path = normalize(raw)
    if (forbiddenAuthorityRoots.some((root) => path.startsWith(root))) {
      throw new Error("Worker may not receive write authority for " + path)
    }
  }

  return paths
}

function globRegex(pattern: string) {
  const escaped = normalize(pattern)
    .replace(/[.*+?^$()|[\]\\{}]/g, "\\$&")
    .replaceAll("\\*\\*", ".*")
    .replaceAll("\\*", ".*")
    .replaceAll("\\?", ".")

  return new RegExp("^(?:.*/)?" + escaped + "$")
}

export function resourceMatchesScope(resource: string, pattern: string) {
  return globRegex(pattern).test(normalize(resource))
}

export function resourcesWithinScope(resources: readonly string[], patterns: string[]) {
  return resources.every((resource) => patterns.some((pattern) => resourceMatchesScope(resource, pattern)))
}
