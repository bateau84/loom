import { Database } from "bun:sqlite"
import { EvaluationStore } from "../../src/evaluation-store.js"
import type { SQL } from "../../src/store.js"
import { retrospectiveActor, retrospectiveFixture } from "./retrospective-store-fixture.js"

const [path, mode, populationID] = process.argv.slice(2)
if (!path || !mode) throw new Error("Expected database path and operation")
const db = new Database(path)
let armed = false
const sql: SQL = {
  exec(query) {
    const result = db.exec(query)
    if (armed && mode === "after-commit" && query === "COMMIT") process.kill(process.pid, "SIGKILL")
    return result
  },
  prepare(query) {
    const prepared = db.prepare(query)
    return {
      get: (...args) => prepared.get(...args), all: (...args) => prepared.all(...args),
      run(...args) {
        const result = prepared.run(...args)
        if (armed && mode === "during-members" && query.startsWith("INSERT INTO learning_retrospective_members")) process.kill(process.pid, "SIGKILL")
        return result
      },
    }
  },
}
try {
  const store = new EvaluationStore(sql, () => { throw new Error("Synchronous original resolution must not run") })
  armed = true
  const saved = mode === "read" && populationID ? store.retrospectivePopulation(populationID, retrospectiveActor.session_id)
    : store.freezeRetrospective(retrospectiveActor, retrospectiveFixture())
  process.stdout.write(JSON.stringify(saved))
} finally { db.close(true) }
