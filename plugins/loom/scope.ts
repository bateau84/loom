export type TaskScope = {
  workflowId: string
  stepId: string
  write: string[]
}

const forbiddenAuthorityRoots = [
  "docs/anchors/",
  "docs/requirements/",
  "docs/architecture/",
]

export function validateWriteScope(paths: string[]) {
  if (paths.length === 0) throw new Error("Worker write scope must not be empty.")

  for (const raw of paths) {
    const path = raw.replaceAll("\\", "/").replace(/^\.\//, "")

    if (!path || path === "*" || path === "**" || path === "**/*") {
      throw new Error("Worker write scope must be bounded; repository-wide wildcards are not allowed.")
    }
    if (path.startsWith("/") || path.includes("../")) {
      throw new Error(`Worker write scope must be project-relative: ${raw}`)
    }
    if (forbiddenAuthorityRoots.some((root) => path.startsWith(root))) {
      throw new Error(`Worker may not receive write authority for ${path}`)
    }
  }

  return paths
}
