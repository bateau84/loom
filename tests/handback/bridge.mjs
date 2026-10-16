/** Experimental handback selector. Not imported by the production plugin.
 * Tests supply observed native-call/cancellation facts; this is not a detector
 * for arbitrary calls from other clients or an exactly-once execution service.
 */
import { createHash } from 'node:crypto'

export class HandbackExperiment {
  constructor(db) {
    this.db = db
    db.exec(`CREATE TABLE IF NOT EXISTS bridge_assignments(id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS bridge_attempts(id INTEGER PRIMARY KEY, assignment_id TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS bridge_fixture(key TEXT PRIMARY KEY, data TEXT NOT NULL);`)
  }
  atomic(fn) {
    this.db.exec('BEGIN IMMEDIATE')
    try { const result = fn(); this.db.exec('COMMIT'); return result }
    catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  get(id) { const row = this.db.prepare('SELECT data FROM bridge_assignments WHERE id=?').get(id); return row ? JSON.parse(row.data) : undefined }
  put(value) { this.db.prepare('UPDATE bridge_assignments SET data=? WHERE id=?').run(JSON.stringify(value), value.id) }
  track(value) {
    if (!value.id || !value.worker || !value.primary || !value.work_ref?.hash) throw new Error('Assignment identity required')
    return this.atomic(() => {
      if (this.get(value.id)) throw new Error('Assignment already registered; do not retarget it')
      const item = { ...value, resumed: false, cancelled: false, return_owner: value.original_returned ? 'none' : 'native', handback: 'not-requested' }
      this.db.prepare('INSERT INTO bridge_assignments VALUES(?,?)').run(value.id, JSON.stringify(item))
      return item
    })
  }
  nativeOwns(id) { return this.atomic(() => { const a = this.get(id); if (!a) throw new Error('Unknown assignment'); a.return_owner = 'native'; this.put(a) }) }
  cancel(id) { return this.atomic(() => { const a = this.get(id); if (!a) throw new Error('Unknown assignment'); a.cancelled = true; this.put(a) }) }
  resumeAfterAnswer(id, answer_id) {
    return this.atomic(() => {
      const a = this.get(id)
      if (!a || a.cancelled || a.resumed || !a.original_returned) return false
      a.resumed = true; a.answer_id = answer_id; this.put(a)
      return true
    })
  }
  offer(id, report) {
    return this.atomic(() => {
      const a = this.get(id)
      if (!a) return { state: 'untracked' }
      if (a.cancelled) return { state: 'cancelled' }
      if (a.return_owner !== 'none') return { state: 'native-owned' }
      if (!a.original_returned || !a.resumed) return { state: 'not-a-late-continuation' }
      if (report.kind !== 'completion' || report.session_id !== a.worker || report.action_id !== a.work_ref.action_id || report.node_id !== a.work_ref.node_id || JSON.stringify(report.data.work_ref) !== JSON.stringify(a.work_ref)) return { state: 'wrong-completion' }
      if (a.handback !== 'not-requested') return { state: a.handback }
      const message_id = 'msg_' + createHash('sha256').update(JSON.stringify([a.id, a.primary, report.id])).digest('hex').slice(0, 26)
      const payload = { id: message_id, sessionID: a.primary, delivery: 'steer', resume: true,
        description: 'Completed Loom assignment',
        text: `Assignment ${a.id} reports completion. Read the authoritative record before coordinating further: ${JSON.stringify({ operation: 'query', action_id: report.action_id, record_id: report.id })}. This is a report, not independent acceptance.`,
        metadata: { source: 'loom-handback-experiment', assignment_id: a.id, completion_id: report.id } }
      a.handback = 'claimed'; a.completion_id = report.id; a.payload = payload; this.put(a)
      this.db.prepare('INSERT INTO bridge_attempts(assignment_id,data) VALUES(?,?)').run(id, JSON.stringify({ state: 'claimed', payload }))
      return { state: 'claimed', payload }
    })
  }
  /** Recheck immediately before submission. No lock is held across native I/O. */
  beginSend(id) {
    return this.atomic(() => {
      const a = this.get(id)
      if (!a || a.handback !== 'claimed') return false
      if (a.cancelled || a.return_owner !== 'none') {
        a.handback = a.cancelled ? 'cancelled' : 'native-owned'; this.put(a); return false
      }
      a.handback = 'submitted'; this.put(a)
      this.db.prepare('INSERT INTO bridge_attempts(assignment_id,data) VALUES(?,?)').run(id, JSON.stringify({ state: 'submitted', payload: a.payload }))
      return true
    })
  }
  outcome(id, state) {
    if (!['admitted', 'uncertain'].includes(state)) throw new Error('Invalid send outcome')
    this.atomic(() => {
      const a = this.get(id)
      if (!a || !['submitted', 'consumed'].includes(a.handback)) throw new Error('No submitted handback')
      if (a.handback !== 'consumed') { a.handback = state; this.put(a) }
      this.db.prepare('INSERT INTO bridge_attempts(assignment_id,data) VALUES(?,?)').run(id, JSON.stringify({ state, payload: a.payload }))
    })
  }
  consumed(id, primary, completion_id) {
    this.atomic(() => {
      const a = this.get(id)
      if (!a || a.primary !== primary || a.completion_id !== completion_id || !['submitted','admitted','uncertain','consumed'].includes(a.handback)) throw new Error('No matching handback')
      a.handback = 'consumed'; this.put(a)
    })
  }
  attempts(id) { return this.db.prepare('SELECT data FROM bridge_attempts WHERE assignment_id=? ORDER BY id').all(id).map(r => JSON.parse(r.data)) }
}
