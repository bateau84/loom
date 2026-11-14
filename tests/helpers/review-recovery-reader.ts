/** Public restored-state readback in a fresh process: no borrowed host environment. */
import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { registeredLoom } from "./registered-loom.js"

const [project, restoreHome, inputFile] = process.argv.slice(2)
assert(project && restoreHome && inputFile, "usage: bun review-recovery-reader.ts PROJECT STATE_HOME EXPECTED_JSON")
const { request, storeID, attemptID } = JSON.parse(readFileSync(inputFile, "utf8"))
const reader = await registeredLoom([], { directory: project, stateHome: restoreHome, versionedHost: true })
try {
  const loaded = (await reader.invoke("review", { operation: "read", request_id: request.request_id })).result
  assert.deepEqual(loaded.request.mandate, request.mandate)
  assert.deepEqual(loaded.members, request.members)
  assert.equal(loaded.namespace.store_id, storeID)
  assert.equal(loaded.issues.length, 1)
  const attempt = loaded.issues[0].attempt
  assert.equal(attempt.attempt_id, attemptID)
  assert.equal(attempt.state, "claimed")
  assert.equal(attempt.native_outcome, "unknown")
  assert.equal(loaded.relationships.length, 1)
  assert.equal(loaded.relationships[0].relationship, "finding")
  assert.equal(loaded.relationships[0].declared_verdict, "inconclusive")
  assert.deepEqual(loaded.relationships[0].review_binding, { status: "unknown", reason: "unsupported-host-boundary" })
  assert.equal(loaded.qualification.protected_delivery, "withheld")
  await assert.rejects(reader.invoke("review", { operation: "read", request_id: request.request_id }, "another-session"),
    /unavailable to this Session/)
  reader.permission.error = new Error("source-read-revoked")
  await assert.rejects(reader.invoke("review", { operation: "read", request_id: request.request_id }), /source-read-revoked/)
  reader.permission.error = undefined
  assert.deepEqual(reader.sessionPrompts, [])
  assert.deepEqual(reader.sessionCreates, [])
  process.stdout.write("PASS: restored review mandate, qualification, consumed intent and reader boundaries\n")
} finally { await reader.close() }
