import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defaults, mergeConfig } from '../.test-build/config.js'
import { decodeConfigYaml, ConfigParseLimitError } from '../.test-build/config-parser.js'

function limit(source, boundary) {
  let caught
  try { decodeConfigYaml(source) } catch (error) { caught = error }
  assert.ok(caught instanceof ConfigParseLimitError, String(caught))
  assert.equal(caught.boundary, boundary)
  return caught
}

test('parser-frame depth limit has an exact passing boundary', () => {
  assert.ok(Array.isArray(decodeConfigYaml('['.repeat(30) + '0' + ']'.repeat(30))))
  limit('['.repeat(31) + '0' + ']'.repeat(31), 'depth')
})
test('recursive partial array inspections have a cumulative construction allowance', () => {
  const source = 'a: &a [' + Array(400).fill('*a').join(',') + ']'
  const e = limit(source, 'array-inspection')
  assert.ok(e.attempts < 400)
  assert.ok(e.position < source.length)
})
test('exact flat-array text allowance is accepted and excess is rejected', () => {
  const within = 'a: &a ' + 'x'.repeat(32767) + '\nb: [*a,*a]\n'
  assert.equal(decodeConfigYaml(within).b.length, 2)
  const over = 'a: &a ' + 'x'.repeat(32768) + '\nb: [*a,*a]\n'
  limit(over, 'array-key-text')
})
test('repeated flat-array aliases cannot multiply mapping-key conversion work', () => {
  const source = 'a: &a ' + 'x'.repeat(8000) + '\nk: &k [' + Array(8).fill('*a').join(',') + ']\n' + Array(50).fill('? *k\n: value\n').join('')
  const e = limit(source, 'array-conversion-text')
  assert.ok(e.position < source.length)
})
test('a long role-list alias shared by 200 agents stays within ordinary configuration limits', () => {
  const roles = Array.from({length: 20}, (_, i) => `r${i}-` + 'x'.repeat(95)).join(',')
  const source = 'agents:\n  a0: {roles: &r [' + roles + ']}\n' + Array.from({length: 199}, (_, i) => `  a${i+1}: {roles: *r}\n`).join('')
  assert.equal(Object.keys(mergeConfig(defaults(), decodeConfigYaml(source)).agents).length, 200)
})
