import type { Rpc } from "@opencode/plugin/rpc"

export type LoomSidebarTaskStatus = "complete" | "failed" | "runnable" | "pending"
export type LoomSidebarState = "idle" | "active" | "blocked" | "complete" | "cancelled"
export type LoomSidebarWorkStatus =
  | "pending"
  | "active"
  | "blocked"
  | "complete"
  | "cancelled"
  | "superseded"

export type LoomSidebarWork = {
  plan?: {
    revision: number
    goal: string
    invalidated?: boolean
  }
  objective: {
    id: string
    title: string
    objective?: string
    status: LoomSidebarWorkStatus
    progress: { finished: number; total: number }
  }
  generation: number
  phases: Array<{
    id: string
    title: string
    objective?: string
    status: LoomSidebarWorkStatus
    progress: { finished: number; total: number }
    waves: Array<{
      id: string
      title: string
      objective?: string
      status: LoomSidebarWorkStatus
      progress: { finished: number; total: number }
      tasks: Array<{
        id: string
        title: string
        objective?: string
        openQuestions?: number
        status: LoomSidebarTaskStatus
      }>
    }>
  }>
}

export type LoomSidebarSnapshot = {
  active: boolean
  workflowId: string
  state: LoomSidebarState
  planningOnly?: boolean
  progress: {
    finished: number
    total: number
    failed: number
  }
  work?: LoomSidebarWork
  statusUrl?: string
  tasks: Array<{
    id: string
    title: string
    status: LoomSidebarTaskStatus
  }>
  now: Array<{
    id: string
    label: string
    agent: string
    kind: "work" | "gate"
  }>
  openQuestions: number
  openVerification: number
}

const progressSchema = {
  type: "object",
  properties: {
    finished: { type: "number" },
    total: { type: "number" },
  },
  required: ["finished", "total"],
  additionalProperties: false,
} as const

const workStatusSchema = {
  type: "string",
  enum: ["pending", "active", "blocked", "complete", "cancelled", "superseded"],
} as const

const taskStatusSchema = {
  type: "string",
  enum: ["complete", "failed", "runnable", "pending"],
} as const

export const LoomRpc = {
  id: "loom.control",
  methods: {
    sidebar: {
      input: {
        type: "object",
        properties: {
          sessionID: { type: "string" },
        },
        required: ["sessionID"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          active: { type: "boolean" },
          workflowId: { type: "string" },
          state: { type: "string", enum: ["idle", "active", "blocked", "complete", "cancelled"] },
          planningOnly: { type: "boolean" },
          progress: {
            type: "object",
            properties: {
              finished: { type: "number" },
              total: { type: "number" },
              failed: { type: "number" },
            },
            required: ["finished", "total", "failed"],
            additionalProperties: false,
          },
          work: {
            type: "object",
            properties: {
              plan: {
                type: "object",
                properties: {
                  revision: { type: "number" },
                  goal: { type: "string" },
                  invalidated: { type: "boolean" },
                },
                required: ["revision", "goal"],
                additionalProperties: false,
              },
              objective: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  title: { type: "string" },
                  objective: { type: "string" },
                  status: workStatusSchema,
                  progress: progressSchema,
                },
                required: ["id", "title", "status", "progress"],
                additionalProperties: false,
              },
              generation: { type: "number" },
              phases: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    title: { type: "string" },
                    objective: { type: "string" },
                    status: workStatusSchema,
                    progress: progressSchema,
                    waves: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          id: { type: "string" },
                          title: { type: "string" },
                          objective: { type: "string" },
                          status: workStatusSchema,
                          progress: progressSchema,
                          tasks: {
                            type: "array",
                            items: {
                              type: "object",
                              properties: {
                                id: { type: "string" },
                                title: { type: "string" },
                                objective: { type: "string" },
                                openQuestions: { type: "number" },
                                status: taskStatusSchema,
                              },
                              required: ["id", "title", "status"],
                              additionalProperties: false,
                            },
                          },
                        },
                        required: ["id", "title", "status", "progress", "tasks"],
                        additionalProperties: false,
                      },
                    },
                  },
                  required: ["id", "title", "status", "progress", "waves"],
                  additionalProperties: false,
                },
              },
            },
            required: ["objective", "generation", "phases"],
            additionalProperties: false,
          },
          statusUrl: { type: "string" },
          tasks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                title: { type: "string" },
                status: taskStatusSchema,
              },
              required: ["id", "title", "status"],
              additionalProperties: false,
            },
          },
          now: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                label: { type: "string" },
                agent: { type: "string" },
                kind: { type: "string", enum: ["work", "gate"] },
              },
              required: ["id", "label", "agent", "kind"],
              additionalProperties: false,
            },
          },
          openQuestions: { type: "number" },
          openVerification: { type: "number" },
        },
        required: [
          "active",
          "workflowId",
          "state",
          "progress",
          "tasks",
          "now",
          "openQuestions",
          "openVerification",
        ],
        additionalProperties: false,
      },
    },
  },
  events: {},
} as const satisfies Rpc.PortableDefinition
