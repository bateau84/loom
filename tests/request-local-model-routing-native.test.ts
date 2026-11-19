import { describe, expect, test } from "bun:test"
import { defaults, mergeConfig } from "../src/config.js"
import {
  registerRequestLocalModelSelectionCandidate,
  type RequestLocalCandidateSource,
} from "../src/request-local-model-routing.js"

type Input = Awaited<ReturnType<RequestLocalCandidateSource>>
type Ref = { providerID: string; id: string; variant?: string }
type Event = { sessionID: string; agent: string; kind: "primary" | "title" | "compaction" | "generate"; model: Ref }

function input(riskFactors: Input["assignment"]["riskFactors"] = []): Input {
  return {
    snapshot: {
      config: mergeConfig(defaults(), {
        "model-routing": { enabled: true, "default-class": "standard", "default-reasoning": "medium" },
        "model-classes": {
          standard: { models: ["fast"] }, advanced: { models: ["sol"] }, frontier: { models: ["astra"] },
        },
        agents: { architect: { roles: ["architecture"] } },
        roles: { architecture: {
          "model-class": "standard", reasoning: "medium", "workload-tiers": {
            advanced: { "model-class": "advanced", reasoning: "high" },
            frontier: { "model-class": "frontier", reasoning: "high" },
          },
        } },
      }),
      errors: [], sources: ["private-fixture"],
    },
    inventory: ["fast", "sol", "astra"].map(modelID => ({
      providerID: "local", modelID, enabled: true, tools: true,
      billing: "included", quota: "available", reasoning: ["medium", "high"],
    })),
    assignment: {
      assignmentId: "fixture-work", objectiveId: "fixture-objective", boundary: "new-assignment",
      riskFactors, assessment: { status: "assessed", confidence: "high", sourceRef: "fixture-only" },
      quality: { minimumTier: "standard", minimumReasoning: "low", independence: "required" },
      spending: "included-only",
    },
  }
}

function fixture() {
  const hooks = new Map<string, (event: Event) => Promise<void>>()
  const sessions = new Map<string, { id: string; agent?: string; model?: Ref }>([
    ["s1", { id: "s1", agent: "architect" }], ["s2", { id: "s2", agent: "architect" }],
  ])
  const inputs = new Map<string, Input>([["s1", input()], ["s2", input(["authority"])]])
  const reads: Parameters<RequestLocalCandidateSource>[0][] = []
  const registrations: Array<{ dispose(): Promise<void> }> = []
  const controller = new AbortController()
  // Mocked native callbacks. Actual host/transport proof belongs to the
  // separate installed_request_local_routing.py suite, not these assertions.
  const ctx: any = {
    app: { version: "2.3.0" },
    session: {
      get: async ({ sessionID }: { sessionID: string }) => sessions.get(sessionID),
      hook: async (name: string, callback: (event: Event) => Promise<void>) => {
        hooks.set(name, callback)
        return { dispose: async () => { hooks.delete(name) } }
      },
    },
  }
  const load: RequestLocalCandidateSource = async request => {
    reads.push(request)
    const value = inputs.get(request.sessionID)
    if (!value) throw new Error("Fixture has no workload for this Session")
    return value
  }
  return {
    ctx, hooks, sessions, inputs, reads, registrations, controller,
    install: (source = load) => registerRequestLocalModelSelectionCandidate(ctx, source, registrations, controller.signal),
    resolve: (event: Event) => hooks.get("experimental.model.resolve")!(event),
    request: (event: Event) => hooks.get("model.request")!(event),
  }
}

function event(sessionID = "s1", kind: Event["kind"] = "primary", model: Ref = { providerID: "local", id: "native-default" }): Event {
  return { sessionID, agent: kind === "primary" || kind === "generate" ? "architect" : kind, kind, model }
}
const selected = (id = "fast", variant = "medium"): Ref => ({ providerID: "local", id, variant })

