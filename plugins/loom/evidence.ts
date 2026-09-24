import { isAbsolute } from "node:path"
import type { EvidenceAdmission } from "./evidence-admission"
import type { Workflow } from "./workflow"

export type EvidenceStatus = "completed" | "error"

export type EvidenceObservation = {
  id: string
  sessionID: string
  agent?: string
  tool: string
  status: EvidenceStatus
  observedAt: string
  admission?: EvidenceAdmission
  unscopedReason?: string
  inputDigest?: string
  resultDigest?: string
  error?: string
  command?: string
  path?: string
  destination?: string
  reason?: string
  skill?: string
  skillDirectory?: string
  methodology?: "practitioner" | "assessment" | "qa"
  reportPromotion?: {
    id: string
    source: string
    destination: string
    reason: string
    sha256: string
    actor: string
    promotedAt: string
    authority: "unchanged"
  }
  workflowId?: string
  stepId?: string
}

export type EvidenceKind =
  | "test"
  | "build"
  | "lint"
  | "security"
  | "runtime"
  | "integration"
  | "product-acceptance"
  | "other"

export type EvidenceClaim = {
  attempt?: number
  id: string
  workflowId: string
  stepId: string
  byAgent: string
  kind: EvidenceKind
  statement: string
  observationIds: string[]
  createdAt: string
}

const secretPatterns = [
  /(authorization:\s*bearer\s+)[^\s]+/gi,
  /((?:api[_-]?key|token|password|secret)\s*[=:]\s*)[^\s]+/gi,
]

export function redactCommand(command: string) {
  return secretPatterns.reduce((value, pattern) => value.replace(pattern, "$1[REDACTED]"), command)
}

export function safeInputSummary(tool: string, input: unknown) {
  if (!input || typeof input !== "object") return {}

  const value = input as Record<string, unknown>

  if (tool === "skill") {
    const skill = typeof value.name === "string" ? value.name : typeof value.id === "string" ? value.id : undefined
    if (skill) return { skill: skill.slice(0, 200), methodology: "practitioner" as const }
  }

  if ((tool === "bash" || tool === "shell") && typeof value.command === "string") {
    return { command: redactCommand(value.command).slice(0, 1000) }
  }

  const loomTool = tool.replace(/^loom[._]/, "")
  if ((loomTool === "assessment" || loomTool === "qa") && typeof value.skill === "string") {
    const skill = value.skill.slice(0, 200)
    const methodology = loomTool === "assessment" ? "assessment" as const : "qa" as const
    const filename = methodology === "assessment" ? "ASSESSMENT.md" : "QA.md"
    return { skill, methodology, path: `skills/${skill}/${filename}` }
  }
  if (loomTool === "report_promote") {
    return {
      ...(typeof value.source === "string" ? { path: value.source.slice(0, 1000) } : {}),
      ...(typeof value.destination === "string"
        ? { destination: value.destination.slice(0, 1000) }
        : {}),
      ...(typeof value.reason === "string" ? { reason: value.reason.slice(0, 1000) } : {}),
    }
  }

  for (const key of ["filePath", "path", "filename", "source"]) {
    if (typeof value[key] === "string") return { path: String(value[key]).slice(0, 1000) }
  }

  return {}
}

function resultDirectory(value: unknown): string | undefined {
  if (typeof value === "string") {
    const match = value.match(/Base directory for this skill:\s*([^\r\n]+)/)
    const directory = match?.[1]?.trim()
    return directory && isAbsolute(directory) ? directory : undefined
  }
  if (!value || typeof value !== "object") return undefined

  const item = value as Record<string, any>
  for (const candidate of [
    item.directory,
    item.metadata?.directory,
    item.metadata?.metadata?.directory,
    item.result?.directory,
    item.result?.metadata?.directory,
    item.result?.metadata?.metadata?.directory,
  ]) {
    if (typeof candidate === "string" && isAbsolute(candidate.trim())) return candidate.trim()
  }

  for (const candidate of [item.output, item.text]) {
    const directory = resultDirectory(candidate)
    if (directory) return directory
  }

  if (Array.isArray(item.content)) {
    for (const part of item.content) {
      const directory = resultDirectory(part?.text ?? part)
      if (directory) return directory
    }
  }
  return undefined
}

