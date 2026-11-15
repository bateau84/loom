import { test, expect } from "bun:test"
import { registeredLoom } from "./helpers/registered-loom.js"

function reviewRequest() {
  return {
    format: "loom-review-request/v1", request_id: "review-choice-composition",
    mandate: { question: "Private review mandate: examine original historical artifact",
      dimensions: ["correctness"], criteria: [{ text: "Preserve failures", source_ref: null }],
      mode: "independent", inclusions: ["original artifact"], exclusions: [] },
    intended_recipient: { agent: "investigator", session_id: null },
    members: [{ member_id: "original", work_ref: null, producing_attempt_refs: [],
      artifact_refs: [{ locator: "/private/mandate.txt", version: { kind: "sha256", value: "0".repeat(64) }, content_ref: null }],
      prior_review_request_id: null, membership_source_refs: [], gaps: [{ reason: "source-missing", source_ref: null }] }],
    rechecks: [],
  }
}

test("protected review asks and structured choices coexist without private-ledger leakage", async () => {
  const f = await registeredLoom()
  try {
    const review = reviewRequest()
    const choice = { answer_type: "multi-choice", choices: [{ id: "A", answer: "Keep" }, { id: "B", answer: "Change" }] }
    const protectedAsk = { operation: "ask", question: review.mandate.question, blocking: true,
      recipient: { kind: "agent", id: "investigator" }, review }
    // A mixed protected review must not fall through to ordinary OQ storage.
    await expect(f.invoke("record", { ...protectedAsk, ...choice })).rejects.toThrow("immutable review mandate")
    expect((await f.invoke("record", { operation: "query", session_only: true })).result.items).toEqual([])

    const ordinary = (await f.invoke("record", {
      operation: "ask", question: "Which ordinary choice?", blocking: true,
      recipient: { kind: "agent", id: "investigator" }, ...choice,
    })).result
    expect(ordinary.dispatch.status).toBe("admission-observed")
    expect(f.sessionCreates).toHaveLength(1)
    const answer = (await f.invoke("record", {
      operation: "answer", question_id: ordinary.id, choice_id: "B", reason: "Fixture only",
    }, ordinary.dispatch.target_session_id, "investigator")).result
    expect(answer.data).toMatchObject({ choice_id: "B", answer: "Change" })

    const protectedResult = (await f.invoke("record", protectedAsk)).result
    expect(protectedResult.dispatch).toMatchObject({ status: "not-attempted",
      reason: "recipient-specific-protected-transfer-unqualified" })
    expect(f.sessionCreates).toHaveLength(1) // only ordinary OQ dispatched
    const privateRead = (await f.invoke("review", { operation: "read", request_id: review.request_id })).result
    expect(privateRead.request.mandate).toEqual(review.mandate)
    const publicThread = JSON.stringify((await f.invoke("record", {
      operation: "query", view: "full_thread", session_id: "s", response_format: "json",
    })).result)
    expect(publicThread).toContain("Which ordinary choice?")
    expect(publicThread).not.toContain(review.mandate.question)
    expect(publicThread).not.toContain("/private/mandate.txt")
  } finally { await f.close() }
})
