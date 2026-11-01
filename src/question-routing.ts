import type { Config } from "./config.js"
import type { QuestionRecipient, QuestionTarget } from "./collaboration.js"
import type { LedgerRecord } from "./model.js"
import type { Store } from "./store.js"

export type NativeModel = { providerID: string; id: string; variant?: string }
export type NativeRecipientAgent = { id: string; mode: string; hidden?: boolean; model?: NativeModel }
export type NativeAsker = { id: string; parentID?: string; agent?: string; model?: NativeModel }
export type QuestionRoute = QuestionTarget & {
  mode: "delegate" | "notify" | "manual"
  reason: string
  agent?: string
  session?: string
  model?: NativeModel
}

/** Choose a responsibility, not a model. Never guess between equally eligible agents. */
export function questionRoute(recipient: QuestionRecipient, config: Config, roster: NativeRecipientAgent[], asker: NativeAsker): QuestionRoute {
  if (recipient.kind === "user") return { mode: asker.parentID ? "notify" : "manual", reason: asker.parentID ? "relay-user-request-via-dispatcher" : "ask-user-in-primary-session",
    expected_session: asker.parentID ?? asker.id, session: asker.parentID }
  if (recipient.kind === "dispatcher") return asker.parentID
    ? { mode: "notify", reason: "dispatching-session", expected_session: asker.parentID, session: asker.parentID }
    : { mode: "manual", reason: "no-dispatching-session" }

  const eligible = roster.filter(a => (a.mode === "subagent" || a.mode === "all") && !a.hidden &&
    config.agents[a.id]?.enabled !== false)
  const matches = recipient.kind === "agent" ? eligible.filter(a => a.id === recipient.id)
    : eligible.filter(a => config.agents[a.id]?.roles.includes(recipient.id as string))
  if (matches.length !== 1) return { mode: "manual", reason: matches.length ? "ambiguous-role" : "recipient-agent-unavailable" }
  const agent = matches[0].id
  if (asker.parentID) return { mode: "notify", reason: "delegate-through-parent-to-respect-depth",
    expected_agent: agent, expected_parent_session: asker.parentID, agent, session: asker.parentID }
  const model = matches[0].model ?? asker.model
  return { mode: "delegate", reason: "resolved-agent", expected_agent: agent, agent,
    ...(model ? { model } : {}) }
}

type Native = {
  // Delegation runs OpenCode's native subagent tool, which owns its depth and permission policy.
  // Its prompt hook must bind the verified child to this OQ before input admission.
  delegate: (agent: string, parentID: string, questionID: string, prompt: string, background: boolean) =>
    Promise<{ sessionID: string; status: "running" | "completed" }>
  synthetic: (sessionID: string, text: string, metadata: Record<string, string>) => Promise<unknown>
}
type Dispatch = { status: "admission-observed" | "not-attempted" | "outcome-unknown";
  reason: string; target_session_id?: string; target_agent?: string; attempted: boolean;
  native_status?: "running" | "completed"; diagnostic?: string }
function nativeDenial(error: unknown): { reason: string; diagnostic: string } | undefined {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : ""
  // Both checks occur before native child creation in OpenCode 2.2.0's
  // subagent tool. Never infer non-execution from an arbitrary runtime error.
  const depth = /Subagent depth limit reached \((\d+)\)/.exec(message)
  if (depth) return { reason: "native-subagent-depth-denied",
    diagnostic: `Subagent depth limit reached (${depth[1]})` }
  if (/Subagent denied: [\w.:-]+/.test(message) || /Permission denied: subagent/.test(message))
    return { reason: "native-subagent-permission-denied", diagnostic: "Native subagent permission denied" }
  return undefined
}
const unwrap = (value: unknown): unknown => value && typeof value === "object" && "data" in value ? (value as { data: unknown }).data : value
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}

