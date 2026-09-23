import { randomUUID } from "node:crypto"
import { runnable, type Workflow } from "./workflow"
import { workflowBindingTerminal } from "./lifecycle"
import { withRuntimeLock, type LoomRuntimeIdentity, type RawStorage } from "./runtime"
import type { EvidenceObservation } from "./evidence"

export const sessionAttachmentKey = (sessionID: string) => `session-attachment/${sessionID}`

export type EvidenceAdmission = {
  at: string
  workflowId: string
  stepId: string
  attachmentId: string
  agent: string
  attempt: number
}

/** Host call IDs are not a project/session/message namespace on their own. */
export function observationCallKey(event: {
  sessionID?: string; messageID?: string; id?: string; callID?: string; tool?: string
}) {
  const id = event.id ?? event.callID
  if (!event.sessionID || !event.tool || !id) return undefined
  return JSON.stringify([event.sessionID, event.messageID ?? "", id, event.tool])
}

/** Capture execution authority before the operation, under the binding's lock. */
export async function captureEvidenceAdmission(
  storage: RawStorage, runtime: LoomRuntimeIdentity, sessionID: string, agent: string,
): Promise<EvidenceAdmission | undefined> {
  const id = await storage.get(`session/${sessionID}`)
  if (typeof id !== "string" || !id || !agent) return undefined
  return withRuntimeLock(runtime, "workflow", id, async () => {
    if (await storage.get(`session/${sessionID}`) !== id) return undefined
    const workflow = await storage.get(`workflow/${id}`) as Workflow | undefined
    if (!workflow || workflow.projectId !== runtime.projectId || workflowBindingTerminal(workflow)) return undefined
    const stepId = await storage.get(`session-step/${sessionID}`)
    const step = runnable(workflow).find((step) => step.id === stepId && step.agent === agent)
    if (!step) return undefined
    // Legacy sessions acquire an epoch on first observed execution. Every new
    // grant attachment rotates it, even when workflow and step stay the same.
    let attachmentId = await storage.get(sessionAttachmentKey(sessionID))
    if (typeof attachmentId !== "string" || !attachmentId) {
      attachmentId = randomUUID()
      await storage.set(sessionAttachmentKey(sessionID), attachmentId)
    }
    return {
      at: new Date().toISOString(), workflowId: id, stepId: step.id,
      attachmentId: attachmentId as string, agent, attempt: step.attempt ?? 0,
    }
  })
}

/**
 * Historical origin is retained separately from proof eligibility. A result
 * cannot acquire the session's newer binding. Validation and evidence writes
 * serialize with cancellation, attachment, completion and reopening.
 */
export async function persistEvidenceObservation(
  storage: RawStorage, runtime: LoomRuntimeIdentity, observation: EvidenceObservation,
  admission?: EvidenceAdmission,
) {
  const persist = async () => {
    if (admission) {
      observation.admission = admission
      const workflow = await storage.get(`workflow/${admission.workflowId}`) as Workflow | undefined
      const sameAttachment = await storage.get(`session/${observation.sessionID}`) === admission.workflowId &&
        await storage.get(`session-step/${observation.sessionID}`) === admission.stepId &&
        await storage.get(sessionAttachmentKey(observation.sessionID)) === admission.attachmentId
      const step = workflow && runnable(workflow).find((step) => step.id === admission.stepId && step.agent === admission.agent)
      if (!sameAttachment) observation.unscopedReason = "attachment-changed"
      else if (!workflow || workflow.projectId !== runtime.projectId || workflowBindingTerminal(workflow)) {
        observation.unscopedReason = "workflow-closed"
      } else if (!step || (step.attempt ?? 0) !== admission.attempt) observation.unscopedReason = "step-changed"
      else if (observation.agent !== admission.agent) observation.unscopedReason = "agent-changed"
      else if (!observation.unscopedReason) {
        observation.workflowId = admission.workflowId
        observation.stepId = admission.stepId
      }
    } else observation.unscopedReason ??= "no-admission"
    await storage.set(`evidence/${observation.id}`, observation)
    await storage.set(`evidence-session/${observation.sessionID}/${observation.id}`, observation.id)
  }
  if (admission) await withRuntimeLock(runtime, "workflow", admission.workflowId, persist)
  else await persist()
}
