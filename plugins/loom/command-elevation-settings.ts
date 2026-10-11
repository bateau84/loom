import { lstat, readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

/**
 * Operator-owned, untracked opt-in for executing arbitrary elevated commands.
 * This is deliberately not read from the repository being evaluated.
 */
export function localLoomSettingsPath(env: NodeJS.ProcessEnv = process.env) {
  const configHome = env.XDG_CONFIG_HOME || join(env.HOME || homedir(), ".config")
  return join(configHome, "opencode", ".loom.yaml")
}

export async function unrestrictedCommandElevationEnabled(
  path: string = localLoomSettingsPath(),
): Promise<boolean> {
  let info
  try {
    info = await lstat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
    throw error
  }
  // Never follow config symlinks or read large/unexpected files.
  if (!info.isFile() || info.isSymbolicLink() || info.size > 8192) return false
  const lines = (await readFile(path, "utf8")).split(/\r?\n/)
  const settings = lines.filter((line) => /^unrestricted_command_elevation\s*:/.test(line))
  if (settings.length !== 1) return false
  const value = settings[0].split(":", 2)[1]?.trim().replace(/\s+#.*$/, "").trim()
  return value === "true"
}
