---
name: git-commit-discipline
description: Commit frequency, dual-audience message format, and destructive-git-command safety. Use when about to commit, when running as part of a parallel wave sharing one working tree, when a diff has grown large or mixed multiple concerns, when asked to undo/discard/roll back changes, or when a destructive git command (`reset --hard`, `clean -fdx`, plain `--force`, `branch -D`) has already run and work needs recovering. Not for merge/rebase/cherry-pick conflict resolution (→ See `git-conflicts`).
license: MIT
metadata:
  author: Bateau
  version: "2.0.0"
---

**This skill governs commit frequency, message format, and destructive-git-command safety. Not for merge/rebase/cherry-pick conflict resolution — see `git-conflicts`.**

> **House skill.** Born from a CRITICAL incident: a long-running multi-wave, multi-task session had its entire body of work eradicated by a single `git reset --hard HEAD~1`, because the work had never been committed incrementally - one destructive command deleted hours of multiple waves at once. This skill exists so that never happens again: commit small and often, so the blast radius of any mistake - yours or a destructive command - is never more than the last few minutes of work.

**Persona:** You treat commits as checkpoints (safety) **and** documentation (understanding) - not paperwork. A completed task gets a commit before you move to the next one - not "I'll commit everything at the end." - and that commit's message earns its keep for a human reading it cold, six months later, without you in the room. You treat `git reset --hard`, `git clean -fdx`, `git push --force`, and `git branch -D` as **loaded weapons**: never reached for casually, never used to "clean up" or "undo" without the human explicitly saying those words in THIS turn, and never chained after a failed command out of frustration.

A commit small enough to be safe (§1) is also small enough to explain honestly (§2) - the two disciplines reinforce each other. A commit that mixes three concerns is both a recovery hazard (you can't revert one without the others) and an explanation hazard (there's no single "why" to write down). Split it for either reason and you've split it for both.

## 0. The two problems this skill solves

1. **Loss.** Uncommitted work has no safety net - a single destructive command can erase hours of a session. §1, §4, and §5 exist to make the blast radius of any mistake as small as possible.
2. **Illegibility.** A commit history that only an agent can parse ("classify the type, gate on it, move on") but no human can reconstruct the reasoning from is a second, quieter failure mode - the six-months-later maintainer has to re-derive "why" from git blame and Slack archaeology instead of reading it. §2 exists so the same artifact serves both an agent's fast-scan verification and a human's need to understand *why*, without a second, drifting document (see `../../docs/architecture/dual-audience-commit-report-format.md` for the full design rationale and the invariants this format guarantees for commit messages — historical reference: the commit-format invariants I1-I6 in that document remain accurate, but its handoff-format half and conflation thesis are superseded; the commit format itself is now fully specified in this skill). The worker-to-hub handoff report (§3.3) is a related but distinct artifact - see `../../docs/architecture/worker-handoff-reconciliation.md` for its two-layer Envelope + disk-report spec.

Neither problem excuses the other. A beautifully-explained commit that never got made because you were "waiting to batch it" still loses the work. A frequent, disciplined committer whose messages are all `fix stuff` still leaves nothing for the next reader to learn from. This skill asks for both.

Commit discipline (safety & frequency):

## The one rule that prevents catastrophic loss

**Uncommitted work has no safety net. Committed work (almost) always does.** Every completed task/subtask/wave gets its own commit before you touch the next one - not because git hygiene is pretty, but because a commit is the ONLY thing standing between a mistake and total loss. If you find yourself with more than one task's worth of uncommitted change in the working tree, stop and commit before doing anything else - especially before any command with `reset`, `clean`, `checkout <branch>`, or `stash drop` in it.

## 1. Commit as you go (the root-cause fix)

Never let a multi-wave or multi-task session accumulate uncommitted work. Commit at every natural checkpoint:

- **After each completed task/subtask** - not just when the whole plan is done.
- **Before switching context** - moving to a different file, task, or wave.
- **Before any git operation that touches history or the working tree** (`rebase`, `reset`, `checkout`, `stash`, `clean`) - never run one of these with uncommitted work in flight unless the operation's whole point IS to manage that specific uncommitted change (e.g. `git stash` before a rebase).

```bash
git add <files you actually touched for this task>   # never -A/. mid-task, see §2
git commit -m "<task>: <what changed and why>"
```

A session that commits after every task has a worst-case loss of "one task's work" if something goes wrong - not "everything since the session started." This is the single biggest lever against the incident this skill exists to prevent.

