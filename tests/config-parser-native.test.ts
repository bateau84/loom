import { test, expect } from "bun:test"
import { YAML } from "bun"
import { readFile } from "node:fs/promises"
import { defaults, mergeConfig } from "../src/config.js"
import { decodeConfigYaml } from "../src/config-parser.js"

const fixtures: Record<string, string> = {
  alias: "agents:\n  lead: &a {roles: [coordination, exploration], description: Test agent}\n  second: *a\n",
  role_alias: "agents:\n  lead: {roles: &r [planning, qa]}\n  second: {roles: *r}\n",
  quotes: `roles:\n  note:\n    instructions: 'Keep "quotes", *literal, &literal, [x] and #text.'\n`,
  escapes: `roles: {note: {instructions: "Line one\\nLine two\\tUnicode \\u00f8"}}`,
  literal: "roles:\n  note:\n    instructions: |-\n      First line.\n\n      Last line; qualification stays.\n",
  folded: "roles:\n  note:\n    instructions: >-\n      First line\n      continues.\n\n      New paragraph.\n",
  multiline_alias: "roles:\n  a: {instructions: &i 'Important qualification.'}\n  b: {instructions: *i}\n",
  tags: 'version: !!int 1\ninstructions: {enabled: !!bool true}\nagents: {a: {roles: !!seq [!!str qa]}}',
  directive: '%YAML 1.2\n---\nversion: 1\nagents: {a: {roles: [qa]}}\n...\n',
  literal_markers: 'roles:\n  a:\n    instructions: |\n      ---\n      %TAG !e! tag:example.com,2026:\n      [*alias, &anchor] # not YAML syntax here\n',
  crlf: "agents:\r\n  a:\r\n    roles:\r\n      - qa\r\n    description: 'test'\r\n",
  core_strings: 'agents: {a: {roles: [on, off, yes, no], description: 2026-10-14}}',
  duplicate: 'agents: {a: {roles: [planning], roles: [qa]}}',
}
for (const [name, source] of Object.entries(fixtures)) test(`bounded decoder matches native configuration semantics: ${name}`, () => {
  expect(mergeConfig(defaults(), decodeConfigYaml(source))).toEqual(mergeConfig(defaults(), YAML.parse(source)))
})
test('published example has identical bounded and native configuration results', async () => {
  const source = await readFile(new URL('../examples/loom.yaml', import.meta.url), 'utf8')
  expect(mergeConfig(defaults(), decodeConfigYaml(source))).toEqual(mergeConfig(defaults(), YAML.parse(source)))
})
test('production plugin selects the bounded decoder without a native fallback', async () => {
  const source = await readFile(new URL('../src/plugin.ts', import.meta.url), 'utf8')
  expect(source).toContain('loadConfig(configuredPaths, decodeConfigYaml)')
  expect(source).not.toContain('YAML.parse')
})
