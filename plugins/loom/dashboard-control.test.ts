import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createDashboardControl } from "./dashboard-control"
import type { FleetSnapshot } from "./dashboard"
import {
  createTransactionalStorage,
  ensureRuntimeStateVersion,
  type LoomRuntimeIdentity,
} from "./runtime"

const roots: string[] = []

afterEach(async () => {
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true })
})

async function root() {
  const value = await mkdtemp(join(tmpdir(), "loom-dashboard-control-"))
  roots.push(value)
  return value
}

function fleet(): FleetSnapshot {
  return {
    generatedAt: "2026-09-25T12:00:00.000Z",
    projects: [{
      projectId: "project-a",
      canonicalLocation: "/work/project-a",
      workflows: [],
      workObjectives: [],
    }],
  }
}

describe("dashboard control projection filtering", () => {
  test("observation remains available before canonical runtime state exists", async () => {
    const base = await root()
    const stateRoot = join(base, "state")
    await mkdir(stateRoot, { recursive: true })
    const control = createDashboardControl(join(base, "runtime"), stateRoot)
    await expect(control.filterDeletedWorkflows(fleet())).resolves.toEqual(fleet())
  })

  test("filters projection projects even when a stale publisher has no registry row", async () => {
    const base = await root()
    const stateRoot = join(base, "state")
    await mkdir(stateRoot, { recursive: true })
    const runtime: LoomRuntimeIdentity = {
      installationId: "installation-a",
      instanceId: "instance-a",
      projectId: "project-a",
      canonicalLocation: "/work/project-a",
      identitySource: "loom-project-marker",
      markerLocation: "/work/project-a/.loom/project-id",
      runtimeRoot: join(base, "runtime"),
      stateRoot,
    }
    const raw = await createTransactionalStorage(runtime)
    await ensureRuntimeStateVersion(raw, runtime)
    await raw.set("installation/id", runtime.installationId)

    const projected = fleet()
    projected.projects.push({
      projectId: "stale-project",
      canonicalLocation: "/work/stale-project",
      workflows: [],
      workObjectives: [],
    })

    const control = createDashboardControl(runtime.runtimeRoot, stateRoot)
    await expect(control.filterDeletedWorkflows(projected)).resolves.toEqual(projected)
  })

  test("fails closed when initialized control state cannot be read", async () => {
    const base = await root()
    const stateRoot = join(base, "state")
    // A directory at the database path makes existence true but SQLite open
    // fail, exercising the post-initialization failure boundary.
    await mkdir(join(stateRoot, "execution-state.sqlite"), { recursive: true })
    const control = createDashboardControl(join(base, "runtime"), stateRoot)
    await expect(control.filterDeletedWorkflows(fleet())).rejects.toThrow()
  })
})
