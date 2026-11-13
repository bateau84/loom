import { test, expect, spyOn } from "bun:test"
import { Database, type Statement } from "bun:sqlite"
import { sqliteConnection } from "../src/sqlite-connection.js"

function fixture() {
  const db = new Database(":memory:")
  const statements: Array<{ statement: Statement; finalized: boolean }> = []
  const original = db.prepare
  const intercept = function(this: Database, ...args: Parameters<Database["prepare"]>) {
    const statement = original.apply(this, args)
    const retained = { statement, finalized: false }
    const finalize = statement.finalize.bind(statement)
    statement.finalize = () => { finalize(); retained.finalized = true }
    statements.push(retained)
    return statement
  } as Database["prepare"]
  const prepare = spyOn(db, "prepare").mockImplementation(intercept)
  const sql = sqliteConnection(db)
  return { db, sql, statements, close() { prepare.mockRestore(); db.close(true) } }
}

test("materialized SQL operations finalize every native statement, including repeated handle use", () => {
  const f = fixture()
  try {
    f.sql.exec("CREATE TABLE evidence(id INTEGER PRIMARY KEY, value TEXT NOT NULL)")
    const insert = f.sql.prepare("INSERT INTO evidence(id,value) VALUES(?,?)")
    expect(f.statements).toHaveLength(0)
    for (let i = 0; i < 100; i++) insert.run(i, "original-" + i)
    expect(f.statements).toHaveLength(100)
    expect(f.statements.every(item => item.finalized)).toBe(true)
    const selected = f.sql.prepare("SELECT value FROM evidence WHERE id=?")
    expect(selected.get(1)).toEqual({ value: "original-1" })
    expect(selected.get(2)).toEqual({ value: "original-2" })
    expect(f.sql.prepare("SELECT id FROM evidence ORDER BY id").all()).toHaveLength(100)
    expect(f.statements.every(item => item.finalized)).toBe(true)
    for (const { statement } of f.statements) expect(() => statement.all()).toThrow()
    f.db.close(true)
    expect(() => selected.get(1)).toThrow()
  } finally { f.close() }
})

test("failed SQL executions release native handles while retaining rollback and primary errors", () => {
  const f = fixture()
  try {
    f.sql.exec("CREATE TABLE evidence(id INTEGER PRIMARY KEY)")
    const insert = f.sql.prepare("INSERT INTO evidence VALUES(?)")
    f.sql.exec("BEGIN IMMEDIATE")
    insert.run(1)
    expect(() => insert.run(1)).toThrow("UNIQUE constraint failed")
    expect(f.statements.every(item => item.finalized)).toBe(true)
    f.sql.exec("ROLLBACK")
    expect(f.sql.prepare("SELECT * FROM evidence").all()).toEqual([])
    insert.run(2)
    expect(f.sql.prepare("SELECT id FROM evidence").get()).toEqual({ id: 2 })
    expect(f.statements.every(item => item.finalized)).toBe(true)
  } finally { f.close() }
})
