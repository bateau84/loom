export type TaskScope = {
  workflowId: string
  stepId: string
  write: string[]
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

export function validateWriteScope(paths: string[]) {
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
