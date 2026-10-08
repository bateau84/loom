# Local Loom permission overrides

Loom supports an optional **user-owned policy file** in the OpenCode configuration directory. The checkout ignores `/.loom.yaml` even when Loom itself is that directory:

- Standard location: `~/.config/opencode/.loom.yaml`
- When `XDG_CONFIG_HOME` is absolute: `$XDG_CONFIG_HOME/opencode/.loom.yaml`
- Create it yourself; Loom does not commit, create, or modify this file. It stays untracked in Git.
- The YAML is re-read for permission checks. **No Git commit, build, or OpenCode restart** is needed after editing it.
- Run `loom_policy_status` to see the loaded file, parse errors, and the rules effective for the current project.

Example (replace the project path with the result of `pwd -P`):

```yaml
version: 1

# Available inside an attached, current runnable Loom step.
shell:
  exact:
    - "node --version"
    - "bun --version"
    - "kubectl version --client"
  prefixes:
    - "kubectl get"

projects:
  /home/me/source/my-project:
    shell:
      exact:
        - "go env GOMOD"
    writes:
      worker:
        - "src/**"
        - "cmd/**"
      documenter:
        - "docs/index.md"
        - "docs/log.md"
```

For example, when `kubectl get` is in `prefixes`, the command `kubectl get pods -n dev` is admitted, but `kubectl getpods` is not. `exact` matches the whole command. These rules do **not** use shell globs or regexes.

## How it works

- Missing file: existing built-in Loom permission behavior is unchanged.
- Invalid YAML, unknown keys, malformed entries, or an unsafe file: the local overrides are ignored. Check `loom_policy_status` for the exact error.
- Rules are explicit **user trust grants** for commands, not a sandbox. CLI tools and scripts can have side effects even without shell redirection. Only list commands/prefixes you actually trust. Broad prefixes such as `node`, `sh`, `bash`, `npm`, `rm`, or `git` are not appropriate.
- Shell chaining, redirection, environment injection, direct Git/Butler mutation, and common Git-bypassing command wrappers cannot be enabled using these shell exceptions. Use Loom's existing scoped delivery mechanism for Git. **This is not process containment:** an explicitly trusted script may itself execute further commands or modify files.
- The local policy is user-owned: agents cannot edit the policy file itself, even if the OpenCode config directory is inside the project or reached through a symlink.
- Project write rules add paths to the listed producing role's current effective write scope **only when it has a current runnable workflow step**. Rules never create or complete a step, change the Plan, or grant permission to answer a question by modifying files.
- Only bounded **project-relative** file/folder paths are accepted. Repository-wide paths, paths outside the project, Git/Loom internals, and the report/promotion areas cannot be allowed through this file. Symlinks escaping the project remain blocked by Loom's runtime path checks.
- Independent gate roles (Reviewer/Critic/Acceptance) cannot receive product write authority through this file. Existing independent-gate and evidence requirements remain in force.

## Setup

Create the parent directory and file using your editor; restrict it to your account:

```sh
mkdir -p "${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
chmod 700 "${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
touch "${XDG_CONFIG_HOME:-$HOME/.config}/opencode/.loom.yaml"
chmod 600 "${XDG_CONFIG_HOME:-$HOME/.config}/opencode/.loom.yaml"
```

Keep the local policy file out of commits. Loom's root `.gitignore` ignores `/.loom.yaml` when the configuration directory is a checkout of Loom.

**Important:** A Documenter attached only to an advisory OQ still cannot author or commit files. The message “requires the exact attached current runnable Loom step attempt” means there is no executable step for that mutation. Adding a `writes` path alone does not grant lifecycle authority. That is a separate routing/execution concern; do not send the same write to an unrelated Designer step simply because it is runnable.
