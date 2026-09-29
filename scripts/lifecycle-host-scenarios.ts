import { strict as assert } from "node:assert"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

export type LifecycleHostDriver = {
  project: string
  create: (agent: "general" | "worker", parent?: string) => Promise<string>
  run: (sessionID: string, code: string, waitForProgramDone?: boolean) => Promise<any>
  waitForPrompt: (predicate: (prompt: string) => boolean) => Promise<string>
}

const route = JSON.stringify({
  humanFacing: false, behavioral: false, structural: false, externalUnknown: false,
  diagnostic: false, productOutcome: false, implementationRequested: true, executionDepth: "task",
})
const decodeResult = `const unpack = (value) => {
  if (typeof value === "string") return JSON.parse(value);
  if (typeof value?.content === "string") return JSON.parse(value.content);
  return value?.output ?? value;
};`
const setupCode = `${decodeResult}
const started = unpack(await tools.loom.code.start({request: "Local lifecycle host verification"}));
if (started.error) throw new Error(started.error);
const routed = unpack(await tools.loom.code.route(${route}));
if (routed.error) throw new Error(routed.error);
const scoped = unpack(await tools.loom.code.task_scope({workflowId: started.workflowId, stepId: "worker", write: ["src/**"]}));
if (scoped.error) throw new Error(scoped.error);
const grant = unpack(await tools.loom.code.dispatch_grant({workflowId: started.workflowId, stepId: "worker"}));
if (grant.error) throw new Error(grant.error);
return {workflowId: started.workflowId, stepId: "worker", grantId: grant.grantId};`

async function waitSignal(directory: string, name: string) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try { return JSON.parse(await readFile(join(directory, name), "utf8")) }
    catch (error: any) { if (error.code !== "ENOENT") throw error }
    await Bun.sleep(25)
  }
  throw new Error(`Lifecycle host scenario timed out waiting for ${name}`)
}

function rejectionMessage(value: any): string {
  return typeof value?.error === "string" ? value.error :
    typeof value?.error?.message === "string" ? value.error.message :
    typeof value === "string" ? value : ""
}

