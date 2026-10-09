---
name: git
description: "Practical Git for AI agents: inspect repository state, stage only owned files, commit, branch, sync, push, recover from errors, and use plain Git without unsafe command chaining. Use when executing Git commands in shared worktrees or governed runtimes. For commit boundaries/messages see git-commit-discipline; for conflict semantics see git-conflicts."
license: MIT
metadata:
  author: Bateau
  version: "1.0.0"
---

# Git for agents

Git commands change shared state. Work in small, observable steps: **inspect what matters, run one bounded mutation, read its result, then decide the next step**. Favor completing the task over ceremonial Git checks.

This skill teaches **command choice and execution mechanics**. It does not grant permissions, decide commit content/messages (see `git-commit-discipline`), or decide how to combine conflicting changes (see `git-conflicts`).

## 1. Use the available, authorized tool

- **Use plain Git directly.** Do not require another version-control CLI, extra setup, or different command syntax.
- Keep file paths, branch names, and commit identifiers from current Git output; do not invent selectors.
- An agent's current role, Loom effective write scope, shell admission, and repository rules determine what is allowed. **A skill cannot authorize an otherwise denied command.**
- If a command or argument is blocked, identify the smallest needed permission or scope and request it through the supported runtime path. Do not reroute through `sh -c`, a script, a different binary, another tool, to get around the denial.
- Never edit `.git` internals directly. Git itself may update linked-worktree metadata outside the checkout when the admitted Git command operates from that worktree; that is not permission for direct filesystem edits.

## 2. Keep commands short and independent

**One Git mutation per shell/tool invocation.** Read the exit status and useful output before taking the next mutating action.

- Do not chain dependent mutations using `&&`, `;`, `||`, pipes, command substitution, or a shell script. A failed first command must not leave later commands running or hide which step failed.
- Avoid batches such as `git add ... && git commit ... && git push ...`. These are separate decisions with different possible failures and authority requirements.
- Read-only inspections can be batched only if the runtime permits it and none depends on the other's result. Separate calls are the simpler default, especially in Loom's restricted shell.
- Avoid redundant inspections: do not run `status`, then a verbose `status`, then another `status` without an unanswered question. A successful command's precise output may already be sufficient.
- Never guess identifiers, branches, paths, or flags. Copy identifiers from fresh output; refresh them after a history operation that may invalidate them.
- Stop retrying variations after a clear permission denial. After an unexpected Git error, use at most one targeted read-only check to diagnose it, then correct the cause or report the blocker. Do not run a long speculative recovery chain.

### Bad: one opaque operation

~~~bash
git add -A && git commit -m "fix stuff" && git pull --rebase && git push --force
~~~

### Better: bounded steps, *each in its own tool call*

~~~bash
git status --short
~~~

~~~bash
git diff -- path/to/changed-file
~~~

~~~bash
git add -- path/to/changed-file
~~~

~~~bash
git diff --cached --check
~~~

Then inspect the staged content if necessary, commit using the active runtime's admitted command form, read the commit result, and push only if publishing is part of the assignment. Do not paste those steps as one shell program.

## 3. Inspect only what the decision needs

| Question | Narrow first command |
| --- | --- |
| What is dirty or staged? | `git status --short` |
| What changed in a file? | `git diff -- path/to/file` |
| What is staged? | `git diff --cached --stat` or `git diff --cached -- path/to/file` |
| Which branch am I on? | `git branch --show-current` |
| What did a commit change? | `git show --stat <commit>` |
| How does this branch differ from the base? | `git log --oneline <base>..HEAD` or `git diff --stat <base>...HEAD` |

Do not assume a clean tree, correct branch, or exclusive control of the checkout. In shared sessions, another agent's edits may appear at any time; **never stage, restore, stash, discard, or commit them merely to make Git happy**.

## 4. Stage and commit only owned changes

Use `git-commit-discipline` to decide checkpoint timing, semantic grouping, messages, and destructive-operation safety.

1. Identify the task-owned files and any already staged changes. Preserve unrelated work, including pre-existing staged content.
2. Stage **explicit paths**, not `git add .` / `git add -A` in a shared or mixed worktree.
3. Check what is staged (and `git diff --cached --check` for whitespace/errors). If the staged set contains another task's changes, stop and separate the changes with authorized operations.
4. **Name those same files explicitly in the commit command.** Ensure no one changed the files after staging; a path-scoped Git commit takes the current working-tree bytes, not an older staged snapshot. Read the actual commit result before continuing.

Typical authorized Git steps, issued separately:

~~~bash
git add -- path/to/file path/to/file_test
~~~

~~~bash
git diff --cached --stat
~~~

~~~bash
git diff --cached --check
~~~

~~~bash
git -c core.hooksPath=/dev/null commit -m "fix: update changed file" -- path/to/file path/to/file_test
~~~

The path list after `--` limits the commit to those named files, even if other files were staged. It does **not** freeze the staged bytes: re-stage any changed file before committing. Loom verifies that the named paths were staged and that staged bytes still match the admitted working-tree bytes. A shared index containing work from another Loom step may still be blocked by Loom's ownership rules.

Outside governed Loom, keep repository hooks enabled: `git commit -m "fix: update changed file" -- path/to/file path/to/file_test`. Path-scoped commits are for **whole-file** checkpoints. For partial staging with `git add -p` or for merge/rebase continuation, use the appropriate staged-index/conflict workflow instead. Do not disable hooks merely for convenience outside the explicitly controlled Loom environment.

Partial staging and history editing may be unsupported by Loom's whole-file provenance rules even when Git supports them. Follow the runtime denial; do not switch tools to bypass it.

## 5. Branches, syncing, and publishing

- Confirm the working branch when it matters. Use a feature branch for task work according to repository conventions; avoid switching a dirty, shared worktree just to satisfy a recipe.
- Keep fetching, merging/rebasing, and pushing as distinct operations. Read the result of each before choosing the next. Do not assume a pull/rebase succeeded because a command was issued.
- A request to implement locally is not automatically a request to push or rewrite remote history. A requested PR or delivery normally includes publishing the assigned branch.
- Push the intended branch with an admitted form such as `git push -u origin HEAD`. Never guess a branch name or push every branch.
- Only rewrite history when it is actually required and authorized. For a rewritten published branch, use `--force-with-lease`, not plain `--force`. A lease failure is a remote-state change to investigate, not a reason to retry with `--force`.
- For conflicts, stop the generic Git sequence and apply `git-conflicts`. Never auto-pick `ours` or `theirs`, drop commits, or declare a conflict resolved just because markers are gone.

## 6. Recovery and failure handling

- On an unexpected failure, preserve the working tree and give the **exact failed command and error**. Inspect the relevant Git state once, then use the smallest supported recovery action.
- Do not use `reset --hard`, `clean -fdx`, `branch -D`, `push --force`, or `rebase --skip` as routine cleanup. Follow `git-commit-discipline` and require appropriate explicit authority for destructive operations.
- If the required Git command or argument is unsupported or denied, use an admitted Git approach when one exists. Otherwise, return the exact blocker and request the smallest necessary permission or change of plan.
- Do not introduce another Git frontend or a script wrapper to bypass a runtime restriction.

**Completion evidence:** report the branch, relevant commit(s), published PR/remote state if applicable, and any uncommitted or blocked work. Do not claim a push, commit, sync, or successful recovery that its command output did not establish.
