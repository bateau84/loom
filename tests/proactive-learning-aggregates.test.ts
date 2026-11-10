import { test, expect } from "bun:test"
import { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import { Store } from "../src/store.js"
import { Learning } from "../src/learning.js"

const actor = { session_id: "source-linked-fixture", agent: "author" }
const hash = (text: string) => createHash("sha256").update(text).digest("hex")
const nowAfterSource = () => new Date(Date.now()+1000).toISOString()
function fixture() {
  const actionDB = new Database(":memory:")
  const learningDB = new Database(":memory:")
  const store = new Store(actionDB)
  const learning = new Learning(learningDB,store,actionDB)
  const source = (statement: string) =>
    store.record(actor,undefined,{kind:"result",statement})
  const link = (id: string, phase: "outcome"|"coordination"|"corrective-dispatch",
    original: string, related_sequence?: number) =>
    learning.objectives.link(actor,{
      objective_id:id,phase,source:learning.objectives.ledgerSource(original),
      ...(phase === "outcome" ? {assessment:"pass" as const} : {}),
      ...(related_sequence ? {related_sequence} : {}),
    })
  const close = () => { learningDB.close(); actionDB.close() }
  return {store,learning,source,link,close}
}

test("positive learning identifies source-linked repeat success with one exact historical skill fingerprint", () => {
  const f = fixture()
  try {
    const ids: string[] = []
    for (let i=0;i<3;i++) {
      const request = f.source("Independent original goal "+i)
      const obj = f.learning.objectives.create(actor,f.learning.objectives.ledgerSource(request.id),
        "Independent goal "+i)
      ids.push(obj.id)
      const observation = f.store.observe(actor,undefined,{
        phase: "skill-load-result", skill_id: "working-safeguard",
        rendered_sha256:hash("unchanged exact working skill"),
      })
      f.link(obj.id,"coordination",observation.id)
      f.link(obj.id,"outcome",f.source("Reported verified result "+i).id)
    }
    const found = f.learning.proactive.consider(nowAfterSource())
    expect(found).toHaveLength(1)
    expect(found[0].kind).toBe("retained-practice")
    expect(found[0].source_refs.map(ref=>ref.objective_id)).toEqual(ids)
    expect(found[0].matching_objectives).toBe(3)
    expect(found[0].interpretation).toContain("positive association")
    expect(f.learning.proactive.consider(nowAfterSource())).toEqual([])
  } finally { f.close() }
})

test("three authored objectives sharing one original request do not prove three independent incidents", () => {
  const f = fixture()
  try {
    const request = f.source("One originating user request with three linked work fragments")
    for (let i=0;i<3;i++) {
      const obj = f.learning.objectives.create(actor,f.learning.objectives.ledgerSource(request.id),
        "Part "+i,"subgoal-"+i)
      const first = f.learning.objectives.read(obj.id).entries[0]
      f.link(obj.id,"corrective-dispatch",f.source("Retry "+i).id,first.sequence)
      f.link(obj.id,"outcome",f.source("Reported final pass "+i).id)
    }
    const trends = f.learning.trends.compare({operation:"compare",population:"all-linked",
      since_at:new Date(Date.now()-86400000).toISOString(),
      until_at:nowAfterSource(),as_of_at:nowAfterSource(),limit:20})
    expect(trends.metrics.with_documented_correction).toBe(3)
    expect(trends.correlation.shared_origin_groups).toBe(1)
    expect(f.learning.proactive.consider(nowAfterSource())).toEqual([])
    expect(f.learning.proactive.list().items).toHaveLength(0)
  } finally { f.close() }
})

test("proactive retained-practice sample traverses a frozen population beyond the first 20 objectives", () => {
  const f = fixture()
  try {
    for (let i=0;i<22;i++) {
      const request = f.source("Open objective, missing final evidence "+i)
      f.learning.objectives.create(actor,f.learning.objectives.ledgerSource(request.id),
        "Unknown outcome "+i)
    }
    const sources: string[] = []
    for (let i=0;i<3;i++) {
      const request = f.source("Original positive goal "+i)
      const obj = f.learning.objectives.create(actor,f.learning.objectives.ledgerSource(request.id),
        "Positive goal "+i)
      sources.push(obj.id)
      const observation = f.store.observe(actor,undefined,{
        phase:"skill-load-result",skill_id:"working-safeguard",
        rendered_sha256:hash("working treatment"),
      })
      f.link(obj.id,"coordination",observation.id)
      f.link(obj.id,"outcome",f.source("Final authored pass "+i).id)
    }
    const found = f.learning.proactive.consider(nowAfterSource())
    expect(found).toHaveLength(1)
    expect(found[0].kind).toBe("retained-practice")
    expect(found[0].population).toBe(25)
    expect(found[0].source_refs.map(ref=>ref.objective_id)).toEqual(sources)
  } finally { f.close() }
})
