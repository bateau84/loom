import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { Store } from '../.test-build/store.js'

const asker = { session_id: 'asker', agent: 'coder' }
const respondent = { session_id: 'parent', agent: 'general' }
const choices = () => [{ id: 'A', answer: 'JSON files' }, { id: 'B', answer: 'SQLite' }]
const input = () => ({ question: 'Which local store?', recipient: { kind: 'dispatcher' }, blocking: true,
  answer_type: 'multi-choice', choices: choices() })
function fixture(t) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close())
  const store = new Store(db)
  return { db, store, c: store.collaboration }
}

test('choice answer resolves the original immutable option and survives Store reopen without an Action', t => {
  const { db, c } = fixture(t), request = input()
  const q = c.ask(asker, undefined, request, { expected_session: respondent.session_id })
  request.choices[1].answer = 'Caller changed its own object'
  const selected = c.answer(respondent, { question_id: q.id, choice_id: 'B', reason: 'No external service.',
    context_attachments: ['fixture://requirements/local-first'] })
  assert.equal(selected.record.data.choice_id, 'B')
  assert.equal(selected.record.data.answer, 'SQLite')
  assert.equal(selected.record.data.reason, 'No external service.')
  assert.equal(selected.record.session_id, respondent.session_id)
  assert.equal(selected.record.action_id, undefined)
  assert.equal(selected.resume.answer_id, selected.record.id)
  const thread = new Store(db).collaboration.thread(q.id)
  assert.equal(thread.question.data.answer_type, 'multi-choice')
  assert.deepEqual(thread.question.data.choices, choices())
  assert.deepEqual(thread.answers[0].data, selected.record.data)
})

test('cannot-select is an attributed response, not a fabricated option or a second resume', t => {
  const { c } = fixture(t)
  const q = c.ask(asker, undefined, input(), { expected_session: respondent.session_id })
  const deferred = c.answer(respondent, { question_id: q.id, status: 'cannot-select', reason: 'The durability requirement is missing.' })
  assert.equal(deferred.record.data.status, 'cannot-select')
  assert.equal(deferred.record.data.choice_id, undefined)
  assert.equal(deferred.record.data.reason, 'The durability requirement is missing.')
  assert.match(deferred.record.data.answer, /^Cannot select:/)
  assert.equal(deferred.resume.answer_id, deferred.record.id)
  const later = c.answer(respondent, { question_id: q.id, choice_id: 'A' })
  assert.equal(later.resume, undefined)
  assert.deepEqual(c.thread(q.id).answers.map(a => a.data.choice_id), [undefined, 'A'])
  assert.match(c.thread(q.id).note, /not resolution, approval or permission/)
})

test('legacy manual creation rejects structured questions without changing legacy text', t => {
  const { db, c } = fixture(t)
  const { recipient: _recipient, ...request } = input()
  assert.throws(() => c.execute(asker, { operation: 'ask', ...request, to_agent: 'general' }), /multi-choice requires.*recipient/)
  assert.equal(db.prepare('SELECT count(*) AS n FROM ledger').get().n, 0)
  const q = c.execute(asker, { operation: 'ask', question: 'Explain?', to_agent: 'general', blocking: true })
  const answer = c.answer({ session_id: 'unrelated', agent: 'other' }, { question_id: q.id, answer: 'Manual response' })
  assert.equal(answer.record.data.answer, 'Manual response')
  assert.equal(answer.record.agent, 'other')
  assert.ok(answer.resume) // Existing manual/unverified text compatibility, not a new authorization grant.
})

