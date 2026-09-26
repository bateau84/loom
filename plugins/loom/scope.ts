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
  return validateBoundedWriteScope(paths, "Worker starting write scope")
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
