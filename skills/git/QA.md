# git — Critic QA

Challenge cases where Git output looks successful but the work is incomplete, misattributed, or unsafe.

## QA criteria

- **Shared checkout race:** another agent edits or stages a file between status, add, and commit. Could the reported commit silently absorb work the acting agent does not own?
- **Path-scoped commit surprise:** explicit `git commit -- <files>` selects the current worktree bytes, not necessarily the index snapshot. Are the exact files staged and unchanged, and are broad/unstaged selectors rejected under Loom?
- **Partial-staging exception:** a non-Loom workflow stages hunks with `git add -p`. Would adding a filename to `git commit` accidentally include the deliberately unstaged hunks?
- **Partial success:** commit succeeds, fetch/rebase fails, or one remote push succeeds while another fails. Does the final claim accurately separate completed and blocked steps?
- **Stale selectors:** an ID or branch target changed after a Git history mutation. Would the agent reuse it without checking?
- **Tool fallback laundering:** a Loom denial affects a specific subcommand or argument. Could a shell wrapper, alias, script, or other executable achieve the same forbidden mutation?
- **History and concurrency:** a remote branch advanced after fetch. Would force-with-lease failure preserve remote work rather than invite unsafe force-push?
- **Misleading cleanliness:** a clean status coexists with a wrong branch, wrong commit contents, dropped changes, or an unresolved semantic conflict. Is the evidence specific enough to detect it?

Do not demand extra ritual checks when existing authoritative command output already answers the question. Escalate only concrete risks to task ownership, command authority, history preservation, or result accuracy.
