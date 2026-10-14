import { open } from "node:fs/promises"
import { constants, type BigIntStats } from "node:fs"
import { TextDecoder } from "node:util"
import { homedir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"

export type AgentConfig = { roles: string[]; description?: string; enabled: boolean }
export type RoleConfig = { description?: string; instructions?: string }
export type Config = {
  version: 1
  agents: Record<string, AgentConfig>
  roles: Record<string, RoleConfig>
  instructions: { enabled: boolean; max_chars: number }
  context: { max_chars: number }
  ledger: { capture: "automatic" | "off" }
}
export type ConfigSnapshot = { config: Config; sources: string[]; errors: string[] }
export type Decoder = (text: string) => unknown
const forbidden = new Set(["__proto__", "prototype", "constructor"])
const NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,99}$/
export const defaults = (): Config => ({ version: 1, agents: {}, roles: {}, instructions: { enabled: true, max_chars: 6000 }, context: { max_chars: 16000 }, ledger: { capture: "automatic" } })

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be a mapping`)
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) throw new Error(`${path} must be a plain mapping`)
  return value as Record<string, unknown>
}
function keys(value: Record<string, unknown>, allowed: string[], path: string) {
  for (const key of Object.keys(value)) if (!allowed.includes(key) || forbidden.has(key)) throw new Error(`Unknown setting: ${path}.${key}`)
}
function text(value: unknown, path: string, max = 4000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${path} must be non-empty text, at most ${max} characters`)
  return value.trim()
}
function bool(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${path} must be true or false`)
  return value
}
function integer(value: unknown, path: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) throw new Error(`${path} must be an integer from ${min} to ${max}`)
  return Number(value)
}
function name(value: string, path: string) {
  if (!NAME.test(value) || forbidden.has(value)) throw new Error(`Invalid name at ${path}`)
  return value
}

/** Merge mappings; replace lists. null removes an inherited agent or custom role. */
export function mergeConfig(base: Config, input: unknown): Config {
  const out = structuredClone(base)
  if (input === null || input === undefined) return out
  const v = object(input, "loom")
  keys(v, ["version", "agents", "roles", "instructions", "context", "ledger"], "loom")
  if (v.version !== undefined && v.version !== 1) throw new Error("Unsupported .loom.yaml version (expected 1)")
  if (v.agents !== undefined) {
    const agents = object(v.agents, "agents")
    if (Object.keys(agents).length > 200) throw new Error("At most 200 agents may be configured")
    for (const [id, raw] of Object.entries(agents)) {
      name(id, "agents")
      if (raw === null) { delete out.agents[id]; continue }
      const a = object(raw, `agents.${id}`)
      keys(a, ["roles", "description", "enabled"], `agents.${id}`)
      const old = out.agents[id] ?? { roles: [], enabled: true }
      let roles = old.roles
      if (a.roles !== undefined) {
        if (!Array.isArray(a.roles) || a.roles.length > 20) throw new Error(`agents.${id}.roles must be a list of at most 20 roles`)
        roles = [...new Set(a.roles.map(r => name(text(r, "role", 100), "role")))]
      }
      out.agents[id] = { ...old, roles, ...(a.description === undefined ? {} : { description: text(a.description, "description", 1000) }), ...(a.enabled === undefined ? {} : { enabled: bool(a.enabled, "enabled") }) }
    }
  }
  if (v.roles !== undefined) {
    const roles = object(v.roles, "roles")
    if (Object.keys(roles).length > 100) throw new Error("At most 100 custom roles may be configured")
    for (const [id, raw] of Object.entries(roles)) {
      name(id, "roles")
      if (raw === null) { delete out.roles[id]; continue }
      const r = object(raw, `roles.${id}`)
      keys(r, ["description", "instructions"], `roles.${id}`)
      const previous = out.roles[id] ?? {}
      out.roles[id] = { ...previous, ...(r.description === undefined ? {} : { description: text(r.description, "role description", 1000) }), ...(r.instructions === undefined ? {} : { instructions: text(r.instructions, "role instructions") }) }
    }
  }
  if (v.instructions !== undefined) {
    const i = object(v.instructions, "instructions"); keys(i, ["enabled", "max_chars"], "instructions")
    if (i.enabled !== undefined) out.instructions.enabled = bool(i.enabled, "instructions.enabled")
    if (i.max_chars !== undefined) out.instructions.max_chars = integer(i.max_chars, "instructions.max_chars", 2000, 20000)
  }
  if (v.context !== undefined) {
    const c = object(v.context, "context"); keys(c, ["max_chars"], "context")
    if (c.max_chars !== undefined) out.context.max_chars = integer(c.max_chars, "context.max_chars", 2000, 64000)
  }
  if (v.ledger !== undefined) {
    const l = object(v.ledger, "ledger"); keys(l, ["capture"], "ledger")
    if (l.capture !== undefined && l.capture !== "automatic" && l.capture !== "off") throw new Error("ledger.capture must be automatic or off")
    if (l.capture !== undefined) out.ledger.capture = l.capture
  }
  return out
}

export function configPaths(project: string, env: Record<string, string | undefined> = process.env, home = homedir()): string[] {
  const custom = env.OPENCODE_CONFIG_DIR
  if (custom && !isAbsolute(custom)) throw new Error("OPENCODE_CONFIG_DIR must be an absolute path")
  const xdg = env.XDG_CONFIG_HOME
  const global = custom ?? join(xdg && isAbsolute(xdg) ? xdg : join(home, ".config"), "opencode")
  return [...new Set([join(global, ".loom.yaml"), join(resolve(project), ".loom.yaml"), join(resolve(project), ".loom.local.yaml")])]
}

// Source-byte and read-operation limits, not a native YAML allocator quota.
export const CONFIG_READ_LIMITS = Object.freeze({ fileBytes: 65536, layers: 3, readCalls: 64 })
type FileInfo = Pick<BigIntStats, "size" | "mtimeNs" | "ctimeNs" | "isFile">
/** Narrow I/O seam for deterministic short-read and concurrent-file tests. */
export interface ConfigFile {
  stat(options: { bigint: true }): Promise<FileInfo>
  read(buffer: Buffer, offset: number, length: number, position: number): Promise<{ bytesRead: number }>
  close(): Promise<void>
}
export type ConfigOpener = (path: string, flags: number) => Promise<ConfigFile>

/**
 * One descriptor, one fixed buffer, and a sentinel byte to detect growth/overflow.
 * Only a missing open is optional. Read/stat/close/decoder errors are not absence.
 */
export async function readConfigSource(path: string, openFile: ConfigOpener = open): Promise<string | undefined> {
  let file: ConfigFile
  try {
    // Nonblocking open avoids waiting for a FIFO writer before the regular-file check.
    // This is not an I/O deadline; supported symlinks are checked through their target.
    file = await openFile(path, constants.O_RDONLY | constants.O_NONBLOCK)
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return undefined
    throw error
  }
  try {
    const before = await file.stat({ bigint: true })
    if (!before.isFile()) throw new Error("Configuration must be a regular file")
    if (before.size > BigInt(CONFIG_READ_LIMITS.fileBytes)) throw new Error("Configuration exceeds 64 KiB")
    const buffer = Buffer.alloc(CONFIG_READ_LIMITS.fileBytes + 1)
    let total = 0, eof = false
    for (let calls = 0; calls < CONFIG_READ_LIMITS.readCalls; calls++) {
      const available = buffer.length - total
      const { bytesRead } = await file.read(buffer, total, available, total)
      if (!Number.isSafeInteger(bytesRead) || bytesRead < 0 || bytesRead > available) throw new Error("Invalid configuration read result")
      total += bytesRead
      if (total > CONFIG_READ_LIMITS.fileBytes) throw new Error("Configuration exceeds 64 KiB")
      if (bytesRead === 0) { eof = true; break }
    }
    if (!eof) throw new Error("Configuration read-operation limit exceeded; retry with a stable local file")
    const after = await file.stat({ bigint: true })
    if (before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || BigInt(total) !== after.size) {
      throw new Error("Configuration changed while being read; retry after the edit completes")
    }
    // No replacement characters that could silently change an agent ID or instruction.
    try { return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, total)) }
    catch { throw new Error("Configuration must contain valid UTF-8") }
  } finally { await file.close() }
}

/** Read at most the three configuration layers; decode only complete admitted text. */
export async function loadConfig(paths: string[], decode: Decoder, openFile: ConfigOpener = open): Promise<ConfigSnapshot> {
  let config = defaults()
  const sources: string[] = [], errors: string[] = []
  if (paths.length > CONFIG_READ_LIMITS.layers) errors.push("At most three configuration layers may be read")
  else for (const path of paths) {
    try {
      const source = await readConfigSource(path, openFile)
      if (source === undefined) continue
      sources.push(path)
      config = mergeConfig(config, decode(source))
    } catch (error) {
      errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  // Never use a partially loaded or stale role mapping. Native execution remains available.
  if (errors.length) {
    config = defaults(); config.instructions.enabled = false; config.ledger.capture = "off"
  }
  return { config, sources, errors }
}
