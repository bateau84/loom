import { access } from "node:fs/promises"
import { join } from "node:path"
import type { FleetSnapshot } from "./dashboard"
import {
  RUNTIME_STATE_VERSION,
  createProjectStorage,
  createTransactionalStorage,
  type LoomRuntimeIdentity,
  type RawStorage,
} from "./runtime"
import {
  deleteWorkflowRecords,
  deletedWorkflowIds,
  type DeleteWorkflowsInput,
} from "./workflow-cleanup"

type ProjectRegistryRecord = {
  projectId: string
  canonicalLocation: string
  identitySource?: LoomRuntimeIdentity["identitySource"]
  markerLocation?: string
}

export type DashboardControl = {
  deleteWorkflows(projectId: string, input: DeleteWorkflowsInput): Promise<unknown>
  filterDeletedWorkflows(fleet: FleetSnapshot): Promise<FleetSnapshot>
}

export function createDashboardControl(runtimeRoot: string, stateRoot: string): DashboardControl {
  let rawPromise: Promise<RawStorage> | undefined

  const rawStorage = async () => {
    if (!rawPromise) {
      // Observation alone must not create canonical Loom execution state. A
      // dashboard can start before any OpenCode/Loom process has initialized
      // the installation; in that case controls remain unavailable.
      await access(join(stateRoot, "execution-state.sqlite"))
      rawPromise = createTransactionalStorage({
        installationId: "dashboard-control-bootstrap",
        instanceId: "dashboard-control-bootstrap",
        projectId: "dashboard-control-bootstrap",
        canonicalLocation: runtimeRoot,
        identitySource: "loom-project-marker",
        markerLocation: runtimeRoot,
        runtimeRoot,
        stateRoot,
      })
    }
    return rawPromise
  }

  const runtimeForProject = async (projectId: string) => {
    const raw = await rawStorage()
    const installationId = await raw.get("installation/id")
    const project = await raw.get(`installation/projects/${projectId}`) as ProjectRegistryRecord | undefined
    if (typeof installationId !== "string" || !installationId) {
      throw new Error("Loom installation identity is unavailable.")
    }
    if (!project || project.projectId !== projectId || typeof project.canonicalLocation !== "string") {
      throw new Error("The requested Loom working directory is not registered.")
    }

    const runtime: LoomRuntimeIdentity = {
      installationId,
      instanceId: "dashboard-control",
      projectId,
      canonicalLocation: project.canonicalLocation,
      identitySource: project.identitySource ?? "loom-project-marker",
      markerLocation: project.markerLocation ?? project.canonicalLocation,
      runtimeRoot,
      stateRoot,
    }
    return { raw, runtime }
  }

  const scopedStorage = async (projectId: string) => {
    const { raw, runtime } = await runtimeForProject(projectId)
    return {
      runtime,
      storage: createProjectStorage(raw, projectId, {
        expectedRuntimeVersion: RUNTIME_STATE_VERSION,
      }),
    }
  }

  return {
    async deleteWorkflows(projectId, input) {
      const { storage, runtime } = await scopedStorage(projectId)
      return deleteWorkflowRecords(storage, runtime, input)
    },

    async filterDeletedWorkflows(fleet) {
      let raw: RawStorage
      try {
        raw = await rawStorage()
      } catch (error: any) {
        // A dashboard may exist before Loom has initialized canonical
        // execution state. That is the one safe fail-open case because no
        // deletion tombstone can exist yet.
        if (error?.code === "ENOENT") return fleet
        throw error
      }

      const projects = await Promise.all(
        fleet.projects.map(async (project) => {
          // Projection can legitimately include stale or synthetic publishers
          // whose project registry row is not currently present. Tombstone
          // filtering needs only the canonical project namespace and runtime
          // version fence; deletion itself still requires registry identity.
          const storage = createProjectStorage(raw, project.projectId, {
            expectedRuntimeVersion: RUNTIME_STATE_VERSION,
          })
          const deleted = await deletedWorkflowIds(storage)
          if (deleted.size === 0) return project
          return {
            ...project,
            workflows: project.workflows.filter((workflow) => !deleted.has(workflow.workflowId)),
          }
        }),
      )
      return { ...fleet, projects }
    },
  }
}