for (const [label, patch] of [
  ['missing choices', { choices: undefined }],
  ['empty choices', { choices: [] }],
  ['one choice', { choices: [{ id: 'A', answer: 'Only one' }] }],
  ['too many choices', { choices: Array.from({ length: 21 }, (_, i) => ({ id: String(i), answer: 'Option' })) }],
  ['duplicate IDs', { choices: [{ id: 'A', answer: 'First' }, { id: 'A', answer: 'Second' }] }],
  ['blank ID', { choices: [{ id: ' ', answer: 'First' }, { id: 'B', answer: 'Second' }] }],
  ['non-string ID', { choices: [{ id: 1, answer: 'First' }, { id: 'B', answer: 'Second' }] }],
  ['oversized ID', { choices: [{ id: 'A'.repeat(65), answer: 'First' }, { id: 'B', answer: 'Second' }] }],
  ['blank label', { choices: [{ id: 'A', answer: ' \n ' }, { id: 'B', answer: 'Second' }] }],
  ['oversized label', { choices: [{ id: 'A', answer: 'x'.repeat(4001) }, { id: 'B', answer: 'Second' }] }],
  ['unknown option field', { choices: [{ id: 'A', answer: 'First', preferred: true }, { id: 'B', answer: 'Second' }] }],
  ['invalid option', { choices: [null, { id: 'B', answer: 'Second' }] }],
  ['unknown type', { answer_type: 'multi-select' }],
  ['implicit text with choices', { answer_type: undefined }],
  ['explicit text with choices', { answer_type: 'text' }],
]) test(`invalid choice definition (${label}) cannot append a question`, t => {
  const { db, c } = fixture(t)
  assert.throws(() => c.ask(asker, undefined, { ...input(), ...patch }, { expected_session: 'parent' }))
  assert.equal(db.prepare('SELECT count(*) AS n FROM ledger').get().n, 0)
})

test('invalid selections and mixed answer forms neither write nor consume first-answer eligibility', t => {
  const { db, c } = fixture(t)
  const q = c.ask(asker, undefined, input(), { expected_session: 'parent' })
  const before = db.prepare('SELECT count(*) AS n FROM ledger').get().n
  for (const content of [
    {}, { choice_id: 'C' }, { choice_id: 'b' }, { choice_id: ' B ' }, { choice_id: 1 }, { choice_id: null },
    { choice_id: ['A', 'B'] }, { choice_ids: ['A', 'B'] }, { answer: 'SQLite' },
    { choice_id: 'B', answer: 'JSON files' }, { choice_id: 'A', reason: '' },
    { choice_id: 'B', reason: 'x'.repeat(8001) }, { choice_id: 'A', status: 'cannot-select', reason: 'Maybe' },
    { status: 'cannot-select' }, { status: 'cannot-select', reason: ' ' },
    { status: 'cannot-select', reason: 'Unknown', answer: 'Guess' }, { status: 'approved', reason: 'No' },
    { reason: 'No selection' },
  ]) {
    assert.throws(() => c.answer(respondent, { question_id: q.id, ...content }), JSON.stringify(content))
    assert.equal(db.prepare('SELECT count(*) AS n FROM ledger').get().n, before)
  }
  assert.equal(c.thread(q.id).answers.length, 0)
  assert.ok(c.answer(respondent, { question_id: q.id, choice_id: 'B' }).resume)
})

test('free-text defaults and explicit text retain the existing answer contract', t => {
  const { c } = fixture(t)
  for (const format of [{}, { answer_type: 'text' }]) {
    const q = c.ask(asker, undefined, { question: 'Explain the limit.', to_agent: 'general', blocking: false, ...format })
    for (const invalid of [{ choice_id: 'A' }, { answer: 'Text', choice_id: 'A' },
      { status: 'cannot-select', reason: 'Unknown' }, { answer: 'Text', reason: 'Separate reason' }])
      assert.throws(() => c.answer(respondent, { question_id: q.id, ...invalid }))
    const result = c.answer(respondent, { question_id: q.id, answer: 'The original text contract.', context_attachments: ['fixture://source'] })
    assert.equal(result.record.data.answer, 'The original text contract.')
    assert.equal(result.record.data.choice_id, undefined)
    assert.equal(result.record.data.status, undefined)
    assert.equal(result.resume, undefined)
    assert.equal(c.thread(q.id).question.data.answer_type, format.answer_type)
  }
})

