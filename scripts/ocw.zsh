#!/usr/bin/env zsh
# ocw - OpenCode Worktree Launcher (Zsh / OpenCode v2)
#
# CONFIG LAYOUT:
#   ${XDG_CONFIG_HOME:-~/.config}/opencode/
#   ├── opencode.jsonc
#   ├── cli.json
#   ├── profiles/<profile>.jsonc
#   ├── cli/<profile>.json
#   └── themes/*.json
#
# USAGE:
#   ocw <branch> [base] [--profile PROFILE] [--no-worktree] [-- opencode-args...]
#   ocw-rm <branch>
#   ocw-ls

_ocw_find_json() {
  local stem="$1"
  [[ -f "${stem}.jsonc" ]] && { print -r -- "${stem}.jsonc"; return 0; }
  [[ -f "${stem}.json"  ]] && { print -r -- "${stem}.json";  return 0; }
  return 1
}

ocw() {
  local name="${1:?usage: ocw <branch> [base] [-p profile] [--no-worktree]}"
  shift

  local -a pre_args=() post_args=() args=()
  local profile="" no_worktree=0 base="HEAD"
  local before_separator=1

  while (($#)); do
    if (( ! before_separator )); then
      post_args+=("$1")
      shift
      continue
    fi

    case $1 in
      --)
        before_separator=0
        shift
        ;;
      -p|--profile)
        [[ $# -ge 2 && -n ${2:-} ]] || { print -u2 -- "ocw: missing value for $1"; return 2; }
        profile="$2"
        shift 2
        ;;
      --profile=*)
        profile="${1#*=}"
        shift
        ;;
      --no-worktree)
        no_worktree=1
        shift
        ;;
      *)
        pre_args+=("$1")
        shift
        ;;
    esac
  done

  local rundir id
  if (( no_worktree )); then
    rundir="$PWD"
    id="${rundir}/${name}"
    args=("${pre_args[@]}" "${post_args[@]}")
  else
    local root
    root="$(git rev-parse --show-toplevel 2>/dev/null)" || return 1
    rundir="${root}-wt/${name}"
    id="$rundir"

    if (( ${#pre_args} > 0 )) && [[ $pre_args[1] != -* ]]; then
      base="$pre_args[1]"
      pre_args=(${pre_args[2,-1]})
    fi
    args=("${pre_args[@]}" "${post_args[@]}")

    if [[ ! -d "$rundir" ]]; then
      if git show-ref --verify --quiet "refs/heads/$name"; then
        git worktree add "$rundir" "$name" || return 1
      else
        git worktree add -b "$name" "$rundir" "$base" || return 1
      fi
    fi
  fi

  local state_file="/tmp/ocw-${id//\//_}"
  [[ -n $profile ]] && print -r -- "$profile" > "$state_file"
  [[ -f $state_file ]] && profile="$(<"$state_file")"

  local cfg="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
  local profile_file="" cli_file=""
  if [[ -n $profile ]]; then
    profile_file="$(_ocw_find_json "$cfg/profiles/$profile")" || {
      print -u2 -- "ocw: profile '$profile' not found in $cfg/profiles"
      return 2
    }
    cli_file="$cfg/cli/$profile.json"
    [[ -f $cli_file ]] || {
      print -u2 -- "ocw: CLI profile '$profile' not found: $cli_file"
      return 2
    }
  fi

  (
    cd "$rundir" || exit 1
    if [[ -n $profile ]]; then
      export OPENCODE_CONFIG="$profile_file"
      export OPENCODE_CLI_CONFIG_CONTENT="$(<"$cli_file")"
      print -r -- "ocw: active profile -> [$profile]"
    fi
    exec opencode "${args[@]}"
  )
}

ocw-rm() {
  local name="${1:?usage: ocw-rm <branch>}"
  local root
  root="$(git rev-parse --show-toplevel 2>/dev/null)" || return 1
  git worktree remove --force "${root}-wt/${name}" && git branch -D "$name"
}

ocw-ls() { git worktree list; }

# --- tab completion ---
_ocw() {
  (( CURRENT == 2 )) || return 0
  local root wtdir
  root="$(git rev-parse --show-toplevel 2>/dev/null)" || return 0
  wtdir="${root}-wt"
  [[ -d $wtdir ]] || return 0
  local -a names
  names=("${wtdir}"/*(N/:t))
  (( ${#names} )) && compadd -a names
}
compdef _ocw ocw
compdef _ocw ocw-rm
