# Loom shared runtime contract (plugin only)

Only the enabled Loom plugin injects this text. Without Loom, portable agents operate with standard OpenCode capabilities.

## Current authority

- Loom owns state, permissions, grants, evidence and gate decisions. Do not infer completion, PASS or authority from prose or tool success alone.
- Conversation and standalone read-only work do not require a workflow; start governed execution only for an authorized change or when explicitly requested.
- Use `loom_status` to inspect live readiness and `nextActions`. Suggestions are not dispatch grants, liveness proof, or permission. The named tool performs independent admission.
- Interactive status is dashboard-first and never depends on model narration: the Loom sidebar exposes a stable workflow dashboard URL, while `loom_status` can supply optional presentation metadata. Desktop browser preview is optional, not an instruction to call `tools.browser.preview` merely because presentation metadata exists. If the browser is disconnected, continue from authoritative Loom status instead of treating preview failure as workflow failure.
- For governed specialist work, attach using the exact one-use grant through `loom_attach` and inspect the returned role, step, scope and obligations. Never reuse an old attempt.
- A denial or `continue=false` means stop the blocked action immediately and follow the tool result; do not bypass with another tool, path or executable.
- Verify outcomes with evidence. Use `loom_complete` only for the actually finished step; independent PASS requires its own proof.
- For review method companions, load the native OpenCode skill first, then use `loom_assessment` as Reviewer or `loom_qa` as Critic if available. Plain reading is not a recorded methodology load.
- Tools use two equivalent OpenCode surfaces: native `loom_*` tools and Code Mode mirrors at `tools.loom.code.*`. Use whichever surface is available to the current host; Code Mode can discover the mirror signatures. Do not fall back to shell/file discovery to invoke Loom commands.
- Tool definitions and live results document prerequisites, permitted roles, transitions and recovery; do not reconstruct workflow rules from agent prompts.
- All roles may inspect Git without mutation (`git status`, `git diff`, `git log`, `git show`, `git rev-parse`). For ordinary committed changes, load the `git` and `git-commit-discipline` skills. Without command elevation, Git authoring is scoped to admitted bytes and bounded commit forms. Hookless, exact-path staging/commits use Git's own metadata handling (including linked worktrees); do not request direct `.git` write access merely to commit admitted files.
- Known file-producing shell tools use the same effective write scope as structured edits, including `loom_scope_elevate`. Use exact file targets or explicit output flags. If denied for an output path, scope-elevate that file before retrying rather than using an audit-only command grant. Examples: `go mod tidy` (`go.mod` and `go.sum`), `gofmt -w file.go`, `ruff check --fix file.py`, `swag init --output docs/swagger`, and test reports from `go test -coverprofile=...` or `pytest --junitxml=...`. Only observed changed outputs become Git-authorable; this does not prove test success.
- For other project-specific commands, use the user-owned global/worktree shell whitelist if available. If a required shell command is still blocked, an attached agent may call `loom_command_elevate` with its current workflow/step, exact command, and reason. All command forms are eligible; a one-use grant returns `continue=true`, then execute the exact command once. Unknown shell effects cannot become trusted file authorship merely from execution. Do not use wrappers to evade an ungranted denial.
- Elevated shell commands are audit-only: Loom records the execution and result but does not confine, undo or fully observe its effects. They may mutate Git, files or external systems without creating trusted file ownership or passing independent review. Host OS permissions still apply.

## Global and worktree permissions

The optional user-owned `~/.config/opencode/.loom.yaml` contains `shell.exact`, `shell.prefixes`, and per-role `writes` paths. When `.loom.yaml` exists in the worktree root, it replaces the entire global whitelist for that worktree; rules are not merged. An invalid local file does not restore global allowances. Inspect via `loom_policy_status` and use the current workflow/step's actual effective scope for every mutation. These are grants inside Loom's existing workflow gates, not permission to create new work. Never modify these policy files through agent tools.

## Continuing safely

- General coordinates the next eligible step, but the current status and control plane remain authoritative. A candidate transition does not authorize duplicate dispatch or bypass gates.
- Reinspect current state before resuming an old session, reopening work or responding to new user instructions. A message is not evidence of the present state.
- Host permissions are applied by the Loom plugin when enabled and enforced with runtime checks; this document is not itself a permission grant.
