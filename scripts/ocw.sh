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
#   ocw <branch> [base] [--profile PROFILE] [--explain] [--no-worktree] [-- opencode-args...]
#   ocw-rm <branch>
#   ocw-ls
#
# EXAMPLES:
#   ocw fix-auth
#   ocw fix-auth main
#   ocw fix-auth --profile paid
#   ocw fix-auth --profile openai --explain
#   ocw fix-auth main -p hybrid -- -s x
#   ocw scratch --no-worktree --profile openai
#
# DESCRIPTION:
#   1. Creates/reuses a Git worktree in <repo>-wt/<branch>.
#   2. Persists the active profile selection per worktree in /tmp/ocw-<slug>.
#   3. Builds a per-profile runtime config root by merging the normal global
#      opencode.json(c) with profiles/<profile>.json(c).
#   4. Points V2 at that root through OPENCODE_CONFIG_DIR. This avoids V2 builds
#      where OPENCODE_CONFIG / OPENCODE_CONFIG_CONTENT are ignored.
#   5. Loads cli/<profile>.json through OPENCODE_CLI_CONFIG_CONTENT.
#   6. Profile TUI launches use --standalone so the private v2 server inherits
#      the selected config root. Local debug commands do not use --standalone.
#   7. --explain starts a temporary V2/core server and verifies the effective
#      /api/config and /api/agent state directly. It does not rely on legacy debug output.

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


_ocw_prepare_profile_root() {
  local cfg="$1" profile="$2" profile_file="$3"
  local root base tmp item name

  command -v jq >/dev/null 2>&1 || {
    echo "ocw: jq is required to merge OpenCode v2 profiles" >&2
    return 2
  }

  root="${XDG_RUNTIME_DIR:-/tmp}/ocw-opencode-${UID:-$(id -u)}-${profile}"
  mkdir -p "$root" || return 1

  # Preserve normal global discovery (agents, skills, plugins, package data, etc.)
  # while replacing only the config document with a merged profile document.
  for item in "$cfg"/* "$cfg"/.[!.]* "$cfg"/..?*; do
    [ -e "$item" ] || continue
    name="${item##*/}"
    case "$name" in
      opencode.json|opencode.jsonc|cli.json|cli.jsonc|profiles|cli) continue ;;
    esac
    [ -e "$root/$name" ] || ln -s "$item" "$root/$name" 2>/dev/null || true
  done

  base="$(_ocw_find_json "$cfg/opencode" 2>/dev/null || true)"
  tmp="$root/.opencode.json.tmp.$$"
  if [ -n "$base" ]; then
    jq -s '.[0] * .[1]' "$base" "$profile_file" > "$tmp" || {
      rm -f "$tmp"
      echo "ocw: failed to merge $base with $profile_file (profiles must be JSON-compatible JSONC)" >&2
      return 2
    }
  else
    jq '.' "$profile_file" > "$tmp" || {
      rm -f "$tmp"
      echo "ocw: failed to parse $profile_file (profiles must be JSON-compatible JSONC)" >&2
      return 2
    }
  fi
  mv -f "$tmp" "$root/opencode.json" || return 1
  printf '%s\n' "$root"
}

_ocw_pick_port() {
  command -v python3 >/dev/null 2>&1 || {
    echo "ocw: python3 is required for --explain runtime verification" >&2
    return 2
  }
  python3 - <<'PYPORT'
import socket
s = socket.socket()
s.bind(("127.0.0.1", 0))
print(s.getsockname()[1])
s.close()
PYPORT
}

