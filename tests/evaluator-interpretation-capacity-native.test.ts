import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { EVALUATOR_INTERPRETATION_LIMITS, evaluatorInterpretationOriginals, evaluatorPublication } from "../src/evaluator-publication.js"
import { digest } from "../src/model.js"
import { RETROSPECTIVE_ORIGINAL_LIMITS, retrospectiveMemberKey, type RetrospectivePopulation } from "../src/retrospective-contract.js"
import type { RetrospectiveSourceResolver } from "../src/retrospective-populations.js"
import { ACTOR, openState } from "./helpers/evaluator-execution-fixture.js"
import { publicationFixture } from "./helpers/evaluator-publication-fixture.js"
import { retrospectiveFixture } from "./helpers/retrospective-store-fixture.js"

/** Controlled originals pass through the existing result/consumer/publication
 * path. Registered native owner controls are a separate composition suite. */
function setup() {
  const root = mkdtempSync(join(tmpdir(), "loom-interpretation-capacity-")), state = openState(join(root, "state"))
  const values = new Map<string, Record<string, unknown>>(), fixtures: ReturnType<typeof publicationFixture>[] = []
  let resolutions = 0, missing = false
  const resolve: RetrospectiveSourceResolver = async request => {
    resolutions++
    const value = values.get(request.source.id)
    return value && !missing ? { ...request, status: "available", value } : { ...request, status: "missing" }
  }
  return { state, count: () => resolutions, reset: () => { resolutions = 0 }, loseSources: () => { missing = true },
    fixture(name: string, count: number, sourcePrefix = name) {
      const manifest = retrospectiveFixture(count, state.store.reviews.storeID)
      manifest.contributors = [ACTOR.session_id]
      manifest.selection.question = "Controlled original-capacity boundary " + name
      manifest.members = manifest.members.map((member, index) => {
        const id = `https://github.com/fixture/evidence/blob/${"a".repeat(40)}/${sourcePrefix}-${index}.txt`
        const value = { format: "controlled-source/v1", original: sourcePrefix, index }
        values.set(id, value)
        const source = { kind: "external-ref", id, revision: "1", sha256: digest(value), required: true }
        const namespace = "github-controlled-owner", view = "github-original/v1"
        return { ...member, source_store_id: namespace, source, permitted_view: view,
          key: retrospectiveMemberKey(namespace, source, view) }
      })
      const fixture = publicationFixture(state, ACTOR, { manifest, resolve, authorityPath: join(root, name + ".sqlite") })
      fixtures.push(fixture)
      return fixture
    },
    close() { for (const fixture of fixtures) fixture.close(); state.close(); rmSync(root, { recursive: true, force: true }) } }
}

test("interpretation budget derives from existing selection/read and graph bounds; exact pins do not alias", () => {
  expect(RETROSPECTIVE_ORIGINAL_LIMITS.selection * 2 + RETROSPECTIVE_ORIGINAL_LIMITS.freezePage).toBe(RETROSPECTIVE_ORIGINAL_LIMITS.reads)
  expect(EVALUATOR_INTERPRETATION_LIMITS.originals).toBe(EVALUATOR_INTERPRETATION_LIMITS.reports * RETROSPECTIVE_ORIGINAL_LIMITS.selection)
  const manifest = retrospectiveFixture(1)
  const first = manifest.members[0]!
  first.source.kind = "external-ref"
  first.key = retrospectiveMemberKey(first.source_store_id, first.source, first.permitted_view)
  const population = { manifest } as RetrospectivePopulation
  const variants = [population, population, population]
  const optional = structuredClone(population)
  optional.manifest.members[0]!.source.required = false
  variants.push(optional)
  expect(evaluatorInterpretationOriginals(variants).size).toBe(1)
  for (const change of ["namespace", "view", "revision", "hash"] as const) {
    const copy = structuredClone(population), member = copy.manifest.members[0]!
    if (change === "namespace") member.source_store_id += "-other"
    if (change === "view") member.permitted_view += "-other"
    if (change === "revision") member.source.revision = "other"
    if (change === "hash") member.source.sha256 = "b".repeat(64)
    member.key = retrospectiveMemberKey(member.source_store_id, member.source, member.permitted_view)
    variants.push(copy)
  }
  expect(evaluatorInterpretationOriginals(variants).size).toBe(5)
  const gap = structuredClone(population)
  gap.manifest.members[0]!.availability = "unresolved"
  expect(evaluatorInterpretationOriginals([gap]).size).toBe(0)
})

