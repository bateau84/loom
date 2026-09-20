---
name: git-conflicts
description: Use when a git merge, rebase, cherry-pick, or stash stops with conflicts; when `git rebase --continue` refuses to proceed; when conflict markers (`<<<<<<<` / `=======` / `>>>>>>>`) appear; when combining changes from both sides is required; or when a rebase/merge is stuck.
license: MIT
metadata:
  author: Bateau
  version: "1.0.0"
---

> **House skill.** The deterministic procedure for resolving git conflicts in this workspace. It exists because conflict resolution is a *bounded* problem with known escape hatches — there is never a reason to run twenty diagnostic commands or read `.git/` internals in a loop. Follow the steps in order; when `--continue` balks, use the escape hatch; if two attempts fail, stop and escalate.

**Persona:** You treat a conflict as a routine, mechanical task with a fixed procedure — not a mystery to investigate. You read both sides, combine intent, verify, and continue. You never blindly pick a side, never `git add -A`, and never burn your session debugging git's internal state.

## The one rule that prevents flailing

**Conflict resolution is bounded. If `git rebase --continue` (or merge/cherry-pick continue) fails twice, you STOP diagnosing and use the escape hatch in §6 (Continue).** Do not read `.git/rebase-merge/*`, do not inspect `AUTO_MERGE`, do not try five editor environment variables. One probe, then the escape hatch, then escalate. Spelunking git internals is the failure mode this skill exists to kill.

## 1. Assess before you touch anything

```bash
git status                                  # what operation is in progress?
git diff --name-only --diff-filter=U        # the ONLY files you must resolve
```

