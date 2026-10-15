/** TEST-ONLY plugin and scripted provider. Never enabled by Loom or its examples. */
import { Plugin } from "@opencode/plugin"
import { Database } from "bun:sqlite"
import { appendFileSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { randomUUID } from "node:crypto"
import { HandbackExperiment } from "./bridge.mjs"

const provider = "handback-fixture"
const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } }
const value = (result: any) => JSON.parse(typeof result.content === "string" ? result.content : result.content.filter((x: any) => x.type === "text").map((x: any) => x.text).join("\n")).result

export default Plugin.define({
  id: "loom.handback.experiment",
  async setup(ctx) {
    const root = process.env.LOOM_HANDBACK_EXPERIMENT
    if (!root || resolve(ctx.location.directory) !== resolve(join(root, "project"))) throw new Error("Handback fixture requires its isolated project")
    const options = JSON.parse(readFileSync(join(root, "case.json"), "utf8"))
    const db = new Database(join(root, "bridge.sqlite")); db.exec("PRAGMA busy_timeout=2000")
    const bridge = new HandbackExperiment(db)
    const prior = db.prepare("SELECT data FROM bridge_fixture WHERE key='state'").get() as any
    const state: any = prior ? JSON.parse(prior.data) : { requests: [], nudges: 0, answers: 0, completions: 0, coordinations: 0 }
    let closed = false
    const regs: Array<{ dispose(): Promise<void> }> = []
    const save = () => db.prepare("INSERT INTO bridge_fixture VALUES('state',?) ON CONFLICT(key) DO UPDATE SET data=excluded.data").run(JSON.stringify(state))
    const audit = (type: string, data: any = {}) => { appendFileSync(join(root, "audit.ndjson"), JSON.stringify({ type, ...data }) + "\n"); save() }
    const control = () => { try { return JSON.parse(readFileSync(join(root, "control.json"), "utf8")) } catch { return {} } }
    const waitFor = async (condition: () => boolean) => {
      for (let i = 0; i < 1600; i++) { if (closed) throw new Error("Fixture disposed"); if (condition()) return; await new Promise(r => setTimeout(r, 25)) }
      throw new Error("Scripted-provider barrier timed out")
    }
    const execute = (code: string) => ({ tool: "execute", input: { code } })
    const call = (name: string, input: any) => execute(`return await tools.loom.${name}(${JSON.stringify(input)})`)
    const require = (ok: unknown, why: string) => { if (!ok) throw new Error(why) }
    const script = async (role: string, prompt: any): Promise<any> => {
      const text = JSON.stringify(prompt)
      if (role === "primary") {
        if (!state.action) return execute('const a=JSON.parse(await tools.loom.action({operation:"create",title:"Handback experiment",goal:"Use a qualified answer and coordinate the result"})).result; await tools.loom.plan({operation:"save",action_id:a.id,expected_revision:0,nodes:[{id:"worker",kind:"task",title:"Original Worker assignment",outcome:"Return the qualified finding"}]}); return a.id')
        if (!state.originalReturned) return { tool: "subagent", input: { agent: "bridge-worker", description: "Ask and yield", prompt: `Select Action ${state.action.id}, node worker. Ask Research for the qualified marker, then yield.` } }
        if (options.mode === "native-covered" && !state.newerReturned) return { tool: "subagent", input: { agent: "bridge-worker", sessionID: state.worker, background: true, description: "Native continuation owns return", prompt: "Continue the same assignment when Research answers." } }
        if (!state.researchReturned) return { tool: "subagent", input: { agent: "bridge-research", background: true, description: "Answer Worker question", prompt: `Answer authoritative question ${state.question.id} after the fixture barrier.` } }
        if (!state.completion) return { text: "PRIMARY_WAITING_FOR_ASSIGNMENT" }
        if (!state.primaryRead) { require(text.includes(state.completion.id), "Primary did not receive the completion reference"); return call("record", { operation: "query", action_id: state.action.id, record_id: state.completion.id }) }
        if (!state.coordinations) { require(text.includes(options.marker) && text.includes(state.completion.id), "Primary request lacks the retrieved authoritative completion"); return call("record", { operation: "add", action_id: state.action.id, kind: "result", statement: `PRIMARY_NEXT_COORDINATING_ACTION using ${state.completion.id}` }) }
        return { text: "PRIMARY_COORDINATION_FINISHED" }
      }
      if (role === "worker") {
        if (!state.workRef) { require(text.includes(state.action.id), "Worker did not receive its Action"); return call("context", { action_id: state.action.id, node_id: "worker" }) }
        if (!state.question) return call("record", { operation: "ask", action_id: state.action.id, node_id: "worker", respondent: "bridge-research", statement: "What is the qualified marker?" })
        if (!state.answer) {
          if (state.newerStarted) await waitFor(() => Boolean(state.answer))
          else return { text: "WORKER_ASKED_AND_YIELDED" }
        }
        if (!state.workerRead) return call("record", { operation: "query", view: "thread", question_id: state.question.id })
        if (!state.completion) {
          require(text.includes(options.marker) && text.includes("only for this fixture"), "Worker request lacks the retrieved qualified answer")
          return call("record", { operation: "complete", work_ref: state.workRef, statement: `${options.marker}; only for this fixture. Original assignment finished.` })
        }
        return { text: `WORKER_FINISHED completion=${state.completion.id}` }
      }
      if (role === "research") {
        await waitFor(() => control().releaseAnswer === true)
        if (!state.answer) return call("record", { operation: "answer", question_id: state.question.id, statement: `${options.marker}; valid only for this fixture, not a general conclusion.`, artifact_refs: ["fixture:qualified-source"] })
        // Keep unrelated native background work active until the driver records the
        // handback result. Its own native return must not mask a missing Worker return.
        await waitFor(() => control().releaseResearch === true)
        return { text: "RESEARCH_FINISHED" }
      }
      throw new Error(`Unexpected scripted role ${role}`)
    }
    const model = (role: string) => ({
      specificationVersion: "v3", provider, modelId: role, supportedUrls: {},
      doGenerate: async () => { throw new Error("Unexpected non-streaming provider request") },
      doStream: async (input: any) => {
        try {
          if (state.requests.length >= 100) throw new Error("Scripted request ceiling exceeded")
          state.requests.push(role); audit("provider-request", { role, prompt: input.prompt })
          const response = await script(role, input.prompt)
          const events: any[] = [{ type: "stream-start", warnings: [] }]
          if (response.tool) events.push({ type: "tool-call", toolCallId: randomUUID(), toolName: response.tool, input: JSON.stringify(response.input) })
          else events.push({ type: "text-start", id: "text" }, { type: "text-delta", id: "text", delta: response.text }, { type: "text-end", id: "text" })
          events.push({ type: "finish", finishReason: { unified: response.tool ? "tool-calls" : "stop", raw: response.tool ? "tool_calls" : "stop" }, usage })
          return { stream: new ReadableStream({ start(c) { for (const e of events) c.enqueue(e); c.close() } }) }
        } catch (e) { if (!closed) { state.failure = String(e); audit("fixture-failure") }; throw e }
      },
    })
    try {
      regs.push(await ctx.provider.transform(editor => {
        for (const p of editor.list()) editor.remove(p.provider.id)
        editor.add({ info: { id: provider, name: "Local scripted fixture", activation: "enabled", package: "aisdk:loom-handback-scripted" } as any,
          models: ["primary", "worker", "research"].map(id => ({ id, modelID: id, providerID: provider, name: id, package: "aisdk:loom-handback-scripted",
            capabilities: { tools: true, input: ["text"], output: ["text"] }, variants: [], time: { released: 0 }, cost: [], status: "active", enabled: true, limit: { context: 200000, output: 1000 } })) as any })
      }))
      regs.push(await ctx.aisdk.hook("sdk", event => {
        if (event.model.providerID !== provider) throw new Error("External provider forbidden by fixture")
        event.sdk = { languageModel: (id: string) => model(id) }
      }))
      regs.push(await ctx.session.hook("title", event => { event.result = "Loom handback experiment" }))
      regs.push(await ctx.session.hook("model.request", event => { if (event.model.providerID !== provider) throw new Error("External model request forbidden") }))
      regs.push(await ctx.tool.hook("execute.before", async event => {
        const input = event.input as any
        if (event.tool === "subagent" && input?.sessionID === state.worker && state.originalReturned) {
          bridge.nativeOwns(options.assignment); state.newerStarted = true; audit("newer-native-start", { primary: event.sessionID, worker: state.worker })
        }
      }))
      regs.push(await ctx.tool.hook("execute.after", async raw => {
        const event = raw as any, input = event.input
        if (event.status !== "completed") { state.failure = `Native tool failed: ${event.tool}: ${event.error?.message}`; audit("tool-failure"); return }
        if (event.tool === "subagent") {
          const output = event.result.output
          require(output?.sessionID, "Native subagent did not return its Session ID")
          if (input.agent === "bridge-worker" && !input.sessionID) {
            require(output.status === "completed", "Original foreground delegation has not returned")
            state.worker = output.sessionID; state.primary = event.sessionID; state.originalReturned = true
            bridge.track({ id: options.assignment, primary: state.primary, worker: state.worker, work_ref: state.workRef, original_returned: true })
            audit("original-delegation-returned", { worker: state.worker, primary: state.primary })
          } else if (input.agent === "bridge-worker") { state.newerReturned = true; audit("newer-native-return", { status: output.status }) }
          else if (input.agent === "bridge-research") { state.research = output.sessionID; state.researchReturned = true; audit("research-background-launched") }
          return
        }
        if (!/^loom[_.]/.test(event.tool)) return
        const result = value(event.result), name = event.tool.replace(/^loom[_.]/, "")
        audit("loom-result", { session: event.sessionID, agent: event.agent, name, input, result })
        if (name === "action" && input.operation === "create") state.action = result
        if (name === "context" && event.agent === "bridge-worker") state.workRef = result.work_ref
        if (name === "record" && input.operation === "ask") state.question = result
        if (name === "record" && input.operation === "answer") {
          state.answer = result; state.answers++; audit("answer-saved")
          if (bridge.resumeAfterAnswer(options.assignment, result.id)) {
            const payload = { id: "msg_" + result.id.replaceAll("-", "").slice(0,26), sessionID: state.worker, resume: true, delivery: "steer",
              text: `Answer recorded for question ${state.question.id}. Retrieve its authoritative thread and finish assignment ${options.assignment}.`, metadata: { source: "loom-answer-experiment", question_id: state.question.id } }
            audit("worker-continuation-requested", { payload })
            await ctx.session.synthetic(payload as any)
          }
        }
        if (name === "record" && input.view === "thread" && event.agent === "bridge-worker") { state.workerRead = true; audit("worker-thread-retrieved") }
        if (name === "record" && input.operation === "complete") {
          state.completion = result; state.completions++; audit("worker-explicit-completion")
          if (options.mode === "cancelled") bridge.cancel(options.assignment) // deliberate injected assignment cancellation, NOT idle inference
          if (options.mode !== "baseline") {
            const offer = bridge.offer(options.assignment, result); audit("handback-decision", { decision: offer.state })
            if (offer.payload && bridge.beginSend(options.assignment)) {
              state.nudges++; audit("primary-nudge-submitted", { payload: offer.payload })
              try {
                await ctx.session.synthetic(offer.payload as any)
                if (options.mode === "lost-receipt") throw new Error("Injected acknowledgement loss AFTER host admission")
                bridge.outcome(options.assignment, "admitted")
              } catch (error) { bridge.outcome(options.assignment, "uncertain"); audit("nudge-outcome-uncertain", { error: String(error) }) }
              // A duplicate callback does not manufacture a second wake or replay work.
              require(!bridge.offer(options.assignment, result).payload, "Duplicate completion reclaimed handback")
            }
          }
        }
        if (name === "record" && input.operation === "query" && input.record_id === state.completion?.id && event.agent === "bridge-primary") { state.primaryRead = true; audit("primary-completion-retrieved") }
        if (name === "record" && input.operation === "add" && event.agent === "bridge-primary") {
          require(state.primaryRead, "Primary coordinated without retrieving completion")
          state.coordinations++; state.coordinationRecord = result
          const a = bridge.get(options.assignment)
          if (a?.completion_id) bridge.consumed(options.assignment, event.sessionID, state.completion.id)
          audit("primary-next-coordinating-action")
        }
        save()
      }))
      audit("fixture-ready")
    } catch (error) { state.failure = String(error); audit("fixture-setup-failed"); await Promise.allSettled(regs.map(r => r.dispose())); db.close(); throw error }
    return async () => { closed = true; await Promise.allSettled(regs.map(r => r.dispose())); db.close() }
  },
})
