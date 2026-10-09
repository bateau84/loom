#!/usr/bin/env zsh
# ocw - OpenCode Worktree Launcher (Zsh / OpenCode 2.0.x)
#
# Source profiles stay native V2 under ~/.config/opencode/profiles/*.jsonc.
# ocw deep-merges the selected profile over the base config and exposes the
# merged native V2 config through OPENCODE_CONFIG_DIR.
#
# Usage:
#   ocw <branch> [base] [--profile PROFILE] [--explain] [--no-worktree] [-- opencode-args...]
#   ocw --profile PROFILE --explain
#   ocw-rm <branch>
#   ocw-ls

_ocw_find_json() {
  local stem="$1"
  [ -f "${stem}.jsonc" ] && { printf '%s\n' "${stem}.jsonc"; return 0; }
  [ -f "${stem}.json"  ] && { printf '%s\n' "${stem}.json";  return 0; }
  return 1
}

_ocw_prepare_profile_root() {
  setopt local_options null_glob
  local cfg="$1" profile="$2" profile_file="$3" rundir="$4" git_common_dir="$5"
  local root base merged item name

  command -v jq >/dev/null 2>&1 || {
    echo "ocw: jq is required for profile generation" >&2
    return 2
  }

  # Isolate generated permissions by worktree and profile.
  local key runtime_base
  key="$(printf '%s\0%s' "$rundir" "$profile" | git hash-object --stdin)" || return 1
  runtime_base="$XDG_RUNTIME_DIR"
  [ -n "$runtime_base" ] || runtime_base=/tmp
  root="$runtime_base/ocw-opencode-$(id -u)-$key"
  [ ! -L "$root" ] || { echo "ocw: unsafe runtime config symlink: $root" >&2; return 1; }
  (umask 077; mkdir -p "$root") || return 1
  chmod 700 "$root" || return 1

  # Make normal OpenCode assets visible from the profile runtime root.
  for item in "$cfg"/* "$cfg"/.[!.]* "$cfg"/..?*; do
    [ -e "$item" ] || continue
    name="${item##*/}"
    case "$name" in
      opencode.json|opencode.jsonc|cli.json|cli.jsonc|profiles|cli) continue ;;
    esac
    if [ -L "$root/$name" ] && [ "$(readlink "$root/$name" 2>/dev/null)" != "$item" ]; then
      rm -f "$root/$name"
    fi
    [ -e "$root/$name" ] || ln -s "$item" "$root/$name" 2>/dev/null || true
  done

  base="$(_ocw_find_json "$cfg/opencode" 2>/dev/null || true)"
  merged="$root/.opencode.json.tmp.$$"

  if [ -n "$profile_file" ]; then
    if [ -n "$base" ]; then
      jq -s '.[0] * .[1]' "$base" "$profile_file" > "$merged" || {
        rm -f "$merged"
        echo "ocw: failed to merge $base with $profile_file" >&2
        return 2
      }
    else
      jq '.' "$profile_file" > "$merged" || {
        rm -f "$merged"
        echo "ocw: failed to parse $profile_file" >&2
        return 2
      }
    fi
  else
    # Resolve global/project JSONC and permissions before adding Git access.
    (cd "$rundir" && opencode debug config) > "$merged" || {
      rm -f "$merged"
      echo "ocw: failed to resolve OpenCode config" >&2
      return 2
    }
  fi

  if [ -n "$git_common_dir" ]; then
    local scoped="$root/.opencode.scoped.$$"
    jq --arg path "$git_common_dir/*" '
      .permissions = (
        (.permissions // []) +
        (["external_directory", "read", "edit"] |
         map({action: ., resource: $path, effect: "allow"}))
      )
    ' "$merged" > "$scoped" || {
      rm -f "$merged" "$scoped"
      echo "ocw: failed to authorize Git metadata: $git_common_dir" >&2
      return 2
    }
    mv -f "$scoped" "$merged" || return 1
  fi

  mv -f "$merged" "$root/opencode.json" || return 1
  printf '%s\n' "$root"
}