export function safeResultSummary(tool: string, result: unknown) {
  if (tool !== "skill") return {}
  const skillDirectory = resultDirectory(result)
  return skillDirectory ? { skillDirectory: skillDirectory.slice(0, 2000) } : {}
}

function shellObservation(observation: EvidenceObservation) {
  return (
    observation.status === "completed" &&
    (observation.tool === "bash" || observation.tool === "shell") &&
    typeof observation.command === "string"
  )
}

const commandPatterns: Record<Exclude<EvidenceKind, "runtime" | "integration" | "product-acceptance" | "other">, RegExp[]> = {
  test: [
    /\bgo test\b/,
    /\bbun test\b/,
    /\b(?:npm|pnpm|yarn) (?:run )?test\b/,
    /\bpytest\b/,
    /\bpython(?:3)? -m pytest\b/,
    /\bcargo test\b/,
    /\bdotnet test\b/,
    /\bmvn test\b/,
    /\bgradle test\b/,
  ],
  build: [
    /\bgo build\b/,
    /\bcargo build\b/,
    /\b(?:npm|pnpm|yarn|bun) (?:run )?build\b/,
    /\btsc\b/,
    /\bdotnet build\b/,
    /\bmvn package\b/,
    /\bgradle build\b/,
  ],
  lint: [
    /\bgolangci-lint\b/,
    /\bgo vet\b/,
    /\beslint\b/,
    /\bruff\b/,
    /\bcargo clippy\b/,
    /\b(?:npm|pnpm|yarn|bun) (?:run )?lint\b/,
    /\btsc --noEmit\b/,
  ],
  security: [
    /\bcodeql\b/,
    /\bgosec\b/,
    /\bgovulncheck\b/,
    /\bsemgrep\b/,
    /\btrivy\b/,
    /\bnpm audit\b/,
    /\bpip-audit\b/,
    /\bbandit\b/,
  ],
}

export function observationsSupportKind(kind: EvidenceKind, observations: EvidenceObservation[]) {
  if (observations.length === 0) return false
  if (observations.some((observation) => observation.status !== "completed")) return false

  if (kind === "runtime" || kind === "integration" || kind === "product-acceptance" || kind === "other") {
    return true
  }

  return observations.some(
    (observation) =>
      shellObservation(observation) &&
      commandPatterns[kind].some((pattern) => pattern.test(observation.command!)),
  )
}

export function createClaim(input: {
  attempt?: number
  id: string
  workflowId: string
  stepId: string
  byAgent: string
  kind: EvidenceKind
  statement: string
  observations: EvidenceObservation[]
  now: string
}) {
  if (!observationsSupportKind(input.kind, input.observations)) {
    throw new Error(`Observed evidence does not support claim kind ${input.kind}.`)
  }

  return {
    id: input.id,
    workflowId: input.workflowId,
    stepId: input.stepId,
    byAgent: input.byAgent,
    kind: input.kind,
    statement: input.statement,
    observationIds: input.observations.map((observation) => observation.id),
    createdAt: input.now,
    ...(input.attempt === undefined ? {} : { attempt: input.attempt }),
  } satisfies EvidenceClaim
}

/** Legacy scoped evidence remains readable; new admissions also bind the attempt. */
export function observationMatchesStep(observation: EvidenceObservation, workflow: Workflow, stepId: string) {
  if (observation.workflowId !== workflow.id || observation.stepId !== stepId || observation.unscopedReason) return false
  const step = workflow.steps.find((step) => step.id === stepId)
  if (!step) return false
  const origin = observation.admission
  if (!origin) return (step.attempt ?? 0) === 0
  return (origin.workflowId === workflow.id && origin.stepId === stepId &&
    origin.agent === step.agent && origin.attempt === (step.attempt ?? 0))
}