test('boundary-sized IDs and labels remain exact and conflicting replies remain separate', t => {
  const { c } = fixture(t), id = 'A'.repeat(64), label = ' x'.repeat(2000)
  const q = c.ask(asker, undefined, { ...input(), choices: [{ id, answer: label }, { id: 'B', answer: 'Other' }] }, { expected_session: 'parent' })
  const first = c.answer(respondent, { question_id: q.id, choice_id: id, reason: 'r'.repeat(8000) })
  const second = c.answer(respondent, { question_id: q.id, choice_id: 'B' })
  assert.equal(first.record.data.answer, label)
  assert.ok(first.resume)
  assert.equal(second.resume, undefined)
  const page = c.thread(q.id, 0, 1)
  assert.equal(page.answers[0].id, first.record.id)
  assert.ok(page.next_after)
  assert.equal(c.thread(q.id, page.next_after, 1).answers[0].id, second.record.id)
})

test('structured answers cannot bypass respondent identity or a failed SQLite append', t => {
  const { db, c } = fixture(t), q = c.ask(asker, undefined, input(), { expected_session: 'parent' })
  for (const response of [{ choice_id: 'B' }, { status: 'cannot-select', reason: 'Unknown' }])
    assert.throws(() => c.answer({ session_id: 'sibling', agent: 'general' }, { question_id: q.id, ...response }), /Session does not match/)
  db.exec("CREATE TRIGGER reject_selection BEFORE INSERT ON ledger WHEN NEW.kind='answer' BEGIN SELECT RAISE(ABORT,'refused'); END")
  assert.throws(() => c.answer(respondent, { question_id: q.id, choice_id: 'A' }), /refused/)
  assert.equal(c.thread(q.id).answers.length, 0)
  db.exec('DROP TRIGGER reject_selection')
  assert.ok(c.answer(respondent, { question_id: q.id, choice_id: 'B' }).resume)
})

test('question lists and compact context expose the answer kind and selected identity', async t => {
  const { taskContext } = await import('../.test-build/context.js')
  const { store, c } = fixture(t), action = store.create('Storage', 'Long accepted goal '.repeat(600), asker)
  const focus = { action_id: action.id }
  const q = c.ask(asker, focus, input(), { expected_session: 'parent' })
  c.answer(respondent, { question_id: q.id, choice_id: 'B', reason: 'Only for the agreed single-host workload.' })
  const brief = c.questions({ action_id: action.id, state: 'all' }).items[0]
  assert.equal(brief.answer_type, 'multi-choice')
  assert.equal(brief.choice_count, 2)
  assert.equal(brief.answer.choice_id, 'B')
  assert.match(brief.answer.statement, /Only for/)
  assert.equal(brief.choices, undefined) // Read the original thread, not a partial option set.
  const compact = taskContext(store, focus, 2000, asker.agent)
  assert.ok(JSON.stringify(compact).length <= 2000)
  assert.equal(compact.truncated, true)
  assert.equal(compact.questions[0].answer_type, 'multi-choice')
  assert.equal(compact.questions[0].choice_count, 2)
  assert.equal(compact.questions[0].answer.choice_id, 'B')
  c.answer(respondent, { question_id: q.id, status: 'cannot-select', reason: 'New evidence invalidates the recommendation.' })
  const current = c.questions({ action_id: action.id, state: 'all' }).items[0]
  assert.equal(current.state, 'answered') // Response, not resolution; existing meaning is unchanged.
  assert.equal(current.answer.status, 'cannot-select')
  assert.equal(current.answer.choice_id, undefined)
  assert.equal(current.answers_have_more, true)
})

