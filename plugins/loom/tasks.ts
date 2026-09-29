import { validateWriteScope } from "./scope"

export const MAX_TASKS = 24
export const MAX_TASK_ID_LENGTH = 96
export const MAX_TASK_TEXT_LENGTH = 1_000
export const MAX_TASK_CONTEXT_ITEMS = 16
export const LOOM_AGENT_ROLES = [
  "designer", "specifier", "architect", "reviewer", "critic", "acceptance",
  "planner", "documenter", "worker", "research", "diagnostic",
] as const
export const PLAN_PRODUCER_ROLES = ["worker", "designer", "specifier", "architect", "documenter", "research", "diagnostic"] as const

function boundedText(value: string, label: string) {
  const text = value.trim()
  if (text.length > MAX_TASK_TEXT_LENGTH) {
    throw new Error(`${label} exceeds maximum of ${MAX_TASK_TEXT_LENGTH} characters.`)
  }
  return text
}

function boundedList(values: string[], label: string, max = MAX_TASK_CONTEXT_ITEMS) {
  const normalized = [...new Set(values.map((item) => boundedText(item, label)).filter(Boolean))]
  if (normalized.length > max) throw new Error(`${label} exceeds maximum of ${max} values.`)
  return normalized
}


export type TaskSpec = {
  id: string
  title: string
  /** Bounded contribution this Task owns; never the parent accepted product outcome. */
  objective: string
  /** Why this Task exists in the larger plan and what gap it closes. */
  rationale?: string
  dependsOn: string[]
  /** Accepted authority this Task implements or proves. */
  authorityRefs?: string[]
  /** Inherited semantic/non-goal constraints that Worker must preserve. */
  constraints?: string[]
  /** Falsifiable local completion contract for Worker and Reviewer. */
  acceptanceCriteria?: string[]
  /** Non-executable local checklist; these do not become workflow nodes. */
  subtasks?: string[]
  /** Cross-task/component context that must survive the handoff. */
  integration?: string[]
  write: string[]
  skills: string[]
  verify: string[]
  /** Accountable agent role copied from the persistent semantic Plan. */
  role?: string
  responsibility?: "produce" | "execute" | "review" | "obtain-user-decision"
}

function normalizeTask(input: TaskSpec): TaskSpec {
  const id = input.id.trim()
  const title = boundedText(input.title, `Task ${id} title`)
  const objective = boundedText(input.objective, `Task ${id} objective`)
  const rationale = boundedText(input.rationale ?? "", `Task ${id} rationale`)
  const dependsOn = boundedList(input.dependsOn, `Task ${id} dependencies`)
  const authorityRefs = boundedList(input.authorityRefs ?? [], `Task ${id} authorityRefs`)
  const constraints = boundedList(input.constraints ?? [], `Task ${id} constraints`)
  const acceptanceCriteria = boundedList(input.acceptanceCriteria ?? [], `Task ${id} acceptanceCriteria`)
  const subtasks = boundedList(input.subtasks ?? [], `Task ${id} subtasks`)
  const integration = boundedList(input.integration ?? [], `Task ${id} integration`)
  const write = [...new Set(input.write.map((item) => item.trim()).filter(Boolean))]
  const skills = boundedList(input.skills, `Task ${id} skills`)
  const verify = boundedList(input.verify, `Task ${id} verify`)
  const role = input.role?.trim()
  const responsibility = input.responsibility

  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    throw new Error(`Invalid task id ${input.id}; use lowercase letters, numbers, and hyphens.`)
  }
  if (id.length > MAX_TASK_ID_LENGTH) {
    throw new Error(`Task id exceeds maximum of ${MAX_TASK_ID_LENGTH} characters.`)
  }
  if (!title || !objective) throw new Error(`Task ${id} requires title and objective.`)
  if (role && !/^[a-z][a-z0-9-]*$/.test(role)) throw new Error(`Task ${id} has invalid accountable role.`)
  if (responsibility && !["produce", "execute", "review", "obtain-user-decision"].includes(responsibility)) {
    throw new Error(`Task ${id} has invalid responsibility.`)
  }
  if (!rationale) throw new Error(`Task ${id} requires rationale within the parent Plan.`)
  if (authorityRefs.length === 0) throw new Error(`Task ${id} requires at least one accepted authority reference.`)
  if (acceptanceCriteria.length === 0) throw new Error(`Task ${id} requires at least one falsifiable acceptance criterion.`)
  if (verify.length === 0) throw new Error(`Task ${id} requires at least one verification expectation.`)
  validateWriteScope(write)

  return {
    id,
    title,
    objective,
    rationale,
    dependsOn,
    authorityRefs,
    constraints,
    acceptanceCriteria,
    subtasks,
    integration,
    write,
    skills,
    verify,
    ...(role ? { role } : {}),
    ...(responsibility ? { responsibility } : {}),
  }
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

export function validateTaskPlan(inputs: TaskSpec[]) {
  if (inputs.length === 0) throw new Error("Task plan must contain at least one task.")
  if (inputs.length > MAX_TASKS) throw new Error(`Task plan exceeds V1 maximum of ${MAX_TASKS} tasks.`)

  const tasks = inputs.map(normalizeTask)
  const ids = tasks.map((task) => task.id)
  if (new Set(ids).size !== ids.length) throw new Error("Task ids must be unique.")

  // Dependency validation remains semantic. Planned write paths are the
  // Worker's starting expectation, not a prediction of the full mutation set
  // and not an exclusive file claim. Runtime loom_scope_elevate records
  // discovered additions; file-write locks serialize actual mutations.
  transitiveDependencies(tasks)

  return tasks
}

export function taskStepId(taskId: string) {
  return `task:${taskId}`
}