test("1728 inherited originals publish and read; 1729 rejects before inherited validation or report writes", async () => {
  const f = setup()
  try {
    const first = f.fixture("first", 900)
    await first.execute()
    const prior = await first.publish()
    const revised = f.fixture("revised", 828)
    revised.interpretation.prior_interpretations.push({ report_id: prior.report_id, report_sha256: prior.report_sha256,
      relation: "contests", reason: "A separately pinned population qualifies the earlier interpretation." })
    await revised.execute()
    f.reset()
    const published = await revised.publish()
    // Existing execution recovery independently validates its current 828
    // originals before S5 admits and validates the complete 1728-source union.
    expect(f.count()).toBe(828 + 1728)
    f.reset()
    const reader = revised.reader(), input = { operation: "evaluation-interpretation", batch_id: published.batch_id }
    expect((await reader.read(ACTOR, input) as any).report_id).toBe(published.report_id)
    expect(f.count()).toBe(1728)
    f.reset()
    const list = await reader.read(ACTOR, { operation: "evaluation-interpretations", limit: 10 }) as any
    expect(list.items).toHaveLength(2)
    expect(f.count()).toBe(1728)

    const oversized = f.fixture("oversized", 829)
    oversized.interpretation.prior_interpretations.push({ report_id: prior.report_id, report_sha256: prior.report_sha256,
      relation: "contests", reason: "This union exceeds the complete bounded publication profile." })
    const completed = await oversized.execute()
    const history = f.state.learning.automatic.history
    const before = f.state.derived.query("SELECT COUNT(*) AS count FROM learning_evaluation_reports").get()
    f.reset()
    await expect(oversized.publish()).rejects.toThrow("exceeds 1728 unique pinned")
    expect(f.count()).toBe(829)
    expect(f.state.derived.query("SELECT COUNT(*) AS count FROM learning_evaluation_reports").get()).toEqual(before)
    expect(history.readEvaluatorInterpretation(oversized.prepared.batch_id, ACTOR.session_id)).toBeNull()
    // The synchronous persistence owner repeats admission even if its trusted
    // caller omitted the asynchronous service's capacity check.
    const original = await oversized.authority.readResult!(completed.admission, completed.receipt)
    const body = evaluatorPublication(completed.admission, completed.receipt, original, oversized.population)
    expect(() => history.publishEvaluatorInterpretation(oversized.prepared.batch_id, ACTOR.session_id, body)).toThrow("exceeds 1728 unique pinned")
    expect(f.state.derived.query("SELECT COUNT(*) AS count FROM learning_evaluation_reports").get()).toEqual(before)
    expect(oversized.base.counts().effects).toBe(1)

    // Invocation-local reuse cannot hide a source lost before a later read.
    f.loseSources(); f.reset()
    await expect(reader.read(ACTOR, input)).rejects.toThrow("source unavailable or changed")
    expect(f.count()).toBe(1)
  } finally { f.close() }
}, 60000)

test("individually admitted reports cannot return a partial list when their union exceeds capacity", async () => {
  const f = setup()
  try {
    let last: ReturnType<typeof publicationFixture> | undefined
    for (const name of ["first", "second"]) {
      const fixture = f.fixture(name, 900)
      await fixture.execute(); await fixture.publish()
      last = fixture
    }
    const reader = last!.reader()
    f.reset()
    await expect(reader.read(ACTOR, { operation: "evaluation-interpretations", limit: 2 })).rejects.toThrow("reduce the report-list limit")
    expect(f.count()).toBe(0)
    const page = await reader.read(ACTOR, { operation: "evaluation-interpretations", limit: 1 }) as any
    expect(page.items).toHaveLength(1)
    expect(f.count()).toBe(900)
    expect(page.navigation.next).not.toBeNull()
    f.reset()
    const next = await reader.read(ACTOR, page.navigation.next) as any
    expect(next.items).toHaveLength(1)
    expect(next.items[0].report_id).not.toBe(page.items[0].report_id)
    expect(f.count()).toBe(900)
  } finally { f.close() }
}, 60000)

test("the 32-report revision bound does not truncate a list of unrelated interpretations", async () => {
  const f = setup()
  try {
    let last: ReturnType<typeof publicationFixture> | undefined
    for (let index = 0; index < 33; index++) {
      const fixture = f.fixture("independent-" + index, 1)
      await fixture.execute(); await fixture.publish()
      last = fixture
    }
    f.reset()
    const page = await last!.reader().read(ACTOR, { operation: "evaluation-interpretations", limit: 100 }) as any
    expect(page.items).toHaveLength(33)
    expect(new Set(page.items.map((item: any) => item.report_id)).size).toBe(33)
    expect(f.count()).toBe(33)
  } finally { f.close() }
}, 60000)
