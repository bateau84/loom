export type EvidenceStatus = "completed" | "error"

export type EvidenceObservation = {
  id: string
  sessionID: string
  agent?: string
  tool: string
  status: EvidenceStatus
  observedAt: string
  inputDigest?: string
  resultDigest?: string
  error?: string
  command?: string
  path?: string
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

  if ((tool === "bash" || tool === "shell") && typeof value.command === "string") {
    return { command: redactCommand(value.command).slice(0, 1000) }
  }

  for (const key of ["filePath", "path", "filename"]) {
    if (typeof value[key] === "string") return { path: String(value[key]).slice(0, 1000) }
  }

  return {}
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
  } satisfies EvidenceClaim
}
