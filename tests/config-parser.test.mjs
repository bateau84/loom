import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { decodeConfigYaml, CONFIG_PARSE_LIMITS, ConfigParseLimitError } from '../.test-build/config-parser.js'
import { defaults, mergeConfig, loadConfig } from '../.test-build/config.js'

function limit(source, boundary) {
  let caught
  try { decodeConfigYaml(source) } catch (e) { caught = e }
  assert.ok(caught instanceof ConfigParseLimitError, String(caught))
  assert.equal(caught.code, 'LOOM_CONFIG_PARSE_LIMIT')
  assert.equal(caught.boundary, boundary)
  return caught
}
test('parser accepts exact source allowance and rejects overflow before entering YAML', () => {
  assert.equal(decodeConfigYaml('x'.repeat(65536)).length, 65536)
  assert.equal(limit('x'.repeat(65537), 'source-byte').attempts, 0)
  assert.equal(limit('界'.repeat(22000), 'source-byte').attempts, 0)
})
test('deep flow collections stop during construction, before a bad suffix is parsed', () => {
  const source = '['.repeat(1000) + '0' + ']'.repeat(1000) + '\n!<invalid'
  const e = limit(source, 'depth')
  assert.ok(e.position < 100, 'parser must not consume the complete nested source first')
  assert.ok(e.attempts <= CONFIG_PARSE_LIMITS.depth + 1)
})
test('deep block maps stop during construction', () => {
  const source = Array.from({length: 80}, (_, i) => ' '.repeat(i) + 'x:\n').join('')
  const e = limit(source, 'depth')
  assert.ok(e.position < source.length / 2)
})
test('wide sequences stop before constructing all nodes or reaching a malformed suffix', () => {
  const source = '[' + '0,'.repeat(10000) + '!<invalid'
  const e = limit(source, 'node-attempt')
  assert.equal(e.attempts, CONFIG_PARSE_LIMITS.nodeAttempts + 1)
  assert.ok(e.position < 19000)
})
test('wide mapping construction is bounded as well as sequence construction', () => {
  const source = Array.from({length: 6000}, (_, i) => `k${i}: 0\n`).join('')
  assert.ok(Buffer.byteLength(source) < 65536)
  assert.ok(limit(source, 'node-attempt').position < source.length)
})
test('aliases consume parser attempts rather than hiding unbounded references', () => {
  const source = 'a: &a 1\nb: [' + '*a,'.repeat(9000) + ']'
  limit(source, 'node-attempt')
})
test('ordinary collection aliases retain identity instead of deep-copy expansion', () => {
  const value = decodeConfigYaml('agents:\n  a: &a {roles: [planning, qa]}\n  b: *a\n')
  assert.equal(value.agents.a, value.agents.b)
  assert.deepEqual(mergeConfig(defaults(), value).agents.b.roles, ['planning', 'qa'])
})
test('scalar aliases preserve exact multiline source meaning', () => {
  const source = 'roles:\n  a:\n    instructions: &text |-\n      Check "[brackets]" and *literal.\n      Keep the qualification.\n  b:\n    instructions: *text\n'
  const config = mergeConfig(defaults(), decodeConfigYaml(source))
  assert.equal(config.roles.a.instructions, 'Check "[brackets]" and *literal.\nKeep the qualification.')
  assert.equal(config.roles.b.instructions, config.roles.a.instructions)
})
test('cyclic aliases are shared and remain schema errors without recursive expansion', () => {
  const value = decodeConfigYaml('roles: &r {recursive: *r}')
  assert.equal(value.roles.recursive, value.roles)
  assert.throws(() => mergeConfig(defaults(), value), /Unknown setting/)
})
test('alias fanout stays a small shared graph', () => {
  let source = 'a0: &a0 [x]\n'
  for (let i = 1; i <= 12; i++) source += `a${i}: &a${i} [${Array(6).fill(`*a${i-1}`).join(',')}]\n`
  const value = decodeConfigYaml(source)
  for (let i = 1; i <= 12; i++) assert.ok(value[`a${i}`].every(x => x === value[`a${i-1}`]))
})
test('a repeated long scalar cannot be joined into an oversized array mapping key', () => {
  const source = 'a: &a ' + 'x'.repeat(8000) + '\n? [' + Array(10).fill('*a').join(',') + ']\n: value\n'
  const e = limit(source, 'array-key-text')
  assert.ok(e.position < source.length)
})
test('200 shared agent definitions remain supported without spending repeated-array budgets', () => {
  let source = 'agents:\n  a0: &a {roles: [' + Array.from({length: 20}, (_, i) => `r${i}`).join(',') + ']}\n'
  for (let i = 1; i < 200; i++) source += `  a${i}: *a\n`
  assert.equal(Object.keys(mergeConfig(defaults(), decodeConfigYaml(source)).agents).length, 200)
})
test('200 fully written agents with 20 roles remain supported', () => {
  const roles = Array.from({length: 20}, (_, i) => `r${i}`).join(',')
  const source = 'agents:\n' + Array.from({length: 200}, (_, i) => `  a${i}: {roles: [${roles}]}\n`).join('')
  assert.equal(Object.keys(mergeConfig(defaults(), decodeConfigYaml(source)).agents).length, 200)
})
test('quoted punctuation and literal/folded text are not counted as collection syntax', () => {
  const text = '[{&*'.repeat(600)
  assert.equal(decodeConfigYaml('text: ' + JSON.stringify(text)).text, text)
  assert.equal(decodeConfigYaml('text: |-\n  ' + text).text, text)
  assert.equal(decodeConfigYaml('text: >-\n  first\n  second\n').text, 'first second')
})
test('per-call budgets reset after rejected and malformed input without a cache or fallback', () => {
  limit('['.repeat(100) + '0' + ']'.repeat(100), 'depth')
  assert.throws(() => decodeConfigYaml('[unterminated'))
  assert.deepEqual(decodeConfigYaml('version: 1'), {version: 1})
})
test('empty and comment-only layers still mean no overrides', () => {
  for (const source of ['', '# comment\n', 'null']) assert.deepEqual(mergeConfig(defaults(), decodeConfigYaml(source)), defaults())
})
test('syntax diagnostics do not include a source snippet', () => {
  assert.throws(() => decodeConfigYaml('secret-marker: [\n'), error => !error.message.includes('secret-marker'))
})
test('prototype-sensitive names still reach normal schema rejection, never prototype mutation', () => {
  assert.throws(() => mergeConfig(defaults(), decodeConfigYaml('agents: {__proto__: {roles: [qa]}}')), /Invalid name/)
  assert.equal({}.roles, undefined)
})
test('parser-limit errors fail closed across layers and a corrected file reloads', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'loom-parser-'))
  t.after(() => rm(dir, {recursive: true, force: true}))
  const a = join(dir, 'a'), b = join(dir, 'b')
  await writeFile(a, 'agents: {a: {roles: [qa]}}')
  await writeFile(b, '['.repeat(100) + '0' + ']'.repeat(100))
  const bad = await loadConfig([a, b], decodeConfigYaml)
  assert.deepEqual(bad.config.agents, {})
  assert.equal(bad.config.instructions.enabled, false)
  assert.equal(bad.config.ledger.capture, 'off')
  assert.match(bad.errors[0], /depth limit/)
  await writeFile(b, 'agents: {b: {roles: [planning]}}')
  assert.deepEqual((await loadConfig([a, b], decodeConfigYaml)).errors, [])
})
