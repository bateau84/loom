import { EvaluatorExecution, type EvaluatorExecutionPins } from "../../src/evaluator-execution.js"
import { writeSync } from "node:fs"
import { ACTOR, NOW, FixtureExecutionAuthority, freshSignal, openState } from "./evaluator-execution-fixture.js"

// Disposable child process: only synthetic fixture state, no host/provider credentials.
const input = JSON.parse(await new Response(Bun.stdin.stream()).text()) as {
  state: string; pool: string; pins: EvaluatorExecutionPins; actor?: typeof ACTOR;
  source?: { memberKey: string; sourceIndex: number }; stopAt?: "reserved" | "claimed" | "consumed" | "result";
}
const state = openState(input.state), authority = new FixtureExecutionAuthority(input.pool)
authority.source = input.source
if (input.stopAt) authority.phase = async phase => {
  if (phase !== input.stopAt) return
  process.stdout.write(JSON.stringify({ stopped_at: phase }) + "\n")
  await new Promise<void>(() => {})
}
if (input.stopAt === "claimed") {
  const claim = state.store.reviews.claimIssue.bind(state.store.reviews)
  state.store.reviews.claimIssue = (...args) => {
    const result = claim(...args)
    if (result.status === "claimed-now") {
      writeSync(1, JSON.stringify({ stopped_at: "claimed" }) + "\n")
      process.kill(process.pid, "SIGKILL")
    }
    return result
  }
}
try {
  const runtime = new EvaluatorExecution(state.learning.evaluator, state.learning.automatic.history, state.store,
    { authority, authorize: async () => {} }, () => NOW)
  const result = await runtime.execute(input.actor ?? ACTOR, input.pins, freshSignal())
  process.stdout.write(JSON.stringify({ ok: true, result }) + "\n")
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "unknown" }) + "\n")
} finally { authority.close(); state.close() }