## 2. Splitting a large or mixed diff into smaller commits

If you look at `git status`/`git diff --stat` and see changes spanning multiple unrelated concerns (a bug fix bundled with a refactor, or three tasks' worth of edits sitting uncommitted together), split before committing - never land it as one undifferentiated blob.

```bash
git status                      # full scope of what's dirty
git diff --stat                 # size/shape per file
```

**Stage by logical unit, not by "everything":**

```bash
git add path/to/fileA.go path/to/fileA_test.go   # one concern, explicitly named
git diff --staged                                 # verify ONLY that concern is staged
git commit -m "<concern A>: <what and why>"

git add path/to/fileB.go
git diff --staged
git commit -m "<concern B>: <what and why>"
```

**For a single file mixing two concerns**, stage by hunk instead of by file:

```bash
git add -p path/to/file.go
# y = stage this hunk, n = skip, s = split further if the hunk itself is too coarse,
# q = quit staging (safe - nothing staged yet is lost)
git diff --staged           # confirm exactly the intended hunks are in
git commit -m "<concern A>: <what and why>"
git add -p path/to/file.go  # remaining hunks
git commit -m "<concern B>: <what and why>"
```

**Rule of thumb for "is this one commit or two?":** if you'd write "and" in the commit message ("fix the timeout bug and refactor the client"), it's two commits. Each commit should be revertable on its own without taking an unrelated change down with it.

**Never `git add -A` / `git add .`** when the working tree has more than one concern in it - that flattens the split you just planned. Name files/hunks explicitly (same discipline as `git-conflicts` §5).

Commit format: three layers. Every commit is read by two audiences for two different purposes: an agent scanning for classification/routing, and a human trying to understand *why*. Rather than write two artifacts - one terse, one explained, which inevitably drift apart - this skill uses **one artifact in three layers**. Full design rationale, the invariants each layer guarantees, and the coverage matrix live in `../../docs/architecture/dual-audience-commit-report-format.md` (historical reference — the commit-format invariants I1-I6 in that document remain accurate, but its handoff-format half and conflation thesis are superseded; the commit format itself is now fully specified in this skill); this section teaches the working shape. (The worker-to-hub handoff report, §3.3, follows a related but distinct two-layer spec - see `../../docs/architecture/worker-handoff-reconciliation.md`.)

### 2.1 Layer 1 - Index (the Conventional Commits subject line)

The first line is unchanged from ordinary Conventional Commits and remains machine-parseable by existing tooling (`commitlint`, `semantic-release`, `git log --oneline`):

```
<type>(<scope>)!: <subject>
```

- `type` - `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, etc.
- `(<scope>)` - optional, project-defined (document your project's scope taxonomy once, e.g. in `CONTRIBUTING.md` - don't invent one per commit).
- `!` - optional, marks a breaking change (see 2.3).
- `subject` - imperative, no trailing period, under ~50 chars where possible.

This line alone must let an agent classify the commit without reading further - that's the whole job of Layer 1.

**Trivial-commit escape hatch:** for a typo fix, a one-line doc correction, or any single-file single-concern change where writing a Background/Goal/Reasoning body would be padding, not signal - the subject line is the entire commit. Layer 2 is not required. The test: if you can't fill Background/Goal/Reasoning with anything beyond restating the subject line, skip it - don't manufacture prose to satisfy a template.

**Example 1 - trivial commit (Layer 1 only):**

```
docs: fix typo in README install section
```

Nothing more is needed. This is a complete, correct commit under this format.

### 2.2 Layer 2 - Explanation (the body, in teaching order)

For any non-trivial change, the body follows a fixed teaching order so a human can reconstruct *why*, not just *what*:

```
### Background
### Goal
### Reasoning
### Changes
### Verification
### Follow-ups
```

`Background`/`Goal`/`Reasoning`/`Changes`/`Follow-ups` are recommended, scaled to the size of the change - a small fix might collapse Background+Goal into one line; a multi-file feature earns all five. `### Verification` is the one section that is never optional once the change is non-trivial - a change with no verification section is a change nobody confirmed actually works.

**Example 2 - routine feature commit (Layer 1 + Layer 2):**

```
feat(auth): add refresh-token rotation on login

### Background
Access tokens were static for their full 24h lifetime - a leaked token
stayed valid until natural expiry, with no way to invalidate it early.

### Goal
Rotate the refresh token on every successful login so a leaked token
has a bounded, short blast radius instead of a full-day one.

### Reasoning
Rotating on every login (rather than every request) avoids the extra
DB write on the hot request path while still capping exposure to the
time between logins - acceptable trade-off for this service's traffic
pattern (few logins/day/user).

### Changes
- `auth/session.go`: issue + store a new refresh token on login,
  invalidate the prior one.
- `auth/session_test.go`: covers rotation-on-login and old-token
  rejection.

### Verification
`go test ./auth/... -run TestRefreshRotation -v` - PASS (3 subtests).
Manual check: logged in twice, confirmed first refresh token now
returns 401.

### Follow-ups
None - rotation-on-refresh-use (not just login) was considered and
explicitly deferred; current traffic pattern doesn't need it yet.
```

### 2.3 Layer 3 - Delivery (inline vs file-backed)

Layer 3 is not a new mechanism - it reuses `../../includes/current Loom role directive and control-plane state` §File-Backed Reports exactly: small artifacts travel inline in full; artifacts too large to relay in a dispatch prompt get an inline skeleton (Layer 1 + a Verification summary) plus a path to the full Layer 2 body on disk. A commit itself is always Layer 3 = inline (git doesn't have a "too large" mode); the file-backed case applies to worker-to-hub reports, covered with worked examples in §3.3.

**Breaking changes are a Layer 1 + Layer 2 concern, not a fourth layer:** mark the break in the subject with `!` and a `BREAKING CHANGE:` footer (existing Conventional Commits convention, unchanged), and use Layer 2's `### Reasoning` to carry the "why breaking was necessary" - a breaking change without that reasoning is a landmine for whoever upgrades past it.

**Example 3 - breaking change:**

```
feat(api)!: require API key on all /v2 endpoints

### Background
/v2 endpoints were reachable unauthenticated - a leftover from the
initial internal-only rollout that never got closed before external
partners were onboarded.

### Goal
Require an API key on every /v2 route, closing the unauthenticated
gap before the next partner onboarding.

### Reasoning
This breaks any existing unauthenticated caller - accepted because
the only current callers are two internal services (already updated
in the same release train) and the risk of leaving it open outweighs
the migration cost. Grace period rejected: exposure window itself is
the vulnerability.

### Changes
- `api/v2/middleware.go`: require `X-API-Key` header, reject with 401.
- `api/v2/router_test.go`: covers key-present/absent/invalid cases.

### Verification
`go test ./api/v2/... -v` - PASS (12 subtests, incl. new auth cases).
Confirmed both internal callers already send the header (checked
their deploy configs before merging).

BREAKING CHANGE: /v2 endpoints now require an `X-API-Key` header.
Unauthenticated requests will receive 401 starting this release.
```

## 3. Specific scenarios

### 3.1 Parallel waves: multiple agents, one working tree

`general` dispatches a wave's independent tasks as separate, concurrent subagent sessions (`general.md` -> Wave Execution Protocol, `/orchestrate` step 8: "Emit ALL Task tool calls for the wave in a single response turn"). These sessions are NOT isolated worktrees - every worker in the same wave reads and writes the SAME working tree and the SAME `.git`. That turns "commit as you go" into a shared-state hazard, not just a personal-hygiene one:

- **`git status`/`git diff --stat` can show files you did not touch.** That's a sibling task's in-flight, possibly incomplete work - never stage it, never treat it as part of your own diff's scope, never delete or revert it. Only ever `git add` the exact file(s) YOUR task changed.
- **`git add -A`, `git add .`, and `git commit -a` are forbidden during a wave, full stop - no exceptions.** This is stricter than the single-agent guidance in §2: mid-wave, a broad add doesn't just mix your own concerns, it can commit a sibling's unfinished, unbuilt, unreviewed file under your commit message - a correctness and provenance problem, not just a hygiene one.
- **Before every commit, run `git diff --staged` and account for every line.** If you see a change you don't recognize authoring, STOP - do not commit it. Either your task's file list was wrong, or you've picked up a sibling's edit; either way, resolve it before committing, not after.
- **Generated files don't belong in feature commits, even if `git add -A` would catch them.** Build outputs, bundled JS, compiled CSS, generated protobuf, `dist/`, `build/`, lock files you don't own — these should be in `.gitignore`. If one is showing as modified in `git status` and you didn't author its source, do not stage it. If you genuinely need to commit a regenerated artifact (e.g., snapshot for a release), stage it as its own commit with a clear message — never mixed into a feature commit where it bloats the diff and obscures the actual change.
- **Loom serializes Git index mutations and concrete file writes.** If a sibling currently holds the same file or repository-index lock, the operation is rejected with a retryable lock message before mutation. Wait briefly and retry. Never delete `.git/index.lock` yourself; a persistent raw Git lock error is still an escalation signal.
- **Overlapping bounded task scopes are allowed.** If another task also has authority for a file you need, that overlap alone is not a scope defect. Retry only when an active writer holds the file lock, then re-read and revalidate the current file before editing. Return to planning only when the tasks have a real semantic/order conflict or the required mutation falls outside your own granted scope.

### 3.2 Breaking changes

Reach for `!` + `BREAKING CHANGE:` (see §2.3, Example 3) whenever the change removes or alters an existing contract a caller could reasonably depend on - a changed function signature, a removed field, a stricter validation that used to pass. The mechanical marker is cheap; the discipline that matters is putting the "why this break was worth it, and what it costs the caller" into `### Reasoning` - a breaking change with an empty reasoning section is indistinguishable from an accident to the next reader.

### 3.3 Worker handoffs (worker-to-hub reports)

A worker's handoff to its dispatching hub is **two layers, not the commit's three-layer vocabulary**: an inline Summary Envelope (`../../includes/current Loom role directive and control-plane state` § Summary Envelope - control token, `Report:` path, `Outcome`, `Routing` bullets including a mandatory `Status: DONE | PARTIAL COMPLETION | ESCALATED` bullet, `Concerns/Assumptions`) plus an on-disk structured report whose field order and mandatory-field discipline follow the 9-field table in `../../docs/architecture/worker-handoff-reconciliation.md` § Layer 2. Field 4 of that table (`Verification`) is **mandatory** in the disk report, not merely recommended - a report reaching the Shipping Gate without it cannot honestly claim gate-readiness.

Note: the disk report's Status field (the `## Status: DONE` / etc. heading) is a routing/status heading for the hub to scan, not a Conventional Commits subject - it is not matched against the `type(scope): subject` regex a commit's Layer 1 must satisfy.

**Example 4 - small handoff, delivered as Envelope + disk report:**

```
Report: docs/ephemeral-reports/worker/session-store-redis-migration/task-2-3.md

**Outcome:** Added input validation for CreateUser at the handler layer.

**Routing:**
- Status: DONE — Task 2.3
- Files changed: api/users_handler.go, api/users_handler_test.go
- Build: pass — `go build ./...` clean
- Test: pass — `go test ./api/... -run TestValidateCreateUserInput -v` (4/4)
- Lint: pass
- Remaining: none
```

This is the complete inline artifact returned to the hub. The on-disk report at the `Report:` path carries the 9-field-ordered detail (`## Status: DONE`, `### Changes`, `### Verification`, etc. per `worker-handoff-reconciliation.md` § Layer 2) - not reproduced here beyond this pointer. The Envelope's `Status:` bullet is the exact-vocabulary string the hub copies into `Prior Findings` on re-dispatch and reads at step-limit recovery, without opening the disk report.

**Example 5 - large handoff, disk report trims optional fields:**

```
Report: docs/ephemeral-reports/worker/session-store-redis-migration/task-4.md

**Outcome:** Migrated session storage from in-memory to Redis; sessions
now survive a service restart.

**Routing:**
- Status: DONE — Task 4
- Files changed: sessions/redis_store.go, sessions/redis_store_test.go, sessions/memory_store.go (removed), sessions/cleanup.go (removed), sessions/config.go, go.mod
- Build: pass — `go build ./...` clean
- Test: pass — `go test ./sessions/... -tags=integration -v` (9/9, against a local Redis testcontainer)
- Lint: pass
- Remaining: none
```

Same Envelope shape as Example 4. The disk report at the `Report:` path carries the full trade-off rationale (Redis vs. extending the in-memory store) in its `### Decisions` section, and omits the optional `### Findings fixed/confirmed` section entirely since this is a first pass, not a re-dispatch. Under the two-layer model, all nine of the reconciliation's fields live in the disk report by default - the Envelope only ever carries the fixed 5-part shape plus the mandatory `Status:` bullet, regardless of report size.

## 4. The safe-undo decision tree

Reverting a poorly-explained commit is where the cost of skipping §2 becomes visible: without a `### Reasoning` section, you're reverse-engineering *why* a change existed before you can safely judge whether undoing it is correct. A well-formed commit body makes "should I revert this" a five-second read instead of an archaeology dig - that's the format paying for itself at exactly the moment it matters most.

"Undo this" or "discard that" does NOT mean `git reset --hard`. Pick the narrowest tool that matches what's actually being undone:

| What you're undoing                                      | Safe tool                                               | Why not `reset --hard`                                                                                                                                        |
| -------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Uncommitted changes to specific file(s)                  | `git restore <file>`                                    | Scoped - doesn't touch other files or history                                                                                                                 |
| All uncommitted changes, but might want them back        | `git stash` (not `stash drop` until confirmed unneeded) | Reversible - `git stash pop` brings it back                                                                                                                   |
| A commit that's already pushed/shared                    | `git revert <sha>`                                      | Adds an inverse commit - never rewrites history others may have pulled                                                                                        |
| A local commit not yet shared, keeping the changes       | `git reset --soft HEAD~1` (or `--mixed`)                | Moves the branch pointer but keeps your work in the index/working tree - nothing is deleted                                                                   |
| Genuinely and permanently discarding history, on purpose | `git reset --hard`                                      | **Only after the human has explicitly said those exact words in THIS turn.** This is the one command in this table that deletes work with no git-native undo. |

**`git reset --hard` is never your own idea of "cleaning up."** If a task didn't work out, `git revert` or a fresh commit that fixes it forward is almost always safer and just as fast. Reach for `--hard` only when explicitly instructed, and even then, checkpoint first (see §5.1) before running it.

## 5. Recovery

### 5.1 Before ANY `--hard` reset, `clean -fdx`, or plain force-push

These are the only git operations with no native undo. Treat them exactly like the operational-safety rules that already govern destructive actions system-wide. **This does NOT include `--force-with-lease`** - it has its own native safety check (git refuses if the remote moved since your last fetch) and is the routine, no-confirmation-needed way to push a rebased branch (see `git-conflicts` skill). Plain `--force`/`-f` has no such check and is what this section guards:

1. **Confirm the human said it, in this turn, in those words.** Not "let's move on" - the actual operation.
2. **Note the current HEAD SHA first** (`git rev-parse HEAD`) so recovery in §5.2 has a known-good anchor if this turns out to be a mistake.
3. **Run it once, scoped as narrowly as the human's request allows** - prefer `git reset --hard <specific-sha>` over a bare `HEAD~1` if there's any ambiguity about which commit is meant.

### 5.2 Recovery: a destructive reset already happened

**First, know which of two different things was lost - the recovery path is NOT the same for both:**

- **Uncommitted working-tree changes** (the far more common case - this is what `reset --hard` destroys 99% of the time, since committed work is what §1-2 exist to create in the first place). `git reflog` **cannot help here at all** - reflog only tracks ref/HEAD movements, i.e. commits. It has no record of file content that was never committed. Go straight to §5.2a.
- **An actual commit** that existed and got orphaned by moving the branch pointer (e.g. `reset --hard HEAD~1` when the work WAS committed). Reflog can recover this - see §5.2b.

If unsure which happened, check both - they are not mutually exclusive, and §5.2a's snapshot may also contain commits.

#### 5.2a. Recovering uncommitted content: opencode's own session snapshot (try this FIRST)

Opencode captures a full working-tree snapshot at the start of every session, before the agent's first tool call - independent of git entirely, so it survives even total working-tree destruction. This is a proven, empirically-verified recovery path (see the incident memory this section is drawn from), not a theoretical one.

1. **Find the project and session.**
   ```bash
   sqlite3 ~/.local/share/opencode/opencode.db \
     "SELECT id, worktree FROM project WHERE worktree LIKE '%<repo-name>%';"
   sqlite3 ~/.local/share/opencode/opencode.db \
     "SELECT id, directory, title, time_created FROM session WHERE directory LIKE '%<repo-name>%' ORDER BY time_created DESC LIMIT 20;"
   ```
2. **Pull the session's parts and find its first snapshot.** The very first `step-start` event of a session (before any tool call) carries a full-tree snapshot hash - this is the pre-work state, exactly what you want:
   ```bash
   sqlite3 ~/.local/share/opencode/opencode.db \
     "SELECT time_created, data FROM part WHERE session_id='<id>' ORDER BY time_created LIMIT 5;"
   ```
   Look for `{"snapshot":"<tree-sha>","type":"step-start"}` - the earliest one in the session is the baseline before that session touched anything.
3. **Locate the snapshot's git-dir** (a real, separate git repository, keyed by project hash then a hash of the worktree path):
   ```bash
   ls ~/.local/share/opencode/snapshot/<project-top-level-hash>/
   # each subdirectory is a candidate; confirm the right one:
   GIT_DIR=<candidate> git config --get core.worktree   # must match your real worktree path exactly
   ```
4. **Never trust it blind - verify before restoring.** Confirm it's a real object and sanity-check line counts against what you remember/expect:
   ```bash
   GIT_DIR=<snap> git cat-file -t <tree-sha>                          # expect "tree"
   GIT_DIR=<snap> git diff <known-good-commit> <tree-sha> --stat       # compare against the diff --stat you captured (or remember) BEFORE the mistake
   ```
   If you have specific remembered facts (an exact line fix, a specific bug description), spot-check 1-2 individual files' diffs byte-for-byte against that memory before trusting the whole snapshot.
5. **Restore by explicit path list only - never a bare checkout of the whole tree:**
   ```bash
   GIT_DIR=<snap> GIT_WORK_TREE=<real-worktree-dir> git checkout <tree-sha> -- <file1> <file2> ...
   ```
   This form is additive/overwriting only - it can never delete a file outside the list, so it's safe even if you have the wrong tree hash (worst case: it overwrites nothing useful, it does not destroy anything further).
6. **Verify in the real repo** - `git status`, `git diff --stat`, and a real build - before treating recovery as complete.

#### 5.2b. Recovering a lost commit: git reflog

Only relevant when the destroyed thing was itself a commit (not just uncommitted content). `git reset --hard` does **not** delete the old commit immediately - it only moves the branch pointer. The old commit is still reachable via reflog until garbage collection prunes it (default: unreachable objects survive ~30 days, reachable ones ~90):

```bash
git reflog                          # find the entry just BEFORE the reset - it shows the old HEAD sha
git reflog show HEAD                # same, more explicit
```

Once you have the pre-reset SHA:

```bash
git branch recovered-work <sha>     # safest first move - a new branch, zero risk, inspect before deciding
git log --oneline recovered-work    # confirm this is really the lost work
```

If it checks out, either fast-forward the original branch to it, or cherry-pick the specific commits back onto the current HEAD - whichever the human wants. **Do not run a second `reset --hard` to "fix" the first one** until the recovery branch is confirmed good; work from a safe copy.

If `git reflog` shows nothing (rare - usually means the reflog itself was disabled or already expired), stop and escalate immediately rather than guessing further; further git surgery on a repo already missing its safety net is how a bad day becomes a worse one.

## 6. Escalation

Two failed attempts at recovery, or a genuinely ambiguous "what did they mean by undo" - stop and ask. This is the same one-probe-then-escalate discipline as `git-conflicts`: git surgery performed under uncertainty is how incidents compound instead of resolve.

## See also

- `git-conflicts` - resolving merge/rebase/cherry-pick conflicts (a different problem: content collision, not destructive history loss).
- `/commit` command - the review → commit → rebase → PR workflow this skill's incremental commits feed into.
- `/orchestrate` command - wave execution; §3.1 (parallel waves) is the shared-working-tree hazard this drives.
- `ocw` worktree launcher - isolates each branch in its own directory, so a mistake in one task's worktree can't reach another's.
- `plugins/guard-destructive-git.js` - the mechanical backstop for this skill: blocks `reset --hard`, `clean -fdx`, plain force-push (`--force`/`-f`), and `branch -D` on EVERY branch (not just protected ones), requiring an explicit human-set escape hatch. `--force-with-lease` is exempt - it has its own native safety check and is how you push a rebased branch (see `git-conflicts` skill). A skill is advisory; this guard is what actually stops the command if the discipline above is skipped under pressure.
- `../../docs/architecture/dual-audience-commit-report-format.md` - the design rationale, invariants (I1-I6), and input/operation coverage matrix behind §2's three-layer commit format. Read this for *why* the format is shaped this way, not just *how* to use it (historical reference — the commit-format invariants I1-I6 in that document remain accurate, but its handoff-format half and conflation thesis are superseded; the commit format itself is now fully specified in this skill). (For the worker-to-hub handoff report's two-layer spec, §3.3, see `../../docs/architecture/worker-handoff-reconciliation.md` instead.)
- `../../docs/reports/research/commit-message-research.md` - the Conventional Commits standard, SemVer mapping, and `semantic-release` tooling this format's Layer 1 builds on without modification.
- `../../includes/current Loom role directive and control-plane state` §File-Backed Reports - the inline-vs-skeleton+path delivery rule §2.3/§3.3 reuse for worker-to-hub handoffs, rather than inventing a new threshold.
