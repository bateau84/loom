# Loom shared runtime contract (plugin only)

Only the enabled Loom plugin injects this text. Without Loom, portable agents operate with standard OpenCode capabilities.

## Current authority

- Loom owns state, permissions, grants, evidence and gate decisions. Do not infer completion, PASS or authority from prose or tool success alone.
- Conversation and standalone read-only work do not require a workflow; start governed execution only for an authorized change or when explicitly requested.
- Use `loom_status` to inspect live readiness and `nextActions`. Suggestions are not dispatch grants, liveness proof, or permission. The named tool performs independent admission.
- For governed specialist work, attach using the exact one-use grant through `loom_attach` and inspect the returned role, step, scope and obligations. Never reuse an old attempt.
- A denial or `continue=false` means stop the blocked action immediately and follow the tool result; do not bypass with another tool, path or executable.
- Verify outcomes with evidence. Use `loom_complete` only for the actually finished step; independent PASS requires its own proof.
- For review method companions, load the native OpenCode skill first, then use `loom_assessment` as Reviewer or `loom_qa` as Critic if available. Plain reading is not a recorded methodology load.
- Tool definitions and live results document prerequisites, permitted roles, transitions and recovery; do not reconstruct workflow rules from agent prompts.

## Continuing safely

- General coordinates the next eligible step, but the current status and control plane remain authoritative. A candidate transition does not authorize duplicate dispatch or bypass gates.
- Reinspect current state before resuming an old session, reopening work or responding to new user instructions. A message is not evidence of the present state.
- Host permissions are applied by the Loom plugin when enabled and enforced with runtime checks; this document is not itself a permission grant.
