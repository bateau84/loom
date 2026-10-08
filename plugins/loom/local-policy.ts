import { YAML } from "bun"
import { lstat, readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"
import { validateScopeElevation } from "./scope"

export type LocalShellRules = {
  exact: string[]
  prefixes: string[]
}

export type LocalProjectPolicy = {
  shell: LocalShellRules
  writes: Record<string, string[]>
}

export type LocalPermissionPolicy = {
  version: 1
  shell: LocalShellRules
  projects: Record<string, LocalProjectPolicy>
}

export type LocalPolicyReadResult = {
  path: string
  status: "absent" | "loaded" | "invalid"
  policy?: LocalPermissionPolicy
  error?: string
}

const writableRoles = new Set(["worker", "designer", "specifier", "architect", "documenter"])
const maxPolicyBytes = 65_536

function object(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(context + " must be a YAML mapping.")
  }
  return value as Record<string, unknown>
}

function onlyKeys(record: Record<string, unknown>, allowed: readonly string[], context: string) {
  const unknown = Object.keys(record).filter((key) => !allowed.includes(key))
  if (unknown.length > 0) {
    throw new Error(context + " has unsupported keys: " + unknown.join(", "))
  }
}

function strings(value: unknown, context: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 100 ||
    !value.every((entry) => typeof entry === "string" &&
      entry.length > 0 && entry.length <= 512 && entry.trim() === entry)) {
    throw new Error(context + " must contain up to 100 non-empty strings.")
  }
  return [...new Set(value as string[])]
}

function shellRules(value: unknown, context: string): LocalShellRules {
  if (value === undefined) return { exact: [], prefixes: [] }
  const record = object(value, context)
  onlyKeys(record, ["exact", "prefixes"], context)
  const exact = strings(record.exact, context + ".exact")
  const prefixes = strings(record.prefixes, context + ".prefixes")
  // There are no glob or regex expansion rules. Prefixes match a complete
  // command word boundary, and every candidate is parsed by the shell guard.
  if ([...exact, ...prefixes].some((entry) => /[\r\n\0]/.test(entry))) {
    throw new Error(context + " cannot contain control characters.")
  }
  return { exact, prefixes }
}

function safeConfiguredWrite(path: string) {
  validateScopeElevation([path])
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "")
  const parts = normalized.split("/")
  // Never expand the trusted file policy into Loom state, Git internals,
  // durable promotion reports, or ephemeral evidence scratch namespaces.
  if (parts.includes(".git") || parts.includes(".loom") ||
    normalized === "docs/reports" || normalized.startsWith("docs/reports/") ||
    normalized === "ephemeral-reports" || normalized.startsWith("ephemeral-reports/")) {
    throw new Error("Local write rules cannot authorize internal Git/Loom or report state: " + path)
  }
  return path
}

function writeRules(value: unknown, context: string): Record<string, string[]> {
  if (value === undefined) return {}
  const record = object(value, context)
  const result: Record<string, string[]> = Object.create(null)
  for (const [role, paths] of Object.entries(record)) {
    if (!writableRoles.has(role)) {
      throw new Error(context + " does not support role " + role + ".")
    }
    result[role] = strings(paths, context + "." + role).map(safeConfiguredWrite)
  }
  return result
}

export function parseLocalPermissionPolicy(source: string): LocalPermissionPolicy {
  const parsed = object(YAML.parse(source), "Local Loom policy")
  onlyKeys(parsed, ["version", "shell", "projects"], "Local Loom policy")
  if (parsed.version !== 1) throw new Error("Local Loom policy requires version: 1.")
  const rawProjects = parsed.projects === undefined
    ? {} : object(parsed.projects, "Local Loom projects")
  if (Object.keys(rawProjects).length > 64) {
    throw new Error("Local Loom policy supports up to 64 explicit projects.")
  }
  const projects: Record<string, LocalProjectPolicy> = Object.create(null)
  for (const [directory, value] of Object.entries(rawProjects)) {
    if (!isAbsolute(directory) || directory.split("/").includes("..")) {
      throw new Error("Project policy keys must be absolute project paths: " + directory)
    }
    const entry = object(value, "Project " + directory)
    onlyKeys(entry, ["shell", "writes"], "Project " + directory)
    const projectRoot = resolve(directory)
    if (projects[projectRoot]) throw new Error("Duplicate normalized project path: " + directory)
    projects[projectRoot] = {
      shell: shellRules(entry.shell, "Project " + directory + ".shell"),
      writes: writeRules(entry.writes, "Project " + directory + ".writes"),
    }
  }
  return {
    version: 1,
    shell: shellRules(parsed.shell, "Local Loom shell"),
    projects,
  }
}

export function localPolicyPath() {
  const configHome = process.env.XDG_CONFIG_HOME
  const base = configHome && isAbsolute(configHome)
    ? configHome : join(homedir(), ".config")
  return join(base, "opencode", ".loom.yaml")
}

/** Read for each admission: edits are applied without a build or restart. */
export async function readLocalPermissionPolicy(
  path = localPolicyPath(),
): Promise<LocalPolicyReadResult> {
  try {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error("Policy must be a regular file, not a symlink.")
    }
    const uid = typeof process.getuid === "function" ? process.getuid() : undefined
    if (uid !== undefined && info.uid !== uid) {
      throw new Error("Policy must be owned by the current user.")
    }
    if ((info.mode & 0o022) !== 0) {
      throw new Error("Policy must not be writable by group or other users.")
    }
    if (info.size > maxPolicyBytes) throw new Error("Policy exceeds 64 KiB.")
    const content = await readFile(path, "utf8")
    if (Buffer.byteLength(content, "utf8") > maxPolicyBytes) {
      throw new Error("Policy exceeds 64 KiB.")
    }
    return { path, status: "loaded", policy: parseLocalPermissionPolicy(content) }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return { path, status: "absent" }
    return {
      path,
      status: "invalid",
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export function projectWriteOverrides(
  policy: LocalPermissionPolicy | undefined,
  directory: string,
  role: string,
): string[] {
  if (!writableRoles.has(role)) return []
  const project = policy?.projects[resolve(directory)]
  return project?.writes[role] ?? []
}

export function projectShellOverrides(
  policy: LocalPermissionPolicy | undefined,
  directory: string,
): LocalShellRules {
  const project = policy?.projects[resolve(directory)]
  return {
    exact: [...new Set([...(policy?.shell.exact ?? []), ...(project?.shell.exact ?? [])])],
    prefixes: [...new Set([...(policy?.shell.prefixes ?? []), ...(project?.shell.prefixes ?? [])])],
  }
}
