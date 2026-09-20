#!/usr/bin/env bun
import { readdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { loadSuite, validateSuite } from "./eval-lib"

const root = resolve(import.meta.dir, "..")
const evalDir = join(root, "evals")
const files = readdirSync(evalDir)
  .filter((name) => name.endsWith(".json"))
  .sort()

let count = 0
const errors: string[] = []
for (const file of files) {
  const path = join(evalDir, file)
  try {
    const suite = loadSuite(path)
    const current = validateSuite(suite, root)
    if (current.length) errors.push(...current.map((error) => `${file}: ${error}`))
    else {
      count += suite.cases.length
      console.log(`PASS ${file} (${suite.cases.length} cases)`)
    }
  } catch (error) {
    errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

if (files.length === 0) errors.push("no eval suites found")
if (count < 18) errors.push(`expected at least 18 behavioral cases, found ${count}`)

if (errors.length) {
  console.error(`FAIL behavioral eval corpus (${errors.length} issue(s))`)
  for (const error of errors) console.error(" - " + error)
  process.exit(1)
}
console.log(`PASS behavioral eval corpus (${count} cases)`)