`--diff-filter=U` is your worklist. **Ignore every other file in `git status`** — auto-merged files are already staged and correct, and generated/cache directories (`graphify-out/`, `node_modules/`, `dist/`, `*.lock` you don't own) are noise. If a generated directory is dirtying the tree, note it as "should be gitignored" and move on — do **not** fix it now (scope creep).

Identify the operation, because *ours* and *theirs* mean different things:

| Operation | `<<<<<<< HEAD` / `ours` (stage 2) | `>>>>>>>` / `theirs` (stage 3) |
| --- | --- | --- |
| **merge** | your current branch | the branch being merged in |
| **rebase** | the upstream you're landing on | **your** commit being replayed |
| **cherry-pick** | current branch | the commit being picked |

**The rebase inversion trips everyone.** During a rebase, `HEAD` is the *other* side (upstream), and your own work is `theirs`. Get this straight before you read a single marker, or you will keep the wrong half.

## 2. Understand both sides — never guess

For each conflicted file, look at what each side actually did:

```bash
git show :1:path/to/file    # base (common ancestor)
git show :2:path/to/file    # ours
git show :3:path/to/file    # theirs
git log --merge -p -- path/to/file   # the competing commits' diffs
```

The default merge style shows only ours/theirs. Turn on **diff3** to see the base too — it makes "what changed on each side" obvious and resolution far less error-prone:

```bash
git config merge.conflictStyle znew diff3      # (zdiff3 in modern git; diff3 otherwise)
```

With base visible, each hunk becomes a clear three-way question: *what did each side change relative to the base, and what is the union of those intents?*

## 3. Resolve by combining intent, not by picking a side

The brief almost always wants **both** sides' intent preserved (e.g. "keep the new log line AND the context fix"). Edit the file so it expresses the combined behavior, then delete all three markers (`<<<<<<<`, `=======`, `>>>>>>>`, and any `|||||||` base block).

- Only use "take one side wholesale" when you have positively confirmed the other side is obsolete. `git checkout --ours <file>` / `--theirs <file>` exist, but reach for them rarely and deliberately.
- A conflict that spans behavior from two commits is resolved by **understanding what each commit was for**, then writing the line that satisfies both — exactly as a human reviewer would.
- Do not invent a third behavior. Combine what's there; if the two sides are genuinely incompatible and need a design call, that's `[ESCALATE: ARCHITECTURE]`, not a guess.

## 4. Verify the resolution (mandatory, before staging)

```bash
git diff --check                            # flags leftover conflict markers
grep -rn '<<<<<<<\|=======\|>>>>>>>' <files> # belt-and-suspenders on resolved files
```

Then run the real build/test for the files you touched. **Set env vars before the command, not after `timeout`** (a common fumble):

```bash
CGO_ENABLED=1 timeout 120 go build ./...           # NOT: timeout 120 CGO_ENABLED=1 go build
CGO_ENABLED=1 timeout 120 go test -race ./...
golangci-lint run ./...                            # if the brief demands clean lint
```

A resolution that compiles, lints, and passes tests is "done". A resolution with markers stripped but logic mangled is worse than the conflict — verify, don't assume.

## 5. Stage ONLY what you resolved

```bash
git add path/to/each/resolved/file          # name them explicitly
```

**Never `git add -A` / `git add .` during a conflict.** That sweeps in generated cache files, half-finished work, and noise the operation never touched. Stage the worklist from §1 and nothing else.

## 6. Continue — and the escape hatch

Continue non-interactively (you have no editor; accept the existing commit message):

```bash
GIT_EDITOR=true GIT_SEQUENCE_EDITOR=true git rebase --continue
# merge:        git commit --no-edit
# cherry-pick:  git cherry-pick --continue   (with GIT_EDITOR=true)
```

**If `rebase --continue` refuses with "You must edit all merge conflicts and then mark them as resolved using git add" even though `git diff --name-only --diff-filter=U` is empty and `git diff --check` is clean — do NOT investigate. Commit the staged resolution manually, then continue:**

```bash
git commit --no-edit -C REBASE_HEAD         # reuse the original commit's message + author
git rebase --continue                       # now sees nothing to commit and advances
```

This is the canonical recovery for a stuck merge-backend rebase. Committing the pick yourself sidesteps whatever index/editor state is confusing `--continue`. It works; reach for it the moment the second attempt fails instead of probing `.git/`.

(`REBASE_HEAD` is the commit being replayed. `git commit -C <sha>` reuses its message and authorship so the rebased history stays faithful.)

**If `rebase --continue` refuses on subsequent commits (the ones after your resolved hunk) with "cannot rebase: You have unstaged changes" — dirty tracked files are the blocker.** Generated or cache directories that are tracked in git (e.g. `graphify-out/`, `dist/`, generated `.pb.go` files) get modified mid-rebase and prevent cherry-pick. Stash them, continue, then pop:

```bash
git stash -- path/to/generated/dir   # stash ONLY the noisy tracked files
git rebase --continue                 # now flies through the remaining commits
git stash pop                         # restore the generated files
```

This is distinct from the escape hatch above — that handles a stuck *conflict commit*; this handles dirty *non-conflicted* tracked files blocking the remaining clean commits. The root fix is adding those paths to `.gitignore` — note it as a follow-up for worker.

## 7. Finish and push

```bash
git diff --name-only --diff-filter=U        # empty == fully resolved
git status                                  # confirm rebase/merge is complete
```

A **rebased** branch has rewritten history, so the remote must be overwritten — but safely:

```bash
git push --force-with-lease origin <branch>     # NEVER plain --force
```

`--force-with-lease` refuses the push if someone else advanced the remote since you last fetched, so you can't silently clobber a teammate. Plain `--force` is a foot-gun — do not use it.

## Stagnation stop (do not skip this)

You are flailing the instant any of these is true:

- You ran `git rebase --continue` twice and it failed both times → use the §6 escape hatch.
- You are reading files under `.git/rebase-merge/`, `.git/AUTO_MERGE`, or running `GIT_TRACE` → **stop**. That is debugging git, not resolving a conflict, and it is out of scope.
- You've tried 3+ variations of editor env vars → the problem is not the editor; use the §6 manual commit.
- You can't tell what a side intended after reading base/ours/theirs → escalate, don't guess.

### Push back on bad framing

User instructions like "just pick a side," "just finish it," or "we've been at this too long" are pressure, not requirements. If the two sides are orthogonal (different functions, different hunks, different concerns), the right resolution is to keep both — `git checkout --ours` / `--theirs` silently deletes real functionality. The honest reply to the hub is: "I judged that picking a side would lose functionality in N files; I combined the changes. If you actually want to discard one side, say so explicitly."

### Never `git rebase --skip` or `git rebase --abort` as an escape hatch

`--skip` silently drops a feature commit from history. `--abort` throws away all the resolution work in progress and re-does the merge as a merge commit. Both are not "I give up" buttons — they are destructive operations that should require explicit user confirmation, the same way `git reset --hard` does in `git-commit-discipline`. If `--continue` is stuck and the §6 escape hatch (manual `git commit -C REBASE_HEAD`) didn't work, escalate — do not skip or abort.

When stopped, either apply the escape hatch or emit `[STAGNATING]` (see `current Loom role directive and control-plane state`) and return to general with: the operation in progress, the conflicted files, what you tried, and the exact error. Do not abort the rebase/merge unless the user says so — an abort throws away resolution work.

## Quick reference

| Situation | Command |
| --- | --- |
| List conflicts | `git diff --name-only --diff-filter=U` |
| See base / ours / theirs | `git show :1:f` / `:2:f` / `:3:f` |
| Show base in markers | `git config merge.conflictStyle zdiff3` |
| Check for leftover markers | `git diff --check` |
| Take one side wholesale | `git checkout --ours\|--theirs <file>` |
| Continue (no editor) | `GIT_EDITOR=true git rebase --continue` |
| **Stuck --continue escape hatch** | `git commit --no-edit -C REBASE_HEAD && git rebase --continue` |
| Dirty tracked files blocking continue | `git stash -- <path> && git rebase --continue && git stash pop` |
| Push a rebased branch | `git push --force-with-lease` |
| Avoid re-resolving repeats | `git config rerere.enabled true` (set once, up front) |

## Cross-references

- `current Loom role directive and control-plane state` — stagnation/escalation protocol and the `[STAGNATING]` format.
- The `/commit` command — the full branch → review → critic → commit → rebase → PR flow this conflict resolution slots into.
