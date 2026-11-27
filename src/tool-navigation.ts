import { ProcessingLimitError } from "./model.js"
import type { EngineeringHistoryQuery, EngineeringHistoryView } from "./engineering-history.js"

/** Complete public requests without changing the queries used by source owners.
 * Only known navigation fields are decorated: original evidence stays intact. */
export function withToolNavigation(name: string, input: Record<string, unknown>, result: unknown): unknown {
  if (name === "history" && input.operation === "read") {
    const view = result as EngineeringHistoryView
    const request = (query: EngineeringHistoryQuery) => ({ operation: "read" as const, ...query })
    const branch = (value: EngineeringHistoryView["branches"][number]) => ({ ...value, expand: request(value.expand) })
    const record = (value: EngineeringHistoryView["records"][number]) => ({ ...value,
      expand: request(value.expand), trajectory: request(value.trajectory) })
    const output = { ...view,
      branches: view.branches.map(branch), ancestors: view.ancestors.map(branch), related_branches: view.related_branches.map(branch),
      selected_branch: view.selected_branch === null ? null : branch(view.selected_branch),
      highlights: view.highlights.map(record), records: view.records.map(record),
      connections: { ...view.connections,
        objectives: view.connections.objectives.map(value => ({ ...value, expand: request(value.expand), details: request(value.details) })),
        reviews: view.connections.reviews.map(value => ({ ...value, details: request(value.details) })),
        ...(view.connections.context ? { context: { ...view.connections.context, read: request(view.connections.context.read) } } : {}),
      },
      navigation: Object.fromEntries(Object.entries(view.navigation).map(([key, query]) => [key, query === null ? null : request(query)])),
    }
    // Navigation is part of the response budget, not an unbounded second payload.
    if (Buffer.byteLength(JSON.stringify(output), "utf8") > 262144)
      throw new ProcessingLimitError("engineering history response exceeds 262144 bytes; narrow the discovery filters or Session scope, or try a smaller page limit")
    return output
  }
  if (name === "objective" && ["list", "find", "read"].includes(String(input.operation))) {
    const page = result as Record<string, unknown>
    const next = input.operation === "read"
      ? typeof page.next_cursor === "string" ? { ...input, cursor: page.next_cursor } : null
      : typeof page.next_offset === "number" ? { ...input, offset: page.next_offset } : null
    return { ...page, navigation: { next },
      ...(input.operation === "find" && Array.isArray(page.items) && page.items.length === 0 ? {
        guidance: "No authored objective matches this exact source in the current project. This is not a text search or proof that no related objective exists. Continue historical investigation with loom_history or loom_record; an objective is only required for population preparation. If authorized to author one, use loom_objective create with the inspected original source and take result.id; otherwise report the missing prerequisite.",
      } : {}),
    }
  }
  return result
}