_ocw_model_fields_jq='
  def fields:
    if .model == null then ["<inherit session>", ""]
    elif (.model | type) == "string" then
      if (.model | contains("#")) then [(.model | split("#")[0]), (.model | split("#")[1])]
      else [.model, ((.variant // "") | tostring)] end
    else
      [
        (((.model.providerID // .model.provider // "?") | tostring) + "/" + ((.model.modelID // .model.id // .model.model // "?") | tostring)),
        ((.variant // .model.variant // "") | tostring)
      ]
    end;
'

_ocw_source_rows() {
  local profile_file="$1"
  jq -r "
    $_ocw_model_fields_jq
    (.agents // .agent // {})
    | to_entries[]
    | select(.value.model != null)
    | (.value | fields) as \$m
    | [.key, \$m[0], \$m[1]] | @tsv
  " "$profile_file"
}

_ocw_runtime_rows() {
  local runtime_file="$1"
  jq -r "
    $_ocw_model_fields_jq
    (.agents // .agent // {})
    | to_entries[]
    | select(.value.model != null)
    | (.value | fields) as \$m
    | [.key, \$m[0], \$m[1]] | @tsv
  " "$runtime_file"
}

_ocw_resolved_agent() {
  local agents_json="$1" id="$2"
  printf '%s\n' "$agents_json" | jq -r --arg id "$id" "
    $_ocw_model_fields_jq
    first(.[] | select((.id // .name) == \$id)) as \$a
    | if \$a == null then [\"<missing agent>\", \"\"]
      else (\$a | fields)
      end
    | @tsv
  "
}

_ocw_explain() {
  local profile="$1" profile_file="$2" cli_file="$3" rundir="$4" runtime_root="$5"
  local runtime_file="$runtime_root/opencode.json"
  local agents_json="" source_rows="" line id expected_model expected_variant
  local runtime_model runtime_variant resolved_model resolved_variant resolved row_status
  local mismatch=0 count=0 exposed=0

  printf 'ocw profile\n'
  printf '  profile:        %s\n' "${profile:-<global/default>}"
  printf '  workdir:        %s\n' "$rundir"
  printf '  profile config: %s\n' "${profile_file:-<global/default>}"
  printf '  cli profile:    %s\n' "${cli_file:-<global/default>}"
  printf '  runtime root:   %s\n' "${runtime_root:-<global/default>}"

  if [ -z "$profile" ]; then
    printf '\nresolved agents (global/default)\n'
    opencode debug agents
    return $?
  fi

  [ -f "$runtime_file" ] || {
    echo "ocw: runtime config missing: $runtime_file" >&2
    return 3
  }

  source_rows="$(_ocw_source_rows "$profile_file")" || return 2

  printf '\nprofile merge verification\n'
  printf '  %-18s %-29s %-10s %-29s %-10s %s\n' \
    agent 'source model' variant 'runtime model' variant status

  while IFS=$'\t' read -r id expected_model expected_variant; do
    [ -n "$id" ] || continue
    count=$((count + 1))

    line="$(_ocw_runtime_rows "$runtime_file" | awk -F '\t' -v id="$id" '$1 == id {print; exit}')"
    if [ -n "$line" ]; then
      IFS=$'\t' read -r _ runtime_model runtime_variant <<< "$line"
    else
      runtime_model="<missing agent>"
      runtime_variant=""
    fi

    row_status="OK"
    if [ "$runtime_model" != "$expected_model" ] || [ "$runtime_variant" != "$expected_variant" ]; then
      row_status="MERGE-MISMATCH"
      mismatch=1
    fi

    printf '  %-18s %-29s %-10s %-29s %-10s %s\n' \
      "$id" "$expected_model" "${expected_variant:-<default>}" \
      "$runtime_model" "${runtime_variant:-<default>}" "$row_status"
  done <<< "$source_rows"

  if [ "$count" -eq 0 ]; then
    echo "  (profile defines no explicit agent models)"
    return 2
  fi

  if [ "$mismatch" -ne 0 ]; then
    printf '\nocw: profile merge verification FAILED\n' >&2
    return 3
  fi

  printf '\nOpenCode debug visibility (informational only)\n'
  if agents_json="$(opencode debug agents 2>/dev/null)" && \
     printf '%s\n' "$agents_json" | jq -e 'type == "array"' >/dev/null 2>&1; then
    printf '  %-18s %-29s %-10s\n' agent 'debug model' variant
    while IFS=$'\t' read -r id expected_model expected_variant; do
      [ -n "$id" ] || continue
      resolved="$(_ocw_resolved_agent "$agents_json" "$id")"
      IFS=$'\t' read -r resolved_model resolved_variant <<< "$resolved"
      [ "$resolved_model" != "<inherit session>" ] && [ "$resolved_model" != "<missing agent>" ] && exposed=$((exposed + 1))
      printf '  %-18s %-29s %-10s\n' \
        "$id" "$resolved_model" "${resolved_variant:-<not exposed>}"
    done <<< "$source_rows"
    printf '  explicit models exposed: %s/%s\n' "$exposed" "$count"
    if [ "$exposed" -eq 0 ]; then
      printf '  note: debug agents does not expose the configured per-agent model map.\n'
    fi
  else
    printf '  unavailable (opencode debug agents failed or returned an unexpected shape)\n'
  fi

  printf '\nprofile preparation: OK\n'
  printf '  runtime config is internally consistent with the selected source profile.\n'
  printf '  actual subagent model selection must be observed from a real dispatched child run.\n'
}
ocw() {
  local name=""
  if [ $# -gt 0 ]; then
    case $1 in
      -*) ;;
      *) name="$1"; shift ;;
    esac
  fi

  local profile="" no_worktree=0 explain=0 passthrough=0 pre_count=0 n=$#

  while [ "$n" -gt 0 ]; do
    if [ "$passthrough" -eq 1 ]; then
      set -- "$@" "$1"; shift; n=$((n - 1)); continue
    fi
    case $1 in
      --) passthrough=1; shift; n=$((n - 1)) ;;
      -p|--profile)
        [ "$n" -ge 2 ] && [ -n "${2:-}" ] || { echo "ocw: missing value for $1" >&2; return 2; }
        profile="$2"; shift 2; n=$((n - 2)) ;;
      --profile=*) profile="${1#*=}"; shift; n=$((n - 1)) ;;
      --explain) explain=1; shift; n=$((n - 1)) ;;
      --no-worktree) no_worktree=1; shift; n=$((n - 1)) ;;
      *) set -- "$@" "$1"; shift; pre_count=$((pre_count + 1)); n=$((n - 1)) ;;
    esac
  done

  if [ -z "$name" ]; then
    if [ "$explain" -eq 1 ]; then
      name="__explain__"; no_worktree=1
    else
      echo "usage: ocw <branch> [base] [-p profile] [--explain] [--no-worktree]" >&2
      echo "       ocw --profile PROFILE --explain" >&2
      return 1
    fi
  fi

  local rundir id root base
  if [ "$no_worktree" -eq 1 ]; then
    rundir="$PWD"; id="${rundir}/${name}"
  else
    root="$(git rev-parse --show-toplevel 2>/dev/null)" || return 1
    rundir="${root}-wt/${name}"; id="$rundir"; base="HEAD"
    if [ "$pre_count" -gt 0 ] && [ "$#" -gt 0 ]; then
      case $1 in -*) ;; *) base="$1"; shift ;; esac
    fi
    if [ ! -d "$rundir" ]; then
      if git show-ref --verify --quiet "refs/heads/$name"; then
        git worktree add "$rundir" "$name" || return 1
      else
        git worktree add -b "$name" "$rundir" "$base" || return 1
      fi
    fi
  fi

  rundir="$(cd "$rundir" && pwd -P)" || return 1
  local worktree_root git_common_dir
  worktree_root="$(git -C "$rundir" rev-parse --show-toplevel 2>/dev/null)" || return 1
  worktree_root="$(cd "$worktree_root" && pwd -P)" || return 1
  git_common_dir="$(git -C "$rundir" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || return 1
  git_common_dir="$(cd "$git_common_dir" && pwd -P)" || return 1
  case "$git_common_dir" in
    "$worktree_root"/*) git_common_dir="" ;;
  esac

  local state_file="/tmp/ocw-$(printf '%s' "$id" | tr '/' '_')"
  [ -n "$profile" ] && printf '%s\n' "$profile" > "$state_file"
  [ -f "$state_file" ] && profile="$(cat "$state_file")"

  local cfg="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
  local profile_file="" cli_file="" runtime_root=""

  if [ -n "$profile" ]; then
    profile_file="$(_ocw_find_json "$cfg/profiles/$profile")" || {
      echo "ocw: profile '$profile' not found in $cfg/profiles" >&2; return 2;
    }
    cli_file="$cfg/cli/$profile.json"
    [ -f "$cli_file" ] || { echo "ocw: CLI profile '$profile' not found: $cli_file" >&2; return 2; }
  fi
  if [ -n "$profile" ] || [ -n "$git_common_dir" ]; then
    runtime_root="$(_ocw_prepare_profile_root "$cfg" "$profile" "$profile_file" "$rundir" "$git_common_dir")" || return $?
  fi

  (
    cd "$rundir" || exit 1
    if [ -n "$runtime_root" ]; then
      unset OPENCODE_CONFIG OPENCODE_CONFIG_CONTENT
      export OPENCODE_CONFIG_DIR="$runtime_root"
    fi
    if [ -n "$profile" ]; then
      export OPENCODE_CLI_CONFIG_CONTENT
      OPENCODE_CLI_CONFIG_CONTENT="$(cat "$cli_file")" || exit 1
    fi

    if [ "$explain" -eq 1 ]; then
      _ocw_explain "$profile" "$profile_file" "$cli_file" "$rundir" "$runtime_root"
      exit $?
    fi

    if [ -n "$runtime_root" ]; then
      case "${1:-}" in
        run)
          [ -z "$profile" ] || echo "ocw: active profile -> [$profile] (standalone)" >&2
          shift
          exec opencode run --standalone "$@"
          ;;
        ""|-*)
          [ -z "$profile" ] || echo "ocw: active profile -> [$profile] (standalone)" >&2
          exec opencode --standalone "$@"
          ;;
        *)
          [ -z "$profile" ] || echo "ocw: active profile -> [$profile]" >&2
          exec opencode "$@"
          ;;
      esac
    fi
    exec opencode "$@"
  )
}

ocw-rm() {
  local name="${1:?usage: ocw-rm <branch>}" root
  root="$(git rev-parse --show-toplevel 2>/dev/null)" || return 1
  git worktree remove --force "${root}-wt/${name}" && git branch -D "$name"
}

ocw-ls() { git worktree list; }

# --- tab completion (Zsh) ---
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