_ocw_model_string_jq='def modelstr:
  if .model == null then "<inherit session>"
  elif (.model | type) == "string" then .model
  else
    ((.model.providerID // .model.provider // "?") | tostring)
    + "/"
    + ((.model.modelID // .model.id // .model.model // "?") | tostring)
    + (if ((.model.variant // "") | tostring) != "" then "#" + ((.model.variant // "") | tostring) else "" end)
  end;'

_ocw_print_agent_models() {
  local output="$1"

  if ! printf '%s\n' "$output" | jq -e 'type == "array"' >/dev/null 2>&1; then
    printf '%s\n' "$output"
    return 2
  fi

  printf '%s\n' "$output" | jq -r "
    $_ocw_model_string_jq
    .[] | [(.id // .name // \"?\"), modelstr] | @tsv
  " | awk -F '\t' '{ printf "  %-22s %s\n", $1, $2 }'
}

_ocw_verify_profile_models() {
  local profile_file="$1" agents_output="$2"
  local expected id model actual mismatches=0 count=0

  expected="$(jq -r '
    (.agent // .agents // {}) |
    to_entries[] |
    select(.value.model != null) |
    [.key,
     (if (.value.model|type) == "string"
      then .value.model
      else
        ((.value.model.providerID // .value.model.provider // "?")|tostring)
        + "/" +
        ((.value.model.modelID // .value.model.id // .value.model.model // "?")|tostring)
        + (if ((.value.model.variant // "")|tostring) != "" then "#" + ((.value.model.variant // "")|tostring) else "" end)
      end)
    ] | @tsv
  ' "$profile_file")" || return 2

  if ! printf '%s\n' "$agents_output" | jq -e 'type == "array"' >/dev/null 2>&1; then
    echo "ocw: standalone server /api/agent returned an unexpected response shape" >&2
    return 2
  fi

  printf '  %-20s %-32s %-32s %s\n' "agent" "expected" "effective" "status"
  while IFS=$'\t' read -r id model; do
    [ -n "$id" ] || continue
    count=$((count + 1))
    actual="$(printf '%s\n' "$agents_output" | jq -r --arg id "$id" "
      $_ocw_model_string_jq
      first(.[] | select((.id // .name) == \$id) | modelstr) // \"<missing agent>\"
    ")"
    if [ "$actual" = "$model" ]; then
      printf '  %-20s %-32s %-32s %s\n' "$id" "$model" "$actual" "OK"
    else
      printf '  %-20s %-32s %-32s %s\n' "$id" "$model" "$actual" "MISMATCH"
      mismatches=$((mismatches + 1))
    fi
  done <<EOF
$expected
EOF

  if [ "$count" -eq 0 ]; then
    echo "  (profile defines no explicit agent models)"
    return 2
  fi
  [ "$mismatches" -eq 0 ]
}

_ocw_explain() {
  local profile="$1"
  local profile_file="$2"
  local cli_file="$3"
  local rundir="$4"
  local runtime_root="${5:-}"
  local port pid logdir logfile config_output agents_output ready=0 verify_status=0 i verify_password verify_user="opencode"

  printf 'ocw profile\n'
  printf '  profile:        %s\n' "${profile:-<global/default>}"
  printf '  workdir:        %s\n' "$rundir"
  printf '  profile config: %s\n' "${profile_file:-<global/default>}"
  printf '  cli profile:    %s\n' "${cli_file:-<global/default>}"
  printf '  server mode:    %s\n' "$([ -n "$profile" ] && printf private/standalone || printf shared)"
  printf '  runtime root:   %s\n' "${runtime_root:-<global/default>}"

  if [ -z "$profile" ]; then
    printf '\nresolved agents (global/default debug view)\n'
    opencode debug agents
    return $?
  fi

  command -v jq >/dev/null 2>&1 || {
    echo "ocw: jq is required for --explain" >&2
    return 2
  }
  command -v curl >/dev/null 2>&1 || {
    echo "ocw: curl is required for --explain runtime verification" >&2
    return 2
  }

  port="$(_ocw_pick_port)" || return $?
  verify_password="$(python3 - <<'PYSECRET'
import secrets
print(secrets.token_urlsafe(24))
PYSECRET
)" || return 2
  logdir="${XDG_RUNTIME_DIR:-/tmp}/ocw-verify-${UID:-$(id -u)}"
  mkdir -p "$logdir" || return 1
  logfile="$logdir/${profile}-${port}.log"

  # Verify the actual V2/core service. `debug config` is intentionally not used
  # here because V2 has known split semantics between legacy/debug config loading
  # and the core service's OPENCODE_CONFIG_DIR handling.
  (
    cd "$rundir" || exit 1
    unset OPENCODE_CONFIG OPENCODE_CONFIG_CONTENT XDG_CONFIG_HOME
    export OPENCODE_CONFIG_DIR="$runtime_root"
    export OPENCODE_SERVER_USERNAME="$verify_user"
    export OPENCODE_SERVER_PASSWORD="$verify_password"
    unset OPENCODE_PASSWORD
    exec opencode serve --hostname 127.0.0.1 --port "$port"
  ) >"$logfile" 2>&1 &
  pid=$!

  _ocw_explain_cleanup() {
    local n=0
    kill "$pid" 2>/dev/null || true
    while kill -0 "$pid" 2>/dev/null && [ "$n" -lt 20 ]; do
      sleep 0.05
      n=$((n + 1))
    done
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null || true
    fi
    wait "$pid" 2>/dev/null || true
  }
  trap _ocw_explain_cleanup EXIT INT TERM HUP

  i=0
  while [ "$i" -lt 100 ]; do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "ocw: standalone verification server exited during startup" >&2
      sed -n '1,120p' "$logfile" >&2
      return 3
    fi
    if curl -fsS --max-time 1 --user "$verify_user:$verify_password" "http://127.0.0.1:$port/api/health" >/dev/null 2>&1; then
      ready=1
      break
    fi
    sleep 0.05
    i=$((i + 1))
  done

  if [ "$ready" -ne 1 ]; then
    echo "ocw: standalone verification server did not become ready" >&2
    sed -n '1,120p' "$logfile" >&2
    return 3
  fi

  config_output="$(curl -fsS --max-time 5 --user "$verify_user:$verify_password" -H "x-opencode-directory: $rundir" "http://127.0.0.1:$port/api/config")" || {
    echo "ocw: failed to query standalone server /api/config" >&2
    return 3
  }
  agents_output="$(curl -fsS --max-time 5 --user "$verify_user:$verify_password" -H "x-opencode-directory: $rundir" "http://127.0.0.1:$port/api/agent")" || {
    echo "ocw: failed to query standalone server /api/agent" >&2
    return 3
  }

  printf '\nprivate V2/core server config\n'
  if printf '%s\n' "$config_output" | jq -e 'type == "object"' >/dev/null 2>&1; then
    printf '  default agent:     %s\n' "$(printf '%s\n' "$config_output" | jq -r '.default_agent // "<unset>"')"
    printf '  configured agents: %s\n' "$(printf '%s\n' "$config_output" | jq -r '(.agent // .agents // {}) | length')"
    printf '  providers:         %s\n' "$(printf '%s\n' "$config_output" | jq -r '(.provider // .providers // {}) | keys | join(", ")')"
  else
    echo "ocw: standalone server /api/config returned an unexpected response shape" >&2
    printf '%s\n' "$config_output" >&2
    return 3
  fi

  printf '\nresolved agents (private V2/core server)\n'
  _ocw_print_agent_models "$agents_output" || return 3

  printf '\nprofile model verification\n'
  _ocw_verify_profile_models "$profile_file" "$agents_output" || verify_status=$?
  if [ "$verify_status" -ne 0 ]; then
    printf '\nocw: profile verification FAILED\n' >&2
    return 3
  fi

  printf '\nprofile load: OK\n'
  return 0
}

ocw() {
  local name=""
  if [ $# -gt 0 ]; then
    case $1 in
      -*) ;;
      *) name="$1"; shift ;;
    esac
  fi

  local profile=""
  local no_worktree=0
  local explain=0
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
      --explain)
        explain=1
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

  if [ -z "$name" ]; then
    if [ "$explain" -eq 1 ]; then
      name="__explain__"
      no_worktree=1
    else
      echo "usage: ocw <branch> [base] [-p profile] [--explain] [--no-worktree]" >&2
      echo "       ocw --profile PROFILE --explain" >&2
      return 1
    fi
  fi

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
  local runtime_root=""

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
    runtime_root="$(_ocw_prepare_profile_root "$cfg" "$profile" "$profile_file")" || return $?
  fi

  (
    cd "$rundir" || exit 1
    if [ -n "$profile" ]; then
      unset OPENCODE_CONFIG OPENCODE_CONFIG_CONTENT
      export OPENCODE_CONFIG_DIR="$runtime_root"
      export OPENCODE_CLI_CONFIG_CONTENT
      OPENCODE_CLI_CONFIG_CONTENT="$(cat "$cli_file")" || exit 1
    fi

    if [ "$explain" -eq 1 ]; then
      _ocw_explain "$profile" "$profile_file" "$cli_file" "$rundir" "$runtime_root"
      exit $?
    fi

    if [ -n "$profile" ]; then
      case "${1:-}" in
        debug|db|models|mcp)
          echo "ocw: active profile -> [$profile]"
          exec opencode "$@"
          ;;
        run)
          echo "ocw: active profile -> [$profile] (standalone)"
          shift
          exec opencode run --standalone "$@"
          ;;
        *)
          echo "ocw: active profile -> [$profile] (standalone)"
          exec opencode --standalone "$@"
          ;;
      esac
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