for (const answered of [false, true]) test(`pre-fix legacy structured row (answered=${answered}) is read-only with no new wake eligibility`, t => {
  const { db, store, c } = fixture(t)
  // Historical input from the earlier draft, not a substitute for current ask-path proof.
  const q = store.append({ ...asker, kind: 'question', data: {
    format: 'loom-question/v1', question: 'Historical choice?', to_agent: 'general',
    answer_type: 'multi-choice', choices: choices(), blocking: true,
  } })
  const historical = answered ? store.append({ session_id: 'old-respondent', agent: 'other', kind: 'answer', data: {
    format: 'loom-answer/v1', question_id: q.id, choice_id: 'A', answer: 'JSON files',
    verification: 'Response only; not resolution, approval or execution permission',
  } }) : undefined
  const snapshot = db.prepare('SELECT data FROM ledger ORDER BY seq').all()
  for (const actor of [respondent, { session_id: 'unrelated', agent: 'other' }])
    for (const response of [{ choice_id: 'B' }, { status: 'cannot-select', reason: 'Unknown' }, { answer: 'Text workaround' }])
      assert.throws(() => c.answer(actor, { question_id: q.id, ...response }), /Legacy multi-choice.*new.*recipient/)
  assert.deepEqual(db.prepare('SELECT data FROM ledger ORDER BY seq').all(), snapshot)
  const reopened = new Store(db).collaboration.thread(q.id)
  assert.deepEqual(reopened.question.data.choices, choices())
  assert.deepEqual(reopened.answers.map(a => a.id), historical ? [historical.id] : [])
})

for (const [label, value, valid] of [
  ['non-BMP counterexample', '😀'.repeat(2001), true],
  ['non-BMP exact limit', '😀'.repeat(4000), true],
  ['non-BMP overflow', '😀'.repeat(4001), false],
  ['combining exact limit', 'e\u0301'.repeat(2000), true],
  ['combining overflow', 'e\u0301'.repeat(2000) + 'x', false],
  ['Unicode whitespace', '\u00a0\u2003\u2028\u2029\ufeff', false],
]) test(`choice labels use Unicode code points without normalization: ${label}`, t => {
  const { db, c } = fixture(t)
  const request = { ...input(), choices: [{ id: 'A', answer: value }, { id: 'B', answer: 'Other' }] }
  if (!valid) {
    assert.throws(() => c.ask(asker, undefined, request, { expected_session: 'parent' }))
    assert.equal(db.prepare('SELECT count(*) AS n FROM ledger').get().n, 0)
    return
  }
  const q = c.ask(asker, undefined, request, { expected_session: 'parent' })
  const answer = c.answer(respondent, { question_id: q.id, choice_id: 'A' })
  assert.equal(answer.record.data.answer, value)
  assert.equal(c.thread(q.id).question.data.choices[0].answer, value)
})

for (const response of [{ choice_id: 'A' }, { status: 'cannot-select' }])
  test(`structured reasons count code points (${response.choice_id ?? response.status}) without changing legacy text limits`, t => {
    const { c } = fixture(t), q = c.ask(asker, undefined, input(), { expected_session: 'parent' })
    for (const reason of ['😀'.repeat(8001), '\u00a0\u2003\u2028\ufeff', '', '  ']) {
      assert.throws(() => c.answer(respondent, { question_id: q.id, ...response, reason }))
      assert.equal(c.thread(q.id).answers.length, 0)
    }
    const reason = '😀'.repeat(8000)
    const answer = c.answer(respondent, { question_id: q.id, ...response, reason })
    assert.equal(answer.record.data.reason, reason)
    assert.ok(answer.resume)
    const legacy = c.ask(asker, undefined, { question: 'Legacy', to_agent: 'general', blocking: false })
    assert.throws(() => c.answer(respondent, { question_id: legacy.id, answer: '😀'.repeat(8001) }), /1-16000 characters/)
    assert.equal(c.answer(respondent, { question_id: legacy.id, answer: '😀'.repeat(8000) }).record.data.answer, '😀'.repeat(8000))
  })
