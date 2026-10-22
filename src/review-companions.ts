import type { Plugin } from "@opencode/plugin"
import { createHash } from "node:crypto"
import { constants } from "node:fs"
import { open, realpath } from "node:fs/promises"
import { basename, dirname, isAbsolute, join } from "node:path"
import { TextDecoder } from "node:util"
import { configPaths, loadConfig } from "./config.js"
import { decodeConfigYaml } from "./config-parser.js"

export type ReviewLens = "assessment" | "qa"
export const COMPANION_MAX_BYTES = 65536
const filenames = { assessment: "ASSESSMENT.md", qa: "QA.md" } as const

export function companionHelp(lens: ReviewLens): string {
  const file = filenames[lens]
  return [
    `Load an installed skill's ${file} review lens; requires the configured ${lens} role.`,
    `Usage: {"skill":"software-engineering"}. Use the exact native skill ID. The calling agent must be enabled in .loom.yaml with roles including ${lens}; its name is irrelevant. Choose relevant skills independently, not only the producer's choices. Load practitioner guidance with the native skill tool when useful. No prior skill-load receipt, Action or Plan is required.`,
    `Returns: JSON text with result.skill, methodology, available and path. An available ${file} also has its full UTF-8 content and source-byte sha256. A missing companion returns available:false and reason:companion-not-found, never SKILL.md as a substitute.`,
    "Caution: Reads the current native skill registry, not GitHub or a fixed skills directory. Native skill permissions still apply, including ask/deny. Unknown skills, invalid configuration, missing roles, unreadable/oversized/non-UTF-8 files and cancellation fail visibly. Files must be regular, non-symlink companions of a registered SKILL.md, at most 64 KiB. Symlinked installation directories are supported. No dispatch, workflow stage, completion, verdict or proof of independence is created. Use loom_record separately for actual findings.",
    'Examples (JSON inputs, not shell commands):',
    '{"skill":"software-engineering"}',
    'In Code Mode, use the exact callable path returned by search and parse the returned JSON text once.',
    'Await writes before using IDs or ending Code Mode. For independent calls use Promise.allSettled and inspect every outcome; sequence dependent calls.',
  ].join("\n")
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object")
  return value as Record<string, unknown>
}
function unwrapped(value: unknown): unknown {
  return value && typeof value === "object" && "data" in value ? (value as { data: unknown }).data : value
}
function skillID(input: unknown): string {
  const value = record(input)
  if (Object.keys(value).some(key => key !== "skill") || typeof value.skill !== "string" ||
      !value.skill.trim() || value.skill !== value.skill.trim() || value.skill.length > 200) {
    throw new Error("Expected only skill: a non-empty, exact native skill ID of at most 200 characters")
  }
  return value.skill
}

/** One bounded descriptor read. Only ENOENT at open means an optional companion is absent. */
export async function readCompanion(path: string, signal: AbortSignal): Promise<{ content: string; sha256: string } | undefined> {
  signal.throwIfAborted()
  let file
  try { file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW) }
  catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return undefined
    throw error
  }
  try {
    signal.throwIfAborted()
    const before = await file.stat({ bigint: true })
    if (!before.isFile()) throw new Error("Skill companion must be a regular file")
    if (before.size > BigInt(COMPANION_MAX_BYTES)) throw new Error("Skill companion exceeds 64 KiB")
    const buffer = Buffer.alloc(COMPANION_MAX_BYTES + 1)
    let total = 0, eof = false
    for (let count = 0; count < 64; count++) {
      signal.throwIfAborted()
      const { bytesRead } = await file.read(buffer, total, buffer.length - total, total)
      total += bytesRead
      if (total > COMPANION_MAX_BYTES) throw new Error("Skill companion exceeds 64 KiB")
      if (bytesRead === 0) { eof = true; break }
    }
    if (!eof) throw new Error("Skill companion read-operation limit exceeded")
    const after = await file.stat({ bigint: true })
    signal.throwIfAborted()
    if (before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || BigInt(total) !== after.size) {
      throw new Error("Skill companion changed while being read; retry after the edit completes")
    }
    const bytes = buffer.subarray(0, total)
    let content: string
    try { content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes) }
    catch { throw new Error("Skill companion must contain valid UTF-8") }
    return { content, sha256: createHash("sha256").update(bytes).digest("hex") }
  } finally { await file.close() }
}

/** Read-only native-skill adapters: no dependency on the Action store or workflow history. */
export async function registerReviewCompanions(ctx: Plugin.Context): Promise<() => Promise<void>> {
  const directory = await realpath(ctx.location.directory)
  const paths = configPaths(directory)
  const lifetime = new AbortController()
  const registration = await ctx.tool.transform(editor => {
    for (const lens of ["assessment", "qa"] as const) editor.add({
      name: lens,
      description: companionHelp(lens),
      options: { namespace: "loom", codemode: true },
      input: { type: "object", properties: { skill: { type: "string", minLength: 1, maxLength: 200 } }, required: ["skill"], additionalProperties: false },
      execute: async (raw, tool) => {
        const signal = AbortSignal.any([tool.signal, lifetime.signal])
        const id = skillID(raw)
        const authorize = async () => {
          signal.throwIfAborted()
          const session = record(unwrapped(await ctx.session.get({ sessionID: tool.sessionID })))
          const location = record(session.location)
          if (session.projectID !== ctx.location.project.id || location.workspaceID !== ctx.location.workspaceID ||
              typeof location.directory !== "string" || await realpath(location.directory) !== directory) {
            throw new Error("This Loom instance does not own the Session location")
          }
          const snapshot = await loadConfig(paths, decodeConfigYaml, undefined, signal)
          signal.throwIfAborted()
          if (snapshot.errors.length) throw new Error(`Cannot authorize loom_${lens}: ${snapshot.errors.join("; ")}`)
          const agent = snapshot.config.agents[tool.agent]
          if (!agent?.enabled || !agent.roles.includes(lens)) {
            throw new Error(`loom_${lens} requires the ${lens} role on the enabled calling agent in .loom.yaml (agents.${tool.agent}.roles). Agent names and Plan roles do not grant access.`)
          }
        }
        await authorize()
        const listed = unwrapped(await ctx.skill.list())
        signal.throwIfAborted()
        if (!Array.isArray(listed)) throw new Error("OpenCode returned an unsupported skill registry shape")
        const matches = listed.filter(value => record(value).id === id)
        if (matches.length !== 1) throw new Error(`Expected one registered native skill with ID ${id}; found ${matches.length}`)
        const skill = record(matches[0])
        if (typeof skill.path !== "string" || !isAbsolute(skill.path) || basename(skill.path) !== "SKILL.md") {
          throw new Error("Skill companion requires a registered local SKILL.md path")
        }
        // Match the native skill tool's own permission action, resource and source.
        // Rejections must propagate, including the host's end-current-step rejection.
        await ctx.permission.assert({
          action: "skill", resources: [id], save: [id], sessionID: tool.sessionID, agent: tool.agent,
          source: { type: "tool", messageID: tool.messageID, id: tool.id },
        })
        // Approval may have waited while the caller's role or Session location changed.
        await authorize()
        const root = await realpath(dirname(skill.path))
        const path = join(root, filenames[lens])
        const companion = await readCompanion(path, signal)
        signal.throwIfAborted()
        const result = companion
          ? { skill: id, methodology: lens, available: true, path, ...companion }
          : { skill: id, methodology: lens, available: false, path, reason: "companion-not-found" }
        return { content: JSON.stringify({ result }) }
      },
    })
  })
  return async () => { lifetime.abort(); await registration.dispose() }
}
