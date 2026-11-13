import { test, expect, spyOn } from "bun:test"
import { Database, type Statement } from "bun:sqlite"
import { createHash } from "node:crypto"
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { registeredLoom } from "./helpers/registered-loom.js"

function hashes(directory: string) {
  return Object.fromEntries(readdirSync(directory).sort().map(name => [name,
    createHash("sha256").update(readFileSync(join(directory, name))).digest("hex")]))
}

test("driver control: a retained prepare delays WAL cleanup under close(false), not close(true)", () => {
  const root = mkdtempSync(join(tmpdir(), "loom-close-control-"))
  try {
    console.log("SQLite shutdown runtime", process.versions.bun)
    for (const immediate of [false, true]) {
      const directory = join(root, String(immediate))
      mkdirSync(directory)
      const db = new Database(join(directory, "state.sqlite"))
      let statement: Statement | undefined
      try {
        db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE evidence(value TEXT); INSERT INTO evidence VALUES('original')")
        statement = db.prepare("SELECT value FROM evidence")
        expect(statement.get()).toEqual({ value: "original" })
        db.close(immediate)
        const beforeFinalization = hashes(directory)
        if (immediate) {
          expect(() => statement!.get()).toThrow()
          statement.finalize()
          expect(hashes(directory)).toEqual(beforeFinalization)
        } else {
          expect(statement.get()).toEqual({ value: "original" })
          expect(Object.keys(beforeFinalization)).toContain("state.sqlite-wal")
          statement.finalize()
          expect(hashes(directory)).not.toEqual(beforeFinalization)
          expect(Object.keys(hashes(directory))).not.toContain("state.sqlite-wal")
        }
      } finally {
        statement?.finalize()
        db.close(true)
      }
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("production shutdown finalizes retained statements before stopped-state hashes are taken", async () => {
  const directory = mkdtempSync(join(tmpdir(), "loom-shutdown-"))
  const statements: Statement[] = []
  const readers = new Map<Database, Statement>()
  const closes = new Map<Database, Array<boolean | undefined>>()
  const original = Database.prototype.prepare, originalClose = Database.prototype.close
  // The forwarding spy preserves the generic return type of the real driver.
  const intercept = function(this: Database, ...args: Parameters<Database["prepare"]>) {
    const statement = original.apply(this, args)
    statements.push(statement)
    // Strong references make cleanup deterministic instead of relying on GC timing.
    // Both private production connections prepare SELECTs during startup.
    if (typeof args[0] === "string" && /^SELECT\b/i.test(args[0])) readers.set(this, statement)
    return statement
  } as Database["prepare"]
  const prepare = spyOn(Database.prototype, "prepare").mockImplementation(intercept)
  const close = spyOn(Database.prototype, "close").mockImplementation(function(this: Database, strict?: boolean) {
    const calls = closes.get(this) ?? []
    calls.push(strict); closes.set(this, calls)
    return originalClose.call(this, strict)
  })
  let host: Awaited<ReturnType<typeof registeredLoom>> | undefined
  try {
    host = await registeredLoom([], { directory, versionedHost: true })
    expect(readers.size).toBe(2)
    await host.close()
    host = undefined
    console.log("Production close ownership", [...readers.keys()].map(db => ({ filename: db.filename, close_arguments: closes.get(db) ?? [] })))
    for (const db of readers.keys()) expect(closes.get(db)).toEqual([true])
    const root = join(directory, "state", "loom", "actions-v1")
    const scopes = readdirSync(root)
    expect(scopes).toHaveLength(1)
    const state = join(root, scopes[0]!)
    const beforeFinalization = hashes(state)
    for (const statement of readers.values()) expect(() => statement.all()).toThrow()
    for (const statement of statements) statement.finalize()
    expect(hashes(state)).toEqual(beforeFinalization)
    console.log("PASS: production shutdown closed both databases; later statement finalization changed no source bytes")
  } finally {
    prepare.mockRestore(); close.mockRestore()
    for (const statement of statements) { try { statement.finalize() } catch {} }
    await host?.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