describe("request-local selection candidate (mocked native boundaries, not billing proof)", () => {
  test("replaces the whole request ref, preserving native defaults and stored selection", async () => {
    const f = fixture()
    await f.install()
    const request = event()
    const original = request.model
    await f.resolve(request)
    expect(request.model).toEqual(selected())
    expect(request.model).not.toBe(original)
    expect(original).toEqual({ providerID: "local", id: "native-default" })
    expect(f.sessions.get("s1")!.model).toBeUndefined()
    await f.request(request)
    expect([...f.hooks.keys()]).toEqual(["model.request", "experimental.model.resolve"])
    expect(Object.keys(f.reads[0]).sort()).toEqual(["agent", "kind", "sessionID"])
  })

  test("concurrent workloads of the same agent cannot overwrite each other's tier", async () => {
    const f = fixture()
    await f.install()
    const low = event("s1"), high = event("s2")
    await Promise.all([f.resolve(high), f.resolve(low)])
    expect(low.model).toEqual(selected())
    expect(high.model).toEqual(selected("astra", "high"))
    await Promise.all([f.request(low), f.request(high)])
    await f.resolve(event("s1"))
    await f.request(high)
  })

  test("utility ownership uses the native Session; validation needs no one-shot resolve receipt", async () => {
    const f = fixture()
    await f.install()
    for (const kind of ["title", "compaction", "generate"] as const) {
      // A native compaction can reuse the primary model without its own resolve.
      await f.request(event("s1", kind, selected()))
      await f.resolve(event("s1", kind))
      await f.resolve(event("s1", kind)) // speculative candidates need no consumption
      await f.request(event("s1", kind, selected()))
      await f.request(event("s1", kind, selected()))
    }
    expect(f.reads.every(row => row.agent === "architect")).toBe(true)
    expect(f.sessions.get("s1")!.model).toBeUndefined()
  })

  test("compatible explicit choice is preserved; every conflicting dimension is denied", async () => {
    const f = fixture()
    await f.install()
    f.sessions.get("s1")!.model = selected()
    const request = event("s1", "primary", selected())
    await f.resolve(request)
    await f.request(request)
    expect(f.sessions.get("s1")!.model).toEqual(selected())
    for (const conflict of [selected("sol"), selected("fast", "high"),
      { ...selected(), providerID: "another" }, { providerID: "local", id: "fast" }]) {
      f.sessions.get("s1")!.model = conflict
      await expect(f.resolve(event())).rejects.toThrow("LOOM_REQUEST_LOCAL_EXPLICIT_CHOICE")
      await expect(f.request(event("s1", "primary", selected()))).rejects.toThrow("LOOM_REQUEST_LOCAL_EXPLICIT_CHOICE")
      expect(f.sessions.get("s1")!.model).toEqual(conflict)
    }
  })

  test("selected provider mismatch denies rather than filtering the planner into a lesser route", async () => {
    const f = fixture()
    await f.install()
    const request = event("s1", "primary", { providerID: "other", id: "native" })
    await expect(f.resolve(request)).rejects.toThrow("LOOM_REQUEST_LOCAL_PROVIDER_MISMATCH")
    expect(request.model).toEqual({ providerID: "other", id: "native" })
  })

  test("actual route validation catches later resolver changes to model, provider or variant", async () => {
    const f = fixture()
    await f.install()
    for (const actual of [selected("sol"), selected("fast", "high"),
      { ...selected(), providerID: "other" }, { providerID: "local", id: "fast" }]) {
      const request = event()
      await f.resolve(request)
      request.model = actual
      await expect(f.request(request)).rejects.toThrow("LOOM_MODEL_ROUTE_MISMATCH")
    }
  })

  test("fresh policy or eligibility can deny an already resolved request", async () => {
    const f = fixture()
    await f.install()
    const request = event()
    await f.resolve(request)
    f.inputs.set("s1", input(["complex"]))
    await expect(f.request(request)).rejects.toThrow("LOOM_MODEL_ROUTE_MISMATCH")
    const exhausted = input()
    exhausted.inventory = exhausted.inventory.map(row => ({ ...row, quota: "exhausted" }))
    f.inputs.set("s1", exhausted)
    await expect(f.request(request)).rejects.toThrow("LOOM_REQUEST_LOCAL_UNAVAILABLE")
  })

  test("missing reasoning, unknown/metered billing and uncertain assessment cannot become a route", async () => {
    const f = fixture()
    await f.install()
    const noVariant = input(["authority"])
    noVariant.inventory = noVariant.inventory.map(row => ({ ...row, reasoning: ["medium"] }))
    const unknown = input(), metered = input(), uncertain = input(), noQuality = input()
    unknown.inventory = unknown.inventory.map(row => ({ ...row, billing: "unknown" }))
    metered.inventory = metered.inventory.map(row => ({ ...row, billing: "metered" }))
    metered.snapshot.config.modelRouting.paidFallback = true
    uncertain.assignment.assessment = undefined
    noQuality.assignment.quality = undefined
    for (const value of [noVariant, unknown, metered, uncertain, noQuality]) {
      f.inputs.set("s1", value)
      await expect(f.resolve(event())).rejects.toThrow("LOOM_REQUEST_LOCAL_UNAVAILABLE")
      await expect(f.request(event("s1", "primary", selected()))).rejects.toThrow("LOOM_REQUEST_LOCAL_UNAVAILABLE")
    }
  })

  test("disabled or unreadable source cannot turn registered managed guards into pass-through", async () => {
    const f = fixture()
    await f.install()
    const disabled = input()
    disabled.snapshot.config.modelRouting.enabled = false
    f.inputs.set("s1", disabled)
    await expect(f.resolve(event())).rejects.toThrow("LOOM_REQUEST_LOCAL_UNAVAILABLE")
    await expect(f.request(event("s1", "primary", selected()))).rejects.toThrow("LOOM_REQUEST_LOCAL_UNAVAILABLE")
    disabled.snapshot.errors = ["invalid fixture policy"]
    await expect(f.resolve(event())).rejects.toThrow("LOOM_REQUEST_LOCAL_CONFIG_UNREADABLE")
    await expect(f.request(event("s1", "primary", selected()))).rejects.toThrow("LOOM_REQUEST_LOCAL_CONFIG_UNREADABLE")
  })

  test("missing Session, changed owner, or unreadable choice fails closed before a rewrite", async () => {
    for (const info of [undefined, { id: "wrong", agent: "architect" },
      { id: "s1" }, { id: "s1", agent: "another-agent" }]) {
      const f = fixture()
      f.ctx.session.get = async () => info
      await f.install()
      const request = event()
      await expect(f.resolve(request)).rejects.toThrow("LOOM_REQUEST_LOCAL_CONTEXT_UNAVAILABLE")
      expect(request.model.id).toBe("native-default")
      expect(f.reads).toHaveLength(0)
    }
    const f = fixture()
    f.ctx.session.get = async () => { throw new Error("native read failed") }
    await f.install()
    await expect(f.resolve(event())).rejects.toThrow("native read failed")
    await expect(f.request(event("s1", "primary", selected()))).rejects.toThrow("native read failed")
  })

  test("generate binds the selected native agent to its Session owner just like primary", async () => {
    const f = fixture()
    await f.install()
    // A native generate request prepares the owner's instructions and tools;
    // it must not borrow another owner's workload after a concurrent switch.
    f.sessions.get("s1")!.agent = "new-owner"
    const request = event("s1", "generate")
    await expect(f.resolve(request)).rejects.toThrow("LOOM_REQUEST_LOCAL_CONTEXT_UNAVAILABLE")
    await expect(f.request({ ...request, model: selected() })).rejects.toThrow("LOOM_REQUEST_LOCAL_CONTEXT_UNAVAILABLE")
    expect(request.model.id).toBe("native-default")
    expect(f.reads).toHaveLength(0)
  })

  test("source removal after hook re-registration never reuses a previous selection", async () => {
    const f = fixture()
    await f.install()
    await f.resolve(event())
    for (const registration of f.registrations) await registration.dispose()
    f.inputs.delete("s1")
    await f.install()
    await expect(f.resolve(event())).rejects.toThrow("no workload")
    await expect(f.request(event("s1", "primary", selected()))).rejects.toThrow("no workload")
  })

  test("cancellation during a source read prevents late mutation or dispatch acceptance", async () => {
    const f = fixture()
    let release!: (value: Input) => void
    let entered!: () => void
    const reading = new Promise<void>(resolve => { entered = resolve })
    await f.install(async () => { entered(); return new Promise<Input>(resolve => { release = resolve }) })
    const request = event()
    const resolving = f.resolve(request)
    await reading
    f.controller.abort(new Error("fixture cancellation"))
    release(input())
    await expect(resolving).rejects.toThrow("fixture cancellation")
    expect(request.model.id).toBe("native-default")
    await expect(f.request(event("s1", "primary", selected()))).rejects.toThrow("fixture cancellation")
  })

  for (const hook of ["resolve", "request"] as const) {
    for (const termination of ["dispose", "abort"] as const) {
      test(`${hook} rejects ${termination} after evaluation but before its await continuation`, async () => {
        const f = fixture()
        const value = input()
        const order: string[] = []
        let disposal: Promise<void> | undefined
        await f.install(async () => {
          // The first microtask precedes current()'s load continuation. It
          // queues termination after synchronous planning, but before the
          // outer hook resumes from await current(). No sleeps or host mocks
          // of the private current() helper are needed to hit this boundary.
          queueMicrotask(() => queueMicrotask(() => {
            order.push(termination)
            if (termination === "dispose") disposal = f.registrations[0].dispose()
            else f.controller.abort(new Error("fixture boundary abort"))
          }))
          return { ...value, get inventory() {
            order.push("evaluate")
            return value.inventory
          } }
        })
        const request = hook === "resolve" ? event() : event("s1", "primary", selected())
        const original = request.model
        const error = await f[hook](request).then(
          () => { order.push("accepted"); return undefined },
          cause => { order.push("rejected"); return cause as Error },
        )
        await disposal
        expect(order).toEqual(["evaluate", termination, "rejected"])
        expect(error).toBeInstanceOf(Error)
        expect(error!.message).toContain(termination === "dispose"
          ? "LOOM_REQUEST_LOCAL_NOT_READY" : "fixture boundary abort")
        expect(request.model).toBe(original)
      })
    }
  }

  test("unknown host versions never install selection hooks", async () => {
    for (const version of ["2.2.6", "2.3.1", "2.3.0-dev", undefined]) {
      const f = fixture()
      f.ctx.app.version = version
      await expect(f.install()).rejects.toThrow("LOOM_REQUEST_LOCAL_HOST_UNQUALIFIED")
      expect(f.hooks.size).toBe(0)
      expect(f.reads).toHaveLength(0)
    }
  })

  test("resolver registration failure retains a not-ready guard; disposal fences retained callbacks", async () => {
    const f = fixture()
    const register = f.ctx.session.hook
    f.ctx.session.hook = async (name: string, callback: (event: Event) => Promise<void>) => {
      if (name === "experimental.model.resolve") throw new Error("fixture registration failure")
      return register(name, callback)
    }
    await expect(f.install()).rejects.toThrow("fixture registration failure")
    expect(f.hooks.size).toBe(1)
    await expect(f.request(event())).rejects.toThrow("LOOM_REQUEST_LOCAL_NOT_READY")

    const healthy = fixture()
    await healthy.install()
    const retained = healthy.hooks.get("experimental.model.resolve")!
    for (const registration of healthy.registrations) await registration.dispose()
    await expect(retained(event())).rejects.toThrow("LOOM_REQUEST_LOCAL_NOT_READY")
    expect(healthy.hooks.size).toBe(0)
  })
})
