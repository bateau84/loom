#!/usr/bin/env zsh
# ocw - OpenCode Worktree Launcher (Zsh / OpenCode 2.0.x)
#
# Source profiles stay native V2 under ~/.config/opencode/profiles/*.jsonc.
# For OpenCode 2.0.11, ocw lowers the selected profile into the compatibility
# runtime shape consumed by the current agent resolver:
#   agents -> agent
#   providers -> provider
#   provider/model#variant -> model + variant
#   compaction.prune -> removed (unsupported by 2.0.11)
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

_ocw_lower_jq='
  def selection:
    if type == "string" then
      (index("#")) as $i |
      if $i == null then {model: .}
      else {model: .[0:$i], variant: .[$i + 1:]}
      end
    elif type == "object" then
      {
        model: (((.providerID // .provider // "") | tostring) + "/" + ((.model // .modelID // .id // "") | tostring))
      } + (if .variant != null then {variant: (.variant | tostring)} else {} end)
    else {}
    end;

  def lower_agent:
    . as $a |
    ($a | del(.model, .system, .disabled, .request, .permissions))
    + (if $a.model != null then ($a.model | selection) else {} end)
    + (if $a.system != null then {prompt: $a.system} else {} end)
    + (if $a.disabled != null then {disable: $a.disabled} else {} end)
    + (if $a.request?.body != null then {options: $a.request.body} else {} end);

  def lower_agents:
    with_entries(.value |= lower_agent);

  . as $cfg |
  if $cfg.permissions? != null then error("ocw: cannot safely lower top-level V2 permissions")
  elif any((($cfg.agent // {}) | to_entries[]); .value.permissions? != null) then error("ocw: cannot safely lower agent V2 permissions")
  elif any((($cfg.agents // {}) | to_entries[]); .value.permissions? != null) then error("ocw: cannot safely lower agent V2 permissions")
  elif any((($cfg.agent // {}) | to_entries[]); .value.request?.headers? != null) then error("ocw: cannot safely lower agent request.headers")
  elif any((($cfg.agents // {}) | to_entries[]); .value.request?.headers? != null) then error("ocw: cannot safely lower agent request.headers")
  else . end |
  (($cfg.agent // {}) | lower_agents) as $legacy_agents |
  (($cfg.agents // {}) | lower_agents) as $native_agents |
  (($legacy_agents * $native_agents)) as $agents |
  (($cfg.provider // {}) * ($cfg.providers // {})) as $providers |
  (((($cfg.plugin // []) + ($cfg.plugins // [])) | unique)) as $plugins |

  del(.agents, .providers, .plugins)
  | .agent = $agents
  | if ($providers | length) > 0 then .provider = $providers else . end
  | if ($plugins | length) > 0 then .plugin = $plugins else . end
  | if .compaction? != null then .compaction |= del(.prune) else . end
'

_ocw_prepare_profile_root() {
  setopt local_options null_glob
  local cfg="$1" profile="$2" profile_file="$3"
  local root base tmp merged item name

  command -v jq >/dev/null 2>&1 || {
    echo "ocw: jq is required for profile compatibility generation" >&2
    return 2
  }

  root="${XDG_RUNTIME_DIR:-/tmp}/ocw-opencode-${UID:-$(id -u)}-${profile}"
  mkdir -p "$root" || return 1

  # Make normal OpenCode assets visible from the compatibility root.
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
  tmp="$root/.opencode.json.tmp.$$"
  merged="$root/.merged.json.tmp.$$"

  if [ -n "$base" ]; then
    jq -s '.[0] * .[1]' "$base" "$profile_file" > "$merged" || {
      rm -f "$tmp" "$merged"
      echo "ocw: failed to merge $base with $profile_file" >&2
      return 2
    }
  else
    jq '.' "$profile_file" > "$merged" || {
      rm -f "$tmp" "$merged"
      echo "ocw: failed to parse $profile_file" >&2
      return 2
    }
  fi

  jq "$_ocw_lower_jq" "$merged" > "$tmp" || {
    rm -f "$tmp" "$merged"
    echo "ocw: failed to lower profile '$profile' for OpenCode 2.0.x" >&2
    return 2
  }
  rm -f "$merged"
  mv -f "$tmp" "$root/opencode.json" || return 1
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
    (.agent // {})
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

  printf '\ncompatibility lowering (OpenCode 2.0.x)\n'
  printf '  agents -> agent\n'
  printf '  providers -> provider\n'
  printf '  model#variant -> model + variant\n'
  printf '  compaction.prune -> removed\n'

  [ -f "$runtime_file" ] || {
    echo "ocw: runtime config missing: $runtime_file" >&2
    return 3
  }

  source_rows="$(_ocw_source_rows "$profile_file")" || return 2

  printf '\nprofile compatibility verification\n'
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
      row_status="LOWER-MISMATCH"
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
    printf '\nocw: profile lowering FAILED\n' >&2
    return 3
  fi

  printf '\nOpenCode 2.0.11 debug visibility (informational only)\n'
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
      printf '  note: debug agents does not expose the lowered per-agent model map on this 2.0.11 path.\n'
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
      # OpenCode 2.0.11 debug config/agents do not expose the compatibility
      # runtime profile correctly. Project those diagnostics from the generated
      # runtime config so profiled debug commands remain useful and JSON-safe.
      if [ "${1:-}" = "debug" ] && [ "${2:-}" = "config" ]; then
        echo "ocw: active profile -> [$profile] (compat debug config)" >&2
        jq -n \
          --arg path "$runtime_root/opencode.json" \
          --arg dir "$runtime_root" \
          --slurpfile cfg "$runtime_root/opencode.json" \
          '[{type:"document", path:$path, info:$cfg[0]}, {type:"directory", path:$dir}]'
        exit $?
      fi

      if [ "${1:-}" = "debug" ] && [ "${2:-}" = "agents" ]; then
        echo "ocw: active profile -> [$profile] (compat-projected debug agents)" >&2
        agents_json="$(opencode debug agents 2>/dev/null)" || exit $?
        printf '%s\n' "$agents_json" | jq --slurpfile cfg "$runtime_root/opencode.json" '
          ($cfg[0].agent // {}) as $a
          | map(
              . as $x
              | ($x.id // $x.name) as $id
              | if $a[$id] == null then .
                else .
                  + (if $a[$id].model != null then {model:$a[$id].model} else {} end)
                  + (if $a[$id].variant != null then {variant:$a[$id].variant} else {} end)
                end
            )'
        exit $?
      fi

      case "${1:-}" in
        run)
          echo "ocw: active profile -> [$profile] (standalone)" >&2
          shift
          exec opencode run --standalone "$@"
          ;;
        ""|-*)
          echo "ocw: active profile -> [$profile] (standalone)" >&2
          exec opencode --standalone "$@"
          ;;
        *)
          echo "ocw: active profile -> [$profile]" >&2
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
