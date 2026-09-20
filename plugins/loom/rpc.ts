import { Rpc } from "@opencode/plugin/rpc"

export type LoomSidebarTaskStatus = "complete" | "failed" | "runnable" | "pending"
export type LoomSidebarState = "idle" | "active" | "blocked" | "complete"

export type LoomSidebarSnapshot = {
  active: boolean
  workflowId: string
  state: LoomSidebarState
  progress: {
    finished: number
    total: number
    failed: number
  }
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

export const LoomRpc = Rpc.define({
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
          state: { type: "string", enum: ["idle", "active", "blocked", "complete"] },
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
          tasks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                title: { type: "string" },
                status: { type: "string", enum: ["complete", "failed", "runnable", "pending"] },
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
})