/** Runs real OpenCode sessions/tools against a local scripted provider, not model inference. */
export async function runLifecycleHostScenarios(driver: LifecycleHostDriver) {
  const signals = join(driver.project, ".lifecycle-probe")
  await mkdir(signals, { recursive: true })
  const parent = await driver.create("general")
  const child = await driver.create("worker", parent)
  const recoveryChild = await driver.create("worker", parent)
  const old = await driver.run(parent, setupCode)
  assert.ok(old?.grantId, `Initial workflow/grant failed: ${JSON.stringify(old)}`)
  assert.equal((await driver.run(child, `return await tools.loom.code.attach(${JSON.stringify(old)})`))?.attached, true)
  const otherGrant = await driver.run(parent, `return await tools.loom.code.dispatch_grant(${JSON.stringify({ workflowId: old.workflowId, stepId: "worker" })})`)
  assert.equal((await driver.run(recoveryChild, `return await tools.loom.code.attach(${JSON.stringify({ ...old, grantId: otherGrant.grantId })})`))?.attached, true)

  // Both controlled tools genuinely begin on the old binding. One returns the
  // new grant; the other returns only after reattachment has really succeeded.
  const delayed = driver.run(child, `${decodeResult}
const pending = tools.lifecycleprobe.delayed({});
const grant = unpack(await tools.lifecycleprobe.replacementGrant({}));
const attachment = unpack(await tools.loom.code.attach(grant));
if (!attachment.attached) throw new Error(JSON.stringify(attachment));
await tools.lifecycleprobe.attached({});
return {attachment, result: unpack(await pending)};`)
  // Avoid an unhandled rejection while the other real session does its work.
  void delayed.catch(() => {})
  try {
    assert.equal((await waitSignal(signals, "started")).sessionID, child)
    const cancel = await driver.run(parent, `return await tools.loom.code.cancel(${JSON.stringify({
      workflowId: old.workflowId, reason: "Lifecycle host recovery test", confirmation: "Abort this workflow and start its replacement.",
    })})`)
    assert.equal(cancel?.cancelled, true)
    const next = await driver.run(parent, setupCode)
    assert.ok(next?.grantId)
    assert.notEqual(next.workflowId, old.workflowId)

    // R1 is exercised through the outer execute tool and the inner real mirror.
    const deniedProgram = await driver.run(recoveryChild, 'return await tools.lifecycleprobe.normal({})')
    assert.match(rejectionMessage(deniedProgram), /cancelled/i)
    const history = await driver.run(recoveryChild, 'return await tools.loom.code.status({"detail":true})')
    assert.equal(history?.summary?.state, "cancelled")
    const invalid = await driver.run(recoveryChild, `return await tools.loom.code.attach(${JSON.stringify({ ...next, grantId: "invalid-grant" })})`)
    assert.match(rejectionMessage(invalid), /grant not found/i)
    const recoveryGrant = await driver.run(parent, `return await tools.loom.code.dispatch_grant(${JSON.stringify({ workflowId: next.workflowId, stepId: "worker" })})`)
    const args = { ...next, grantId: recoveryGrant.grantId }
    assert.equal((await driver.run(recoveryChild, `return await tools.loom.code.attach(${JSON.stringify(args)})`))?.attached, true)
    assert.match(rejectionMessage(await driver.run(recoveryChild, `return await tools.loom.code.attach(${JSON.stringify(args)})`)), /already been consumed/i)

    await writeFile(join(signals, "grant"), JSON.stringify(next))
    assert.equal((await waitSignal(signals, "attached")).sessionID, child)
    await writeFile(join(signals, "release"), "true")
    const completed = await delayed
    assert.equal(completed?.attachment?.attached, true)
    assert.equal(completed?.result?.marker, "old-delayed-result")

    const evidence = await driver.run(child, 'return await tools.loom.code.evidence_observations({"detail":true})')
    const stale = evidence?.observations?.find((observation: any) => observation.tool.toLowerCase().includes("lifecycleprobe") && observation.tool.endsWith("delayed"))
    assert.ok(stale, `Host did not observe the controlled old operation: ${JSON.stringify(evidence)}`)
    assert.equal(stale.admission?.workflowId, old.workflowId)
    assert.equal(stale.workflowId, undefined)
    assert.equal(stale.stepId, undefined)
    const badProof = { workflowId: next.workflowId, stepId: "worker", kind: "runtime", statement: "Old result cannot prove replacement execution", observationIds: [stale.id] }
    const claim = await driver.run(child, `return await tools.loom.code.evidence_claim(${JSON.stringify(badProof)})`)
    assert.match(rejectionMessage(claim), /observations captured/i)
    const requirement = await driver.run(child, `return await tools.loom.code.verification(${JSON.stringify({ action: "require", workflowId: next.workflowId, beforeStepId: "review-implementation", kind: "runtime", statement: "Fresh replacement operation required" })})`)
    assert.ok(requirement?.requirement?.id)
    const prove = { action: "prove", workflowId: next.workflowId, requirementId: requirement.requirement.id, statement: "Observed real host operation", observationIds: [stale.id] }
    assert.match(rejectionMessage(await driver.run(child, `return await tools.loom.code.verification(${JSON.stringify(prove)})`)), /observations captured/i)

    assert.equal((await driver.run(child, 'return await tools.lifecycleprobe.normal({})'))?.marker, "new-normal-result")
    const freshEvidence = await driver.run(child, 'return await tools.loom.code.evidence_observations({"detail":true})')
    const fresh = freshEvidence?.observations?.find((observation: any) => observation.tool.toLowerCase().includes("lifecycleprobe") && observation.tool.endsWith("normal"))
    assert.equal(fresh?.workflowId, next.workflowId)
    assert.ok((await driver.run(child, `return await tools.loom.code.evidence_claim(${JSON.stringify({ ...badProof, statement: "Fresh host operation succeeded", observationIds: [fresh.id] })})`))?.claim)
    assert.equal((await driver.run(child, `return await tools.loom.code.verification(${JSON.stringify({ ...prove, observationIds: [fresh.id] })})`))?.proven, requirement.requirement.id)
    const oqParent = await driver.create("general")
    const oqChild = await driver.create("worker", oqParent)
    const oqSetup = await driver.run(oqParent, setupCode)
    assert.ok(oqSetup?.grantId, `OQ workflow/grant failed: ${JSON.stringify(oqSetup)}`)
    assert.equal(
      (await driver.run(
        oqChild,
        `return await tools.loom.code.attach(${JSON.stringify(oqSetup)})`,
      ))?.attached,
      true,
    )

    const raiseInput = {
      workflowId: oqSetup.workflowId,
      stepId: "worker",
      question: "Which exact mode should this Worker use?",
      responder: "user",
      blocking: true,
    }
    const raised = await driver.run(
      oqChild,
      `return await tools.loom.code.oq_raise(${JSON.stringify(raiseInput)})`,
    )
    assert.ok(raised?.question?.id, `Real-host OQ raise failed: ${JSON.stringify(raised)}`)

    const authoritativeAnswer = "Use strict mode from persisted OQ state."
    const answerInput = {
      workflowId: oqSetup.workflowId,
      questionId: raised.question.id,
      answer: authoritativeAnswer,
      source: "user",
    }
    const answered = await driver.run(
      oqParent,
      `return await tools.loom.code.oq_answer(${JSON.stringify(answerInput)})`,
    )
    assert.deepEqual(answered?.notifications, { notified: ["worker"], failed: [] })

    const wakePrompt = await driver.waitForPrompt(
      (prompt) => prompt.includes(`Loom OQ ${raised.question.id} has been answered.`),
    )
    assert.match(wakePrompt, /loom_oq_list/)
    assert.match(wakePrompt, /loom_oq_reconcile/)
    assert.equal(wakePrompt.includes(authoritativeAnswer), false)

    const listInput = {
      workflowId: oqSetup.workflowId,
      stepId: "worker",
    }
    const listed = await driver.run(
      oqChild,
      `return await tools.loom.code.oq_list(${JSON.stringify(listInput)})`,
    )
    assert.equal(
      listed?.questions?.find((question: any) => question.id === raised.question.id)?.answer?.text,
      authoritativeAnswer,
    )

    const activeOqParent = await driver.create("general")
    const activeOqChild = await driver.create("worker", activeOqParent)
    const activeOqSetup = await driver.run(activeOqParent, setupCode)
    assert.ok(activeOqSetup?.grantId, `Active OQ workflow/grant failed: ${JSON.stringify(activeOqSetup)}`)
    assert.equal(
      (await driver.run(
        activeOqChild,
        `return await tools.loom.code.attach(${JSON.stringify(activeOqSetup)})`,
      ))?.attached,
      true,
    )
    await rm(join(signals, "started"), { force: true })
    await rm(join(signals, "release"), { force: true })
    const activeTurn = await driver.run(activeOqChild, "return await tools.lifecycleprobe.delayed({})", false)
    try {
      assert.equal((await waitSignal(signals, "started")).sessionID, activeOqChild)
      const activeRaised = await driver.run(
        activeOqParent,
        `return await tools.loom.code.oq_raise(${JSON.stringify({
          workflowId: activeOqSetup.workflowId,
          question: "Which exact mode should this active Worker use?",
          responder: "user",
          blocking: true,
          consumerStepIds: ["worker"],
        })})`,
      )
      assert.ok(activeRaised?.question?.id, `Active real-host OQ raise failed: ${JSON.stringify(activeRaised)}`)
      const activeAnswered = await driver.run(
        activeOqParent,
        `return await tools.loom.code.oq_answer(${JSON.stringify({
          workflowId: activeOqSetup.workflowId,
          questionId: activeRaised.question.id,
          answer: "Use strict mode while the Worker is active.",
          source: "user",
        })})`,
      )
      assert.deepEqual(activeAnswered?.notifications, { notified: ["worker"], failed: [] })
      await writeFile(join(signals, "release"), "true")
      const activeSteerPrompt = await driver.waitForPrompt(
        (prompt) => prompt.includes(`Loom OQ ${activeRaised.question.id} has been answered.`),
      )
      assert.match(activeSteerPrompt, /loom_oq_list/)
      assert.match(activeSteerPrompt, /loom_oq_reconcile/)
    } finally {
      await writeFile(join(signals, "release"), "true")
      await activeTurn.wait()
    }

    console.log("PASS real-host OQ wake-up: persisted answer steers the attached Worker and the Worker re-reads authoritative OQ state")
    console.log("PASS real-host active OQ steer: answered OQ steers a Worker that already has an in-flight provider turn")
    console.log("PASS real-host lifecycle: cancelled Code Mode recovery, invalid/reused grants rejected, delayed old result denied as replacement claim/verification, fresh result accepted")
  } finally {
    // Unblock outstanding fixture calls on assertion failure; no orphan tasks.
    await writeFile(join(signals, "release"), "true")
    await writeFile(join(signals, "grant"), JSON.stringify({ workflowId: "cleanup-invalid", stepId: "worker", grantId: "cleanup-invalid" }))
    await Promise.allSettled([delayed])
  }
}
