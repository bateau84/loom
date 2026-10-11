# Loom permissions: global defaults and worktree overrides

Loom supports optional **user-owned** command and write whitelists. This uses the policy shape introduced by [PR #163](https://github.com/bateau84/loom/pull/163), but applies a separate policy per working directory when present.

## Precedence

1. **Worktree policy:** `<current-worktree-root>/.loom.yaml` replaces the global whitelist for both shell commands and writes if present.
2. **Global policy:** `$XDG_CONFIG_HOME/opencode/.loom.yaml` (normally `~/.config/opencode/.loom.yaml`) applies only when the worktree file is absent.
3. **No policy:** Loom uses its existing built-in permission behavior.

**Replacement, not merging:** Missing `shell` or `writes` keys in a worktree file mean no additional grants for that category. A malformed, symlinked, group/other-writable, **Git-tracked**, or otherwise unsafe worktree file never falls back to global permissions. Trackable repository content cannot silently authorize its own access. Remove the local file to restore the global whitelist. These are *additions* to Loom's usual bounded permissions, not a way to forbid its routine allowed commands.

Loom does not create these files. Changes apply at the next permission check, without a restart. Use `loom_policy_status` to inspect the effective rules, source, and errors.

## Global example

Place in `~/.config/opencode/.loom.yaml` or the XDG equivalent:

```yaml
version: 1
shell:
  exact:
    - "go version"
    - "go mod tidy -diff"
    - "make test"
  prefixes:
    - "just test"
writes:
  worker:
    - "src/**"
    - "pkg/**"
  designer:
    - "docs/design/**"
  documenter:
    - "docs/system/**"
```

## PR worktree example

Place in the **root** of one linked worktree (for example `/home/me/pr-163/.loom.yaml`):

```yaml
version: 1
shell:
  exact:
    - "make check"
    - "go test ./..."
  prefixes:
    - "just integration"
writes:
  worker:
    - "cmd/**"
    - "internal/**"
  documenter:
    - "docs/user/**"
```

The PR worktree sees **only** this file's configured exceptions; the global `make test` and `src/**` grants no longer apply in that worktree. Other worktrees without their own `.loom.yaml` still use the global policy.

The global file may also contain `projects:` keyed by absolute project paths for compatibility with PR #163. An explicit worktree-root `.loom.yaml` overrides those entries too. Worktree files themselves must use only `version`, `shell` and `writes`.

## Matching and authority

- `shell.exact` matches the full command; `shell.prefixes` matches at a complete word boundary. Syntax involving shell chains, redirects, Git mutation or common wrapper bypasses is not admitted through routine whitelist matching. Use `loom_command_elevate` for a specific one-use host command of those forms; its audit cannot contain side effects.
- Configured `writes` are bounded project-relative file globs for producing roles (Worker, Designer, Specifier, Architect, Documenter), merged with the current step's effective write scope. No blanket `*`/`**`, out-of-project path, internal Git/Loom state, durable reports, or `.loom.yaml` self-modification is authorized. Symlinks escaping the project remain blocked by runtime revalidation.
- Both command and write exceptions still require a current runnable Loom step and valid role/ownership admission. An unanswered or answered OQ does not create a write-capable Task.
- CLI execution is **not a sandbox**. Scripts may mutate files or services; whitelist them only when trusted. The runtime audit is not proof of all subprocess actions.

## Keep policy files untracked

Loom's own `.gitignore` excludes its root `.loom.yaml`. For other repositories, add `.loom.yaml` to your Git global excludes file or the repository's local `.git/info/exclude`. This avoids accidental commits across PR worktrees. Loom rejects a worktree policy already present in the Git index; use `git rm --cached .loom.yaml` to untrack it before enabling it as a local policy. Keep each file owned by your account, not writable by group or others (e.g. `chmod 600 .loom.yaml`).

Use `loom_policy_status` after editing a policy to verify which source is active.
