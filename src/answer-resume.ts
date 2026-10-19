import type { AnswerCommit } from "./collaboration.js"
import type { Store } from "./store.js"

export const RESUME_WAIT_MS = 5000
type Eligibility = NonNullable<AnswerCommit["resume"]>
type Notice = { sessionID: string; resume: true; delivery: "steer"; text: string; description: string; metadata: Record<string, string> }
type Outcome = Eligibility & { status: "admission-observed" | "failed" | "outcome-unknown" | "not-attempted"; reason: string; attempted: boolean }
const qualification = "Admission is not processing or completion. Location check is not an ownership lease. Waiting expiry does not cancel native admission. No retry or replay."

/** Consume only the immediate post-COMMIT handoff. No persisted queue or recovery path. */
export async function resumeAnswer(store: Store, committed: AnswerCommit,
  local: (session: string) => Promise<boolean>, synthetic: (notice: Notice) => Promise<unknown>, signal: AbortSignal) {
  const eligible = committed.resume
  if (!eligible) return committed.record
  let attempted = false
  const deadline = new AbortController()
  const stop = AbortSignal.any([signal, deadline.signal])
  const timer = setTimeout(() => deadline.abort(), RESUME_WAIT_MS)
  let onAbort: () => void = () => {}
  const interrupted = new Promise<never>((_, reject) => {
    onAbort = () => reject(new Error("resume-wait-interrupted"))
    stop.addEventListener("abort", onAbort, { once: true })
    if (stop.aborted) onAbort()
  })
  let outcome: Outcome
  try {
    outcome = await Promise.race([interrupted, (async (): Promise<Outcome> => {
      stop.throwIfAborted()
      if (!await local(eligible.asking_session_id)) return { ...eligible, status: "not-attempted", reason: "target-not-local-or-missing", attempted }
      // A late preflight after timeout/interrupt must never initiate input.
      stop.throwIfAborted()
      attempted = true
      const ack = await synthetic({ sessionID: eligible.asking_session_id, resume: true, delivery: "steer",
        description: "Loom blocking question has an answer",
        text: `Loom records: question ${eligible.question_id}; answer ${eligible.answer_id}. Please retrieve the authoritative question/thread and answer using loom_record before continuing. An answer is not resolution, approval or permission.`,
        metadata: { format: "loom-answer-notice/v1", question_id: eligible.question_id, answer_id: eligible.answer_id } })
      const valid = ack !== null && typeof ack === "object" && "id" in ack && typeof ack.id === "string"
        && "sessionID" in ack && ack.sessionID === eligible.asking_session_id && "type" in ack && ack.type === "synthetic"
      return { ...eligible, status: valid ? "admission-observed" : "outcome-unknown", reason: valid ? "native-acknowledged" : "unsupported-native-ack", attempted }
    })()])
  } catch (error) {
    const rejected = error !== null && typeof error === "object" && "_tag" in error
      && ["SessionNotFoundError", "LocationNotFoundError", "UnauthorizedError", "InvalidRequestError", "ConflictError"].includes(String(error._tag))
    outcome = { ...eligible, attempted, status: !attempted ? "not-attempted" : rejected ? "failed" : "outcome-unknown",
      reason: stop.aborted ? deadline.signal.aborted ? "wait-deadline-exceeded" : "caller-or-plugin-interrupted"
        : !attempted ? "target-check-failed" : rejected ? "native-rejected" : "native-call-error" }
  } finally {
    clearTimeout(timer); stop.removeEventListener("abort", onAbort)
  }
  // Independent autocommit annotation: never rewrite the answer or imply an ordinary host observation.
  let annotation: { status: "stored"; id: string } | { status: "failed"; error: string }
  try {
    const record = committed.record
    const saved = store.append({ session_id: record.session_id, agent: "system", kind: "result",
      ...(record.action_id ? { action_id: record.action_id } : {}), ...(record.node_id ? { node_id: record.node_id } : {}),
      data: { format: "loom-answer-resume/v1", ...outcome, qualification } })
    annotation = { status: "stored", id: saved.id }
  } catch (error) {
    annotation = { status: "failed", error: (error instanceof Error ? error.message : String(error)).slice(0, 500) }
  }
  return { ...committed.record, resume: { ...outcome, qualification, annotation } }
}
