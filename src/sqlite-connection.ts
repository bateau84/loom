import type { Database, Statement } from "bun:sqlite"
import type { SQL } from "./store.js"

/** Adapt Bun to the materialized, synchronous Store interface. A prepared
 * handle is a reusable query recipe, not ownership of a live SQLite statement.
 * Each execution releases its native statement before returning or throwing. */
export function sqliteConnection(db: Database): SQL {
  function execute<T>(sql: string, operation: (statement: Statement) => T): T {
    const statement = db.prepare(sql)
    let failed = false
    try { return operation(statement) }
    catch (error) { failed = true; throw error }
    finally {
      if (failed) {
        try { statement.finalize() } catch { /* Preserve the query's primary failure. */ }
      } else statement.finalize()
    }
  }
  return {
    exec: sql => db.exec(sql),
    prepare: sql => ({
      get: (...params) => execute(sql, statement => statement.get(...params)),
      all: (...params) => execute(sql, statement => statement.all(...params)),
      run: (...params) => execute(sql, statement => statement.run(...params)),
    }),
  }
}
