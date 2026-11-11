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

test("dated pre-outcome instruction fingerprints remain eligible in trends, but origin independence is not certified", async () => {
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
      await Bun.sleep(3)
      f.link(obj.id,"outcome",f.source("Reported verified result "+i).id)
    }
    const at = nowAfterSource()
    const compared = f.learning.trends.compare({operation:"compare",population:"all-linked",
      since_at:new Date(Date.now()-86400000).toISOString(),until_at:at,as_of_at:at,
      group_by:"instruction-fingerprint",limit:20})
    expect(compared.items.map(x=>x.objective_id)).toEqual(ids)
    expect(compared.items.every(x=>x.instruction_observations.total===1 &&
      x.instruction_observations.excluded_at_or_after_outcome===0)).toBe(true)
    expect(compared.population.origin_independence.status).toBe("unqualified")
    expect(f.learning.proactive.consider(at)).toEqual([])
    expect(f.learning.proactive.list().independent_pattern_qualification.status).toBe("unqualified")
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

test("full-population positive observation remains queryable beyond page one without an independence claim", async () => {
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
      await Bun.sleep(3)
      f.link(obj.id,"outcome",f.source("Final authored pass "+i).id)
    }
    const at=nowAfterSource()
    const compared=f.learning.trends.compare({operation:"compare",population:"all-linked",
      since_at:new Date(Date.now()-86400000).toISOString(),until_at:at,as_of_at:at,
      group_by:"instruction-fingerprint",limit:20})
    expect(compared.population.eligible_objectives).toBe(25)
    expect(compared.groups.some(g=>g.metrics.reported_pass_without_correction===3)).toBe(true)
    expect(compared.next_cursor).not.toBeNull()
    const second=f.learning.trends.compare({operation:"compare",population:"all-linked",
      since_at:new Date(Date.now()-86400000).toISOString(),until_at:at,as_of_at:at,
      group_by:"instruction-fingerprint",limit:20,cursor:compared.next_cursor!})
    expect(second.items.map(x=>x.objective_id)).toEqual(sources)
    expect(f.learning.proactive.consider(at)).toEqual([])
  } finally { f.close() }
})

test("three passes and five failures under the same observed fingerprint cannot be retained practice", async () => {
  const f = fixture()
  try {
    const fingerprint = hash("mixed-cohort-instruction")
    for (let i = 0; i < 8; i++) {
      const request = f.source("Goal "+i)
      const obj = f.learning.objectives.create(actor,f.learning.objectives.ledgerSource(request.id),"Goal "+i)
      const observation = f.store.observe(actor,undefined,{
        phase:"skill-load-result",skill_id:"same-instruction",rendered_sha256:fingerprint,
      })
      f.link(obj.id,"coordination",observation.id)
      await Bun.sleep(3) // Real source chronology, not fixture-forged timestamps.
      const result = f.source("Final outcome "+i)
      f.learning.objectives.link(actor,{
        objective_id:obj.id,phase:"outcome",source:f.learning.objectives.ledgerSource(result.id),
        assessment:i<3?"pass":"fail",
      })
    }
    const at = nowAfterSource()
    const comparison = f.learning.trends.compare({operation:"compare",population:"all-linked",
      since_at:new Date(Date.now()-86400000).toISOString(),until_at:at,as_of_at:at,
      group_by:"instruction-fingerprint",limit:20})
    const cohort = comparison.groups.find(g=>g.key.includes(fingerprint))
    expect(cohort?.metrics.reported_pass_without_correction).toBe(3)
    expect(cohort?.metrics.reported_fail).toBe(5)
    expect(f.learning.proactive.consider(at)).toEqual([])
  } finally { f.close() }
})

