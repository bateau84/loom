import { retrospectiveMemberKey, type RetrospectiveManifest } from "../../src/retrospective-contract.js"

export const retrospectiveActor = { session_id: "investigator", agent: "researcher" }
export function retrospectiveFixture(count = 7, sourceStoreID = "source-store"): RetrospectiveManifest {
  return {
    format: "loom-retrospective-population/v1", source_store_id: sourceStoreID,
    selection: { mode: "explicit-objective", objective_id: "restore-freshness", question: "What did the correction and scoped verification establish?",
      through: count, owner_boundary: { objective_links: count, review_requests: 0, review_relationships: 0 },
      owner_version: "c".repeat(64), exclusions: [{ record_id: "unrelated", reason: "Connected formatter objective does not answer this question" }] },
    contributors: ["initial", "correction", "verification"],
    objective: { id: "restore-freshness", meaning: "authored-objective", originating_request_independence: "unknown" },
    coverage: { objectives: 1, originals: count, unresolved_native_sources: 1 },
    qualifications: ["original-cause-unproven", "scoped-recheck-is-not-release-acceptance"],
    members: Array.from({ length: count }, (_, index) => {
      const source = { kind: "ledger-record", id: "record-" + index, session_id: ["initial", "correction", "verification"][index % 3]!,
        revision: String(index + 1), sha256: "a".repeat(64), required: true }
      return { key: retrospectiveMemberKey(sourceStoreID, source, "record-full"), source_store_id: sourceStoreID,
        source, permitted_view: "record-full", availability: "available", historical_scope: null,
        basis: [{ meaning: "authored", kind: index === 0 ? "original-failure" : index === 1 ? "unchanged-code-rerun" : "scoped-verification" }],
        qualifications: ["source-reference-is-not-release-authority"] }
    }),
  }
}
