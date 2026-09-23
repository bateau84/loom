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

export function validateWriteScope(paths: string[]) {
  if (paths.length === 0) throw new Error("Worker write scope must not be empty.")

  for (const raw of paths) {
    const path = normalize(raw)

    if (!path || path === "*" || path === "**" || path === "**/*") {
      throw new Error("Worker write scope must be bounded; repository-wide wildcards are not allowed.")
    }
    if (path.startsWith("/") || path.includes("../")) {
      throw new Error("Worker write scope must be project-relative: " + raw)
    }
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