test("instruction observed after passing outcome is excluded by the production trend reader", async () => {
  const f = fixture()
  try {
    const fingerprint = hash("post-outcome-instruction")
    for (let i=0;i<3;i++) {
      const request = f.source("Earlier goal "+i)
      const obj = f.learning.objectives.create(actor,f.learning.objectives.ledgerSource(request.id),"Earlier goal "+i)
      f.link(obj.id,"outcome",f.source("Before the observation "+i).id)
      await Bun.sleep(3)
      const observation = f.store.observe(actor,undefined,{
        phase:"skill-load-result",skill_id:"later-instruction",rendered_sha256:fingerprint,
      })
      f.link(obj.id,"coordination",observation.id)
    }
    const at=nowAfterSource()
    const comparison=f.learning.trends.compare({operation:"compare",population:"all-linked",
      since_at:new Date(Date.now()-86400000).toISOString(),until_at:at,as_of_at:at,
      group_by:"instruction-fingerprint",limit:20})
    expect(comparison.groups.some(g=>g.key.includes(fingerprint))).toBe(false)
    expect(comparison.items.every(item=>item.instruction_observations.total===0 &&
      item.instruction_observations.excluded_at_or_after_outcome>0)).toBe(true)
    expect(f.learning.proactive.consider(at)).toEqual([])
  } finally { f.close() }
})

test("undated outcomes and observations never inherit link-insertion chronology", async () => {
  const f = fixture()
  try {
    const request=f.source("Undated original")
    const obj=f.learning.objectives.create(actor,f.learning.objectives.ledgerSource(request.id),"Undated original")
    const observation=f.store.observe(actor,undefined,{
      phase:"skill-load-result",skill_id:"chronology-probe",rendered_sha256:hash("chronology-probe"),
    })
    f.link(obj.id,"coordination",observation.id)
    await Bun.sleep(3)
    f.learning.objectives.link(actor,{
      objective_id:obj.id,phase:"outcome",
      source:{type:"external-ref",id:"https://example.com/undated-source",verification:"declared-external"},
      assessment:"pass",
    })
    const at=nowAfterSource()
    const comparison=f.learning.trends.compare({operation:"compare",population:"all-linked",
      since_at:new Date(Date.now()-86400000).toISOString(),until_at:at,as_of_at:at,limit:20})
    expect(comparison.items[0]?.outcome).toBe("unknown")
    expect(comparison.items[0]?.chronology.undated_outcomes).toBe(1)
    expect(comparison.items[0]?.instruction_observations.total).toBe(0)
    expect(f.learning.proactive.consider(at)).toEqual([])
  } finally { f.close() }
})

test("one original request with three distinct corrective-ledger anchors does not produce three independent episodes", () => {
  const f=fixture()
  try {
    const original=f.source("The one actual user request")
    const anchored=f.learning.objectives.create(actor,f.learning.objectives.ledgerSource(original.id),
      "Canonical original engineering goal")
    const attempts: string[]=[]
    for (let i=0;i<3;i++) {
      const attempt=f.source("Corrective attempt "+i+" for the same original request")
      const separate=f.learning.objectives.create(actor,f.learning.objectives.ledgerSource(attempt.id),
        "Incorrectly separated attempt "+i)
      attempts.push(separate.id)
      // Explicitly link all three attempts back to the same original source;
      // that evidence is not a certification of three independent user goals.
      f.learning.objectives.link(actor,{objective_id:separate.id,phase:"request",
        source:f.learning.objectives.ledgerSource(original.id)})
      const first=f.learning.objectives.read(separate.id).entries[0]!
      f.link(separate.id,"corrective-dispatch",f.source("Fix "+i).id,first.sequence)
      f.link(separate.id,"outcome",f.source("Attributed output "+i).id)
    }
    const at=nowAfterSource()
    const compared=f.learning.trends.compare({operation:"compare",population:"all-linked",
      since_at:new Date(Date.now()-86400000).toISOString(),until_at:at,as_of_at:at,
      limit:20})
    expect(compared.metrics.with_documented_correction).toBe(3)
    expect(compared.population.origin_independence.status).toBe("unqualified")
    expect(compared.population.eligible_objectives).toBe(4)
    expect(f.learning.proactive.consider(at)).toEqual([])
    expect(f.learning.proactive.list().items).toEqual([])
    expect(new Set(attempts).size).toBe(3)
    expect(anchored.id).toBeDefined()
  } finally { f.close() }
})
