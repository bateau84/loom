import { test, expect, spyOn } from "bun:test"
import { Database } from "bun:sqlite"
import { defaults } from "../src/config.js"
import { Learning } from "../src/learning.js"
import { Store } from "../src/store.js"
import { registerAutomaticLearning } from "../src/learning-runtime.js"
import { INCREMENTAL_SCOPE } from "../src/automatic-learning.js"

async function until(check: () => boolean, label: string, timeout = 5000) {
  const deadline = Date.now() + timeout
  while (!check()) { if (Date.now() >= deadline) throw new Error("Timed out: " + label); await new Promise(r => setTimeout(r, 5)) }
}
async function fixture(callbacks: { onIncrement?: () => Promise<void>; onCatchUp?: () => Promise<void> } = {}) {
  const ledger = new Database(":memory:"), db = new Database(":memory:"), store = new Store(ledger), learning = new Learning(db, store, ledger)
  const actor = { session_id: "session", agent: "ordinary-agent" }, config = defaults(), hooks = new Map<string, (input: any) => Promise<void>>()
  config.learning.coalesce_ms = 10; config.learning.max_sources = 2
  const permissions: unknown[] = [], warnings: unknown[] = [], signal = new AbortController()
  const runtime = await registerAutomaticLearning({
    session: { hook: async (name: string, callback: any) => { hooks.set(name, callback); return { dispose: async () => { hooks.delete(name) } } } },
    permission: { assert: async (input: unknown) => { permissions.push(input) } },
  } as any, { learning, ledgerPath: "ledger", learningPath: "learning", signal: signal.signal,
    getConfig: async () => ({ config, errors: [], sources: [] }), checkedSession: async id => ({ id, agent: actor.agent }),
    warn: error => warnings.push(error), onIncrement: callbacks.onIncrement, onCatchUp: callbacks.onCatchUp })
  const idle = () => learning.automatic.history.opportunity(actor.session_id)?.state === "idle"
  return { ledger, db, store, learning, actor, config, hooks, permissions, warnings, runtime, signal, idle,
    close: async () => { await runtime.dispose(); db.close(); ledger.close() } }
}

test("existing scheduler coalesces many work/idle events, catches up at startup, and inference failure cannot stop deterministic increments", async () => {
  let interpretations = 0, reconciliations = 0
  const f = await fixture({ onIncrement: async () => { interpretations++; throw new Error("quota exhausted") }, onCatchUp: async () => { reconciliations++ } })
  try {
    for (let i = 0; i < 5; i++) f.store.record(f.actor, undefined, { kind: "result", statement: "Prior recorded work " + i })
    f.runtime.start()
    for (let i = 0; i < 100; i++) { f.runtime.notify(f.actor.session_id); await f.hooks.get("experimental.idle")!({ sessionID: f.actor.session_id }) }
    await until(f.idle, "startup source catch-up")
    expect(f.learning.automatic.history.listScope(f.actor.session_id, INCREMENTAL_SCOPE).items).toHaveLength(3)
    expect(interpretations).toBe(3)
    expect(f.warnings).toContain("Incremental interpretation unavailable; deterministic source processing continues")
    const previous = interpretations
    for (let i = 0; i < 10; i++) await f.hooks.get("experimental.idle")!({ sessionID: f.actor.session_id })
    await until(() => reconciliations >= 2, "unchanged opportunity reconciliation")
    await until(f.idle, "unchanged idle settlement")
    expect(interpretations).toBe(previous)
    expect(f.learning.automatic.history.listScope(f.actor.session_id, INCREMENTAL_SCOPE).items).toHaveLength(3)
    expect(f.ledger.query("SELECT COUNT(*) AS n FROM ledger").get()).toEqual({ n: 5 })
    expect(f.permissions.length).toBeGreaterThan(0)
  } finally { await f.close() }
})

test("continued active notifications do not postpone the first processing opportunity indefinitely", async () => {
  const f = await fixture()
  let timer: ReturnType<typeof setInterval> | undefined
  try {
    f.config.learning.coalesce_ms = 80
    f.store.record(f.actor, undefined, { kind: "concern", statement: "Finding during prolonged active work" })
    timer = setInterval(() => f.runtime.notify(f.actor.session_id), 10)
    f.runtime.notify(f.actor.session_id)
    await until(() => f.learning.automatic.history.latestInScope(f.actor.session_id, INCREMENTAL_SCOPE, true) !== null, "bounded coalescing while work continues")
    expect(f.learning.automatic.history.latestInScope(f.actor.session_id, INCREMENTAL_SCOPE, true)!.report_id).not.toBeNull()
    expect(f.runtime.status().automatic_model_calls).toBe(false)
  } finally { if (timer) clearInterval(timer); await f.close() }
})

test("a blocked source failure settles the opportunity without a busy loop and retries only on a later opportunity", async () => {
  const f = await fixture()
  try {
    const original = f.store.record(f.actor, undefined, { kind: "result", statement: "Original retained source" })
    const resolve = f.learning.automatic.sources.resolve.bind(f.learning.automatic.sources)
    const failure = spyOn(f.learning.automatic.sources, "resolve").mockImplementation((ref, ns) => ref.id === original.id ? null : resolve(ref, ns))
    f.runtime.notify(f.actor.session_id)
    await until(() => f.learning.automatic.history.opportunity(f.actor.session_id)?.state === "blocked", "blocked queue settlement")
    const calls = failure.mock.calls.length
    await new Promise(r => setTimeout(r, 80))
    expect(failure.mock.calls.length).toBe(calls)
    failure.mockRestore()
    f.runtime.notify(f.actor.session_id)
    await until(f.idle, "restored original retry")
    expect(f.learning.automatic.history.listScope(f.actor.session_id, INCREMENTAL_SCOPE).items).toHaveLength(1)
    expect(f.learning.automatic.history.latestInScope(f.actor.session_id, INCREMENTAL_SCOPE, true)).not.toBeNull()
  } finally { await f.close() }
})
