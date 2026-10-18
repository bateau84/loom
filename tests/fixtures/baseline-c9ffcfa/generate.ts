import { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { populate, sha, snapshot } from "./oracle.js"

// Explicit new destination; never regenerate/overwrite the accepted frozen IDs.
const output = process.argv[2]
if (!output) throw new Error("usage: bun generate.ts NEW_OUTPUT_DIRECTORY")
mkdirSync(resolve(output), { mode: 0o700 })
const db = new Database(":memory:")
try {
  const ids = populate(db), saved = snapshot(db)
  for (const [name, value] of Object.entries({ "snapshot.json": saved, "ids.json": ids })) {
    writeFileSync(join(output, name), JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 })
  }
  const producer = ["store.ts", "collaboration.ts", "model.ts", "primary-sender.ts", "context.ts"].map(path => {
    const bytes = readFileSync(new URL(`./producer/${path}`, import.meta.url))
    return { path: `producer/${path}`, source: `src/${path}`, sha256: sha(bytes), git_blob: createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex") }
  })
  const files = ["snapshot.json", "ids.json"].map(path => ({ path, sha256: sha(readFileSync(join(output, path))) }))
  const ledger = Object.fromEntries((saved.tables.ledger as { id: string; data: string }[]).map(row => [row.id, sha(row.data)]))
  const tables = Object.fromEntries(Object.entries(saved.tables).map(([name, rows]) => [name, { count: (rows as unknown[]).length, sha256: sha(JSON.stringify(rows)) }]))
  const manifest = { format: "loom-synthetic-preservation/v1", baseline: "c9ffcfa60d93e6be637510d915e5b239ad48225c", synthetic: true,
    provenance: "Frozen same-repository source bytes, synthetic API inputs, no private/user DB or prompt. One explicitly labelled consent-field omission compatibility mutation. No transport adapter or host instantiated. IDs and timestamps are generated per run; frozen snapshot is the exact preservation target, not regeneration byte equality.",
    schema_sha256: sha(JSON.stringify(saved.schema)), files: [...files, ...producer], tables, ledger }
  writeFileSync(join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx", mode: 0o600 })
  console.log(JSON.stringify({ event: "synthetic-baseline-generated", baseline: manifest.baseline, tables, snapshot_sha256: files[0].sha256, native_transports_constructed: 0 }))
} finally { db.close() }
