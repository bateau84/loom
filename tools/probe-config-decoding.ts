// Characterize bounded examples before schema validation; this is NOT a parser memory limit.
import { YAML } from "bun"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { defaults, mergeConfig } from "../src/config.js"

const fixtures: Record<string, string> = {
  plain: "agents:\n  researcher:\n    roles: [research]\n",
  role_alias: "agents:\n  researcher: &r\n    roles: [research]\n  other: *r\n",
  fan_out: "n0: &n0 [x, x, x, x, x, x]\n" + Array.from({ length: 5 }, (_, i) => `n${i + 1}: &n${i + 1} [${Array(6).fill(`*n${i}`).join(", ")}]\n`).join(""),
  cycle: "roles: &r\n  recursive: *r\n",
  depth_100: "unused: " + "[".repeat(100) + "x" + "]".repeat(100) + "\n",
}
function graph(value: unknown) {
  const seen = new Set<object>(), pending = [value]
  let properties = 0, repeatedReferences = 0
  while (pending.length) {
    const next = pending.pop()
    if (!next || typeof next !== "object") continue
    if (seen.has(next)) { repeatedReferences++; continue }
    seen.add(next)
    if (seen.size > 65536) throw new Error("Probe inspection exceeded its object limit")
    const values = Object.values(next)
    properties += values.length
    if (properties > 262144) throw new Error("Probe inspection exceeded its property limit")
    pending.push(...values)
  }
  return { distinct_objects: seen.size, properties, repeated_references: repeatedReferences }
}
if (process.argv[2] === "--case") {
  const name = process.argv[3], source = fixtures[name]
  if (!source) throw new Error("Unknown fixed probe fixture")
  const before = process.memoryUsage().rss, start = performance.now()
  const report: Record<string, unknown> = { fixture: name, source_bytes: Buffer.byteLength(source) }
  let decoded: any
  try {
    decoded = YAML.parse(source)
    report.decode_ms = +(performance.now() - start).toFixed(3)
    report.rss_before = before; report.rss_after_decode = process.memoryUsage().rss
    report.graph = graph(decoded)
    if (name === "role_alias") report.same_agent_object = decoded.agents.researcher === decoded.agents.other
    try { mergeConfig(defaults(), decoded); report.schema_accepted = true }
    catch (error) { report.schema_accepted = false; report.schema_error = String(error).slice(0, 300) }
  } catch (error) { report.decoder_error = String(error).slice(0, 300) }
  console.log(JSON.stringify(report))
} else {
  const reports = Object.keys(fixtures).map(name => {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--case", name], {
      encoding: "utf8", timeout: 5000, maxBuffer: 65536,
    })
    if (result.error || result.status !== 0) throw new Error(`Decoding probe ${name} did not complete: ${result.error ?? result.stderr.slice(0, 300)}`)
    return JSON.parse(result.stdout)
  })
  if (!reports.find(r => r.fixture === "plain")?.schema_accepted) throw new Error("The ordinary configuration fixture did not validate")
  console.log(JSON.stringify({ bun: Bun.version, reports,
    boundary: "Fixed examples in separate processes; RSS snapshots are not peak allocation or general bounds. The timeout belongs to this probe, not Loom's live decoder." }, null, 2))
}