/** A native acknowledgment proves admission only, not execution or an answer. */
export async function sendQuestion(store: Store, question: LedgerRecord, route: QuestionRoute, api: Native, signal: AbortSignal) {
  let outcome: Dispatch = { status: "not-attempted", reason: route.reason, attempted: false }
  try {
    signal.throwIfAborted()
    if (route.mode === "delegate" && route.agent) {
      outcome = { status: "outcome-unknown", reason: "native-subagent-delegation", target_agent: route.agent, attempted: true }
      const admitted = await api.delegate(route.agent, question.session_id, question.id,
        `You are being asked a Loom Open Question (ID: ${question.id}). Read it with loom_record query view=thread and question_id, investigate within your responsibility, then submit the answer using loom_record operation=answer with this exact question_id. A chat response alone does not save an answer. Do not claim authority outside your role. Do not create another Action just to answer. After saving the answer, finish with a short message naming OQ ${question.id} and instructing your parent to retrieve its authoritative thread. OpenCode's native subagent result handles continuation; Loom will not send a duplicate answer notice.`,
        question.data.blocking !== true)
      if (typeof admitted.sessionID !== "string" || !admitted.sessionID ||
          (admitted.status !== "running" && admitted.status !== "completed"))
        throw new Error("Native subagent did not return a verified Session/status")
      outcome = { ...outcome, target_session_id: admitted.sessionID, native_status: admitted.status,
        status: "admission-observed", reason: "native-subagent-admitted" }
    } else if (route.mode === "notify" && route.session) {
      outcome = { status: "outcome-unknown", reason: "native-parent-notice", target_session_id: route.session,
        ...(route.agent ? { target_agent: route.agent } : {}), attempted: true }
      const ack = record(unwrap(await api.synthetic(route.session,
        `Loom Open Question ${question.id} requires ${route.agent ? `agent ${route.agent}` : (question.data.recipient as QuestionRecipient).kind}. Retrieve its full thread with loom_record. If this is for the user, ask the user directly and relay the actual decision with its source. Otherwise delegate natively to the specialist and then call loom_record bind-respondent with question_id and respondent_session_id from the native subagent result. Only that selected Session may answer. Do not answer outside your authority. The question is recorded, not resolved.`,
        { format: "loom-question-notice/v1", question_id: question.id })))
      if (ack.type !== "synthetic" || ack.sessionID !== route.session || typeof ack.id !== "string")
        throw new Error("Native parent notice admission could not be confirmed")
      outcome = { ...outcome, status: "admission-observed", reason: "native-parent-notice-admitted" }
    }
  } catch (error) {
    // Denials verified as pre-creation in the pinned native contract are safe
    // to classify. Every other error might follow partial native side effects.
    const denied = route.mode === "delegate" && !signal.aborted ? nativeDenial(error) : undefined
    outcome = { ...outcome, status: denied || !outcome.attempted ? "not-attempted" : "outcome-unknown",
      attempted: denied ? false : outcome.attempted,
      reason: denied?.reason ?? (signal.aborted ? "caller-interrupted" : "native-operation-failed-or-unconfirmed"),
      diagnostic: denied?.diagnostic ?? "Native outcome unconfirmed; see host diagnostics" }
    console.warn(`Loom question ${question.id} dispatch: ${outcome.diagnostic}`)
  }
  let annotation: { status: "stored"; id: string } | { status: "failed"; error: string }
  try {
    const saved = store.append({ session_id: question.session_id, agent: "system", kind: "result",
      ...(question.action_id ? { action_id: question.action_id } : {}), ...(question.node_id ? { node_id: question.node_id } : {}),
      data: { format: "loom-question-dispatch/v1", question_id: question.id, ...outcome,
        qualification: "Native admission is not receipt, execution, an authorized answer, or user approval; no automatic retry." } })
    annotation = { status: "stored", id: saved.id }
  } catch (error) {
    annotation = { status: "failed", error: (error instanceof Error ? error.message : String(error)).slice(0, 500) }
  }
  return { ...outcome, annotation }
}
