# Deep retrospective session tracing (OpenCode 2.2.0)

Loom exposes a **read-only** `loom_trace` tool for inspecting original native evidence. There is **one retrospective workflow**: inspect relevant original sessions and child sessions, compare them with General's handoff and repository outcomes, and publish a source-linked account. There is no shallow/standard mode.

## Evidence sources and completeness

| Source | How obtained | What can be stated |
|---|---|---|
| `operation:timeline` without `export_path` | Native `ctx.session.context` **for the caller's own Session only** | Active context after the latest compaction **only**. Original earlier messages may be absent. `coverage.full_history:false`. |
| `operation:timeline` with `export_path` | Explicit project-relative export JSON, opened after host read permission | Native export *shape* with matching Session ID/project/location. It may be stale, shortened, sanitized or modified: `coverage.full_history:null` (unknown). |
| `operation:children` | Native `ctx.session.list` filtered by parent | Direct local children from the caller's bounded Session family only. Follow `next_cursor` and inspect descendants separately. |

The pinned Promise SDK does **not** expose a full native message history method. OpenCode's separate `/api/experimental/session/:sessionID/export` endpoint exports a projected transcript with `sanitize` support, but `loom_trace` deliberately does not call this endpoint or assume authority to extract it. Produce a sanitized export with your existing authorized OpenCode client or UI, then place it in a temporary, private file *within the current project* and provide its relative path. Remove the file after use. Do not commit exports.

For every relevant Session, follow `next_cursor` until null. Each page has page-scoped metrics and tool statuses; `total_events` is unknown (`null`) until the final page. The result includes source message/call IDs, event types, agent, model, tool names/status, skill load names, possible delegation targets, page counts and reported token/cost values. Code Mode wrappers such as `functions.exec` are marked **opaque**, because embedded tool calls and hidden delegation are not established by the native message. Dispatch prompt excerpts and user/assistant excerpts require explicit `include_text:true`. It never returns raw tool outputs, arbitrary input argument values, full skills, attachments, private reasoning or raw whole transcripts. Paging projects only the requested events; provided JSON still must be parsed on each page, so repeated reads of large exports remain a known cost. `include_text` is still sensitive; inspect and redact before quoting.

## Permission and location boundaries

- Native message context is limited to the calling Session. Another Session requires a separately supplied authorized export; shared project/workspace membership does not grant direct context access. Child enumeration is restricted to the caller's native Session family, with bounded ancestor checks.
- Every exported file requires a separate OpenCode `read` permission assertion with the native requesting Session/agent/tool source. Rejection propagates. It is not bypassed by a path under the project.
- File paths must be relative and resolve within the project, with canonicalization, size limit (16 MiB), regular-file check, descriptor identity checks before and after the bounded read, and final no-follow open. Export Session ID, project ID and directory must match the requested native Session.
- Approval can pause execution. Revalidate source Session, path and file identity after approval. Reject replacements and detected content changes; identity checks cannot cryptographically prove provenance or detect malicious content forged with identical metadata.
- Trace reads never change Loom selection, append records, spawn workers or contact agents. Errors leave the original work untouched.

## Deep retrospective procedure

1. Define one bounded Session/time window and identify the goal, actual outcome and previous accepted experiments.
2. Inspect the current Session with `timeline` and related child Sessions with `children`; recurse only where relevant. Child history requires authorized exports, not direct native-context reads. Gather original records and report missing windows.
3. Trace user requirements and corrections through dispatch prompts, agent replies, tool errors/retries, skill loads, handoffs and verification. Cross-check with PRs, tests and CI.
4. Investigate why the process worked or caused friction. Compare counts or cost only with comparable task complexity; many calls are not automatically waste.
5. Report successes, verified problems, unresolved hypotheses, human feedback, and at most two optional reversible experiments. Cite original message/call/commit IDs, not long text dumps. If source coverage is incomplete, call the deep retrospective **incomplete**, not clean.

## Verification boundaries

`tests/session-trace-native.test.ts` covers public tool registration against a simulated OpenCode host plus real Loom storage. It checks read-only projection, direct-child discovery, permission denial, export identity/path guards and preservation of work selection. It is not a full installed-host proof that arbitrary 2.2.0 exports are complete, nor a live trace of actual OpenCode user sessions. Do not claim full-session end-to-end acceptance without checking the real installed host and original exported evidence.
