import { validateWriteScope } from "./scope"

export const MAX_TASKS = 24

export type TaskSpec = {
  id: string
  title: string
  objective: string
  dependsOn: string[]
  write: string[]
  skills: string[]
  verify: string[]
}

function normalizeTask(input: TaskSpec): TaskSpec {
  const id = input.id.trim()
  const title = input.title.trim()
  const objective = input.objective.trim()
  const dependsOn = [...new Set(input.dependsOn.map((item) => item.trim()).filter(Boolean))]
  const write = [...new Set(input.write.map((item) => item.trim()).filter(Boolean))]
  const skills = [...new Set(input.skills.map((item) => item.trim()).filter(Boolean))]
  const verify = [...new Set(input.verify.map((item) => item.trim()).filter(Boolean))]

  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    throw new Error(`Invalid task id ${input.id}; use lowercase letters, numbers, and hyphens.`)
  }
  if (!title || !objective) throw new Error(`Task ${id} requires title and objective.`)
  if (verify.length === 0) throw new Error(`Task ${id} requires at least one verification expectation.`)
  validateWriteScope(write)

  return { id, title, objective, dependsOn, write, skills, verify }
}

function transitiveDependencies(tasks: TaskSpec[]) {
  const byID = new Map(tasks.map((task) => [task.id, task]))
  const memo = new Map<string, Set<string>>()

  const visit = (id: string, stack: string[]): Set<string> => {
    if (memo.has(id)) return memo.get(id)!
    if (stack.includes(id)) {
      throw new Error(`Task dependency cycle: ${[...stack, id].join(" -> ")}`)
    }

    const task = byID.get(id)
    if (!task) throw new Error(`Unknown task dependency: ${id}`)

    const deps = new Set<string>()
    for (const dep of task.dependsOn) {
      if (!byID.has(dep)) throw new Error(`Task ${id} depends on unknown task ${dep}.`)
      if (dep === id) throw new Error(`Task ${id} cannot depend on itself.`)
      deps.add(dep)
      for (const nested of visit(dep, [...stack, id])) deps.add(nested)
    }
    memo.set(id, deps)
    return deps
  }

  for (const task of tasks) visit(task.id, [])
  return memo
}

function literalPrefix(pattern: string) {
  const normalized = pattern.replaceAll("\\", "/").replace(/^\.\//, "")
  const wildcard = normalized.search(/[?*[{]/)
  const prefix = (wildcard >= 0 ? normalized.slice(0, wildcard) : normalized)
    .replace(/\/+$/, "")
  return prefix
}

function nested(a: string, b: string) {
  return a === b || a.startsWith(b + "/") || b.startsWith(a + "/")
}

export function writeScopesMayOverlap(left: string[], right: string[]) {
  return left.some((a) =>
    right.some((b) => {
      const ap = literalPrefix(a)
      const bp = literalPrefix(b)
      return Boolean(ap && bp && nested(ap, bp))
    }),
  )
}

export function validateTaskPlan(inputs: TaskSpec[]) {
  if (inputs.length === 0) throw new Error("Task plan must contain at least one task.")
  if (inputs.length > MAX_TASKS) throw new Error(`Task plan exceeds V1 maximum of ${MAX_TASKS} tasks.`)

  const tasks = inputs.map(normalizeTask)
  const ids = tasks.map((task) => task.id)
  if (new Set(ids).size !== ids.length) throw new Error("Task ids must be unique.")

  const dependencies = transitiveDependencies(tasks)

  for (let i = 0; i < tasks.length; i++) {
    for (let j = i + 1; j < tasks.length; j++) {
      const a = tasks[i]
      const b = tasks[j]
      if (!writeScopesMayOverlap(a.write, b.write)) continue

      const ordered =
        dependencies.get(a.id)!.has(b.id) ||
        dependencies.get(b.id)!.has(a.id)

      if (!ordered) {
        throw new Error(
          `Tasks ${a.id} and ${b.id} have overlapping write scopes but no dependency ordering.`,
        )
      }
    }
  }

  return tasks
}

export function taskStepId(taskId: string) {
  return `task:${taskId}`
}
