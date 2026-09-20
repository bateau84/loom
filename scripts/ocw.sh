#!/usr/bin/env bash
# ocw - OpenCode Worktree Launcher (Bash / OpenCode v2)
#
# CONFIG LAYOUT:
#   ${XDG_CONFIG_HOME:-~/.config}/opencode/
#   ├── opencode.jsonc          # shared/global OpenCode config
#   ├── cli.json                # shared/global CLI defaults
#   ├── profiles/<profile>.jsonc
#   ├── cli/<profile>.json      # process-local CLI overlay selected by ocw
#   └── themes/*.json           # discovered natively by OpenCode
#
# USAGE:
#   ocw <branch> [base] [--profile PROFILE] [--no-worktree] [-- opencode-args...]
#   ocw-rm <branch>
#   ocw-ls
#
# EXAMPLES:
#   ocw fix-auth
#   ocw fix-auth main
#   ocw fix-auth --profile paid
#   ocw fix-auth main -p hybrid -- -s x
#   ocw scratch --no-worktree --profile openai
#
# DESCRIPTION:
#   1. Creates/reuses a Git worktree in <repo>-wt/<branch>.
#   2. Persists the active profile selection per worktree in /tmp/ocw-<slug>.
#   3. Loads profiles/<profile>.json(c) through OPENCODE_CONFIG.
#   4. Loads cli/<profile>.json through OPENCODE_CLI_CONFIG_CONTENT.
#   5. The CLI overlay merges over the normal global cli.json for this process only.
#   6. themes/*.json are discovered natively; the CLI overlay selects the theme.

_ocw_find_json() {
  local stem="$1"
  if [ -f "${stem}.jsonc" ]; then
    printf '%s\n' "${stem}.jsonc"
    return 0
  fi
  if [ -f "${stem}.json" ]; then
    printf '%s\n' "${stem}.json"
    return 0
  fi
  return 1
}

ocw() {
  local name="${1:?usage: ocw <branch> [base] [-p profile] [--no-worktree]}"
  shift

  local profile=""
  local no_worktree=0
  local passthrough=0
  local pre_count=0
  local n=$#

  # Rotate arguments while consuming only ocw options before `--`.
  while [ "$n" -gt 0 ]; do
    if [ "$passthrough" -eq 1 ]; then
      set -- "$@" "$1"
      shift
      n=$((n - 1))
      continue
    fi

    case $1 in
      --)
        passthrough=1
        shift
        n=$((n - 1))
        ;;
      -p|--profile)
        if [ "$n" -lt 2 ] || [ -z "${2:-}" ]; then
          echo "ocw: missing value for $1" >&2
          return 2
        fi
        profile="$2"
        shift 2
        n=$((n - 2))
        ;;
      --profile=*)
        profile="${1#*=}"
        shift
        n=$((n - 1))
        ;;
      --no-worktree)
        no_worktree=1
        shift
        n=$((n - 1))
        ;;
      *)
        set -- "$@" "$1"
        shift
        pre_count=$((pre_count + 1))
        n=$((n - 1))
        ;;
    esac
  done

  local rundir id root base
  if [ "$no_worktree" -eq 1 ]; then
    rundir="$PWD"
    id="${rundir}/${name}"
  else
    root="$(git rev-parse --show-toplevel 2>/dev/null)" || return 1
    rundir="${root}-wt/${name}"
    id="$rundir"

    base="HEAD"
    if [ "$pre_count" -gt 0 ] && [ "$#" -gt 0 ]; then
      case $1 in
        -*) ;;
        *) base="$1"; shift ;;
      esac
    fi

    if [ ! -d "$rundir" ]; then
      if git show-ref --verify --quiet "refs/heads/$name"; then
        git worktree add "$rundir" "$name" || return 1
      else
        git worktree add -b "$name" "$rundir" "$base" || return 1
      fi
    fi
  fi

  local state_file="/tmp/ocw-$(printf '%s' "$id" | tr '/' '_')"
  [ -n "$profile" ] && printf '%s\n' "$profile" > "$state_file"
  [ -f "$state_file" ] && profile="$(cat "$state_file")"

  local cfg="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
  local profile_file=""
  local cli_file=""

  if [ -n "$profile" ]; then
    profile_file="$(_ocw_find_json "$cfg/profiles/$profile")" || {
      echo "ocw: profile '$profile' not found in $cfg/profiles" >&2
      return 2
    }
    cli_file="$cfg/cli/$profile.json"
    if [ ! -f "$cli_file" ]; then
      echo "ocw: CLI profile '$profile' not found: $cli_file" >&2
      return 2
    fi
  fi

  (
    cd "$rundir" || exit 1
    if [ -n "$profile" ]; then
      export OPENCODE_CONFIG="$profile_file"
      export OPENCODE_CLI_CONFIG_CONTENT
      OPENCODE_CLI_CONFIG_CONTENT="$(cat "$cli_file")" || exit 1
      echo "ocw: active profile -> [$profile]"
    fi
    exec opencode "$@"
  )
}

ocw-rm() {
  local name="${1:?usage: ocw-rm <branch>}"
  local root
  root="$(git rev-parse --show-toplevel 2>/dev/null)" || return 1
  git worktree remove --force "${root}-wt/${name}" && git branch -D "$name"
}

ocw-ls() { git worktree list; }

# --- tab completion (Bash) ---
_ocw_complete() {
  local cur root wtdir
  [ "$COMP_CWORD" -eq 1 ] || return 0
  cur="${COMP_WORDS[COMP_CWORD]}"
  root="$(git rev-parse --show-toplevel 2>/dev/null)" || return 0
  wtdir="${root}-wt"
  [ -d "$wtdir" ] || return 0
  COMPREPLY=( $(compgen -W "$(command ls "$wtdir" 2>/dev/null)" -- "$cur") )
}
complete -F _ocw_complete ocw ocw-rm
