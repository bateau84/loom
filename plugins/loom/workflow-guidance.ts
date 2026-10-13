/** Candidate transitions projected from live Loom readiness, never inferred liveness. */
export type LoomStepAdmission = {
  step: string
  agent: string
  dispatch: { state: "ready" | "blocked" | "unknown"; reason?: string }
  execution: { state: "unknown"; evidence?: "current_attachment"; attachedAt?: string }
}

export function candidateLoomTransitions(workflowId: string, readiness: readonly LoomStepAdmission[]) {
  return readiness
    .filter((step) => step.dispatch.state === "ready")
    .map(({ step, agent, execution }) => ({
      kind: "candidate" as const,
      tool: "loom_dispatch_grant" as const,
      input: { workflowId, stepId: step },
      agent,
      executionLiveness: "unknown" as const,
      note: execution.evidence === "current_attachment"
        ? "An agent was attached; inspect live execution before considering a second grant."
        : "Current dispatch admission was ready. The grant will revalidate state, budget and ownership.",
    }))
}
