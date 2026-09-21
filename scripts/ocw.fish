# ocw - OpenCode Worktree Launcher (Fish / OpenCode 2.0.x)
#
# Source profiles stay native V2 under ~/.config/opencode/profiles/*.jsonc.
# ocw lowers them into the OpenCode 2.0.11 compatibility runtime shape:
#   agents -> agent
#   providers -> provider
#   provider/model#variant -> model + variant
#   compaction.prune -> removed
#
# Usage:
#   ocw <branch> [base] [--profile PROFILE] [--explain] [--no-worktree] [-- opencode-args...]
#   ocw --profile PROFILE --explain
#   ocw-rm <branch>
#   ocw-ls

function __ocw_find_json
    set -l stem $argv[1]
    if test -f "$stem.jsonc"
        echo "$stem.jsonc"
        return 0
    end
    if test -f "$stem.json"
        echo "$stem.json"
        return 0
    end
    return 1
end

function __ocw_prepare_profile_root
    set -l cfg $argv[1]
    set -l profile $argv[2]
    set -l profile_file $argv[3]

    type -q jq; or begin
        echo 'ocw: jq is required for profile compatibility generation' >&2
        return 2
    end

    set -l runtime_base /tmp
    if set -q XDG_RUNTIME_DIR; and test -n "$XDG_RUNTIME_DIR"
        set runtime_base $XDG_RUNTIME_DIR
    end
    set -l uid (id -u)
    set -l root "$runtime_base/ocw-opencode-$uid-$profile"
    mkdir -p "$root"; or return 1

    for item in $cfg/*
        test -e "$item"; or continue
        set -l name (basename "$item")
        switch $name
            case opencode.json opencode.jsonc cli.json cli.jsonc profiles cli
                continue
        end
        if test -L "$root/$name"
            set -l old_target (readlink "$root/$name" 2>/dev/null)
            if test "$old_target" != "$item"
                rm -f "$root/$name"
            end
        end
        test -e "$root/$name"; or ln -s "$item" "$root/$name" 2>/dev/null; or true
    end

    set -l base (__ocw_find_json "$cfg/opencode" 2>/dev/null)
    set -l merged "$root/.merged.json.tmp.$fish_pid"
    set -l tmp "$root/.opencode.json.tmp.$fish_pid"

    if test -n "$base"
        jq -s '.[0] * .[1]' "$base" "$profile_file" > "$merged"; or begin
            rm -f "$merged" "$tmp"
            echo "ocw: failed to merge $base with $profile_file" >&2
            return 2
        end
    else
        jq '.' "$profile_file" > "$merged"; or begin
            rm -f "$merged" "$tmp"
            echo "ocw: failed to parse $profile_file" >&2
            return 2
        end
    end

    jq '
      def selection:
        if type == "string" then
          (index("#")) as $i |
          if $i == null then {model: .}
          else {model: .[0:$i], variant: .[$i + 1:]}
          end
        elif type == "object" then
          {model: (((.providerID // .provider // "") | tostring) + "/" + ((.model // .modelID // .id // "") | tostring))}
          + (if .variant != null then {variant: (.variant | tostring)} else {} end)
        else {}
        end;

      def lower_agent:
        . as $a |
        ($a | del(.model, .system, .disabled, .request, .permissions))
        + (if $a.model != null then ($a.model | selection) else {} end)
        + (if $a.system != null then {prompt: $a.system} else {} end)
        + (if $a.disabled != null then {disable: $a.disabled} else {} end)
        + (if $a.request?.body != null then {options: $a.request.body} else {} end);

      def lower_agents: with_entries(.value |= lower_agent);

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
    ' "$merged" > "$tmp"; or begin
        rm -f "$merged" "$tmp"
        echo "ocw: failed to lower profile '$profile' for OpenCode 2.0.x" >&2
        return 2
    end

    rm -f "$merged"
    mv -f "$tmp" "$root/opencode.json"; or return 1
    echo "$root"
end

function __ocw_explain
    set -l profile $argv[1]
    set -l profile_file $argv[2]
    set -l cli_file $argv[3]
    set -l rundir $argv[4]
    set -l runtime_root $argv[5]

    printf 'ocw profile\n'
    printf '  profile:        %s\n' (test -n "$profile"; and echo "$profile"; or echo '<global/default>')
    printf '  workdir:        %s\n' "$rundir"
    printf '  profile config: %s\n' (test -n "$profile_file"; and echo "$profile_file"; or echo '<global/default>')
    printf '  cli profile:    %s\n' (test -n "$cli_file"; and echo "$cli_file"; or echo '<global/default>')
    printf '  runtime root:   %s\n' (test -n "$runtime_root"; and echo "$runtime_root"; or echo '<global/default>')

    if test -z "$profile"
        echo
        echo 'resolved agents (global/default)'
        opencode debug agents
        return $status
    end

    set -l runtime_file "$runtime_root/opencode.json"
    if not test -f "$runtime_file"
        echo "ocw: runtime config missing: $runtime_file" >&2
        return 3
    end

    echo
    echo 'compatibility lowering (OpenCode 2.0.x)'
    echo '  agents -> agent'
    echo '  providers -> provider'
    echo '  model#variant -> model + variant'
    echo '  compaction.prune -> removed'

    echo
    echo 'profile compatibility verification'
    printf '  %-18s %-29s %-10s %-29s %-10s %s\n' \
        agent 'source model' variant 'runtime model' variant status

    set -l rows (jq -r -n \
      --slurpfile source "$profile_file" \
      --slurpfile runtime "$runtime_file" '
      def fields($a):
        if $a == null or $a.model == null then ["<inherit session>", ""]
        elif ($a.model | type) == "string" then
          if ($a.model | contains("#")) then [($a.model | split("#")[0]), ($a.model | split("#")[1])]
          else [$a.model, (($a.variant // "") | tostring)] end
        else
          [
            (((($a.model.providerID // $a.model.provider // "?") | tostring) + "/" + (($a.model.modelID // $a.model.id // $a.model.model // "?") | tostring))),
            (($a.variant // $a.model.variant // "") | tostring)
          ]
        end;
      ($source[0].agents // $source[0].agent // {})
      | to_entries[]
      | select(.value.model != null)
      | .key as $id
      | fields(.value) as $src
      | (($runtime[0].agent // {})[$id] // null) as $runAgent
      | fields($runAgent) as $run
      | (if $runAgent == null or $run[0] != $src[0] or $run[1] != $src[1] then "LOWER-MISMATCH" else "OK" end) as $st
      | [$id, $src[0], ($src[1] // ""), $run[0], ($run[1] // ""), $st]
      | @tsv
    '); or return 2

    set -l count 0
    set -l mismatch 0
    for row in $rows
        set count (math $count + 1)
        set -l f (string split \t -- "$row")
        set -l sv '<default>'
        set -l rv '<default>'
        test -n "$f[3]"; and set sv "$f[3]"
        test -n "$f[5]"; and set rv "$f[5]"
        test "$f[6]" = OK; or set mismatch 1
        printf '  %-18s %-29s %-10s %-29s %-10s %s\n' "$f[1]" "$f[2]" "$sv" "$f[4]" "$rv" "$f[6]"
    end

    if test $count -eq 0
        echo '  (profile defines no explicit agent models)'
        return 2
    end
    if test $mismatch -ne 0
        echo
        echo 'ocw: profile lowering FAILED' >&2
        return 3
    end

    echo
    echo 'OpenCode 2.0.11 debug visibility (informational only)'
    set -l runtime_base /tmp
    if set -q XDG_RUNTIME_DIR; and test -n "$XDG_RUNTIME_DIR"
        set runtime_base $XDG_RUNTIME_DIR
    end
    set -l agents_file "$runtime_base/ocw-explain-agents-"(id -u)"-$profile.json"
    if opencode debug agents > "$agents_file" 2>/dev/null; and jq -e 'type == "array"' "$agents_file" >/dev/null 2>&1
        printf '  %-18s %-29s %-10s\n' agent 'debug model' variant
        set -l exposed 0
        for row in $rows
            set -l f (string split \t -- "$row")
            set -l id "$f[1]"
            set -l resolved (jq -r --arg id "$id" '
              def fields($a):
                if $a == null or $a.model == null then ["<inherit session>", ""]
                elif ($a.model | type) == "string" then
                  if ($a.model | contains("#")) then [($a.model | split("#")[0]), ($a.model | split("#")[1])]
                  else [$a.model, (($a.variant // "") | tostring)] end
                else
                  [
                    (((($a.model.providerID // $a.model.provider // "?") | tostring) + "/" + (($a.model.modelID // $a.model.id // $a.model.model // "?") | tostring))),
                    (($a.variant // $a.model.variant // "") | tostring)
                  ]
                end;
              (first(.[] | select((.id // .name) == $id)) // null) | fields(.) | @tsv
            ' "$agents_file")
            set -l rf (string split \t -- "$resolved")
            set -l dv '<not exposed>'
            test (count $rf) -ge 2; and test -n "$rf[2]"; and set dv "$rf[2]"
            if test "$rf[1]" != '<inherit session>'; and test "$rf[1]" != '<missing agent>'
                set exposed (math $exposed + 1)
            end
            printf '  %-18s %-29s %-10s\n' "$id" "$rf[1]" "$dv"
        end
        printf '  explicit models exposed: %s/%s\n' "$exposed" "$count"
        if test $exposed -eq 0
            echo '  note: debug agents does not expose the lowered per-agent model map on this 2.0.11 path.'
        end
    else
        echo '  unavailable (opencode debug agents failed or returned an unexpected shape)'
    end
    rm -f "$agents_file"

    echo
    echo 'profile preparation: OK'
    echo '  runtime config is internally consistent with the selected source profile.'
    echo '  actual subagent model selection must be observed from a real dispatched child run.'
end
function ocw
    set -l name
    if test (count $argv) -gt 0; and not string match -q -- '-*' $argv[1]
        set name $argv[1]
        set -e argv[1]
    end

    set -l args
    set -l pre_args
    set -l post_args
    set -l profile
    set -l no_worktree 0
    set -l explain 0
    set -l passthrough 0

    while test (count $argv) -gt 0
        if test $passthrough -eq 1
            set -a post_args $argv[1]
            set -e argv[1]
            continue
        end

        switch $argv[1]
            case --
                set passthrough 1
                set -e argv[1]
            case -p --profile
                if not set -q argv[2]; or test -z "$argv[2]"
                    echo "ocw: missing value for $argv[1]" >&2
                    return 2
                end
                set profile $argv[2]
                set -e argv[1..2]
            case '--profile=*'
                set profile (string replace -r '^--profile=' '' $argv[1])
                set -e argv[1]
            case --explain
                set explain 1
                set -e argv[1]
            case --no-worktree
                set no_worktree 1
                set -e argv[1]
            case '*'
                set -a pre_args $argv[1]
                set -e argv[1]
        end
    end

    if test -z "$name"
        if test $explain -eq 1
            set name __explain__
            set no_worktree 1
        else
            echo 'usage: ocw <branch> [base] [-p profile] [--explain] [--no-worktree]' >&2
            echo '       ocw --profile PROFILE --explain' >&2
            return 1
        end
    end

    set -l rundir
    set -l id
    if test $no_worktree -eq 1
        set rundir $PWD
        set id "$rundir/$name"
        set args $pre_args $post_args
    else
        set -l root (git rev-parse --show-toplevel 2>/dev/null); or return 1
        set rundir "$root-wt/$name"
        set id $rundir
        set -l base HEAD
        if test (count $pre_args) -gt 0; and not string match -q -- '-*' $pre_args[1]
            set base $pre_args[1]
            set -e pre_args[1]
        end
        set args $pre_args $post_args
        if not test -d "$rundir"
            if git show-ref --verify --quiet "refs/heads/$name"
                git worktree add "$rundir" "$name"; or return 1
            else
                git worktree add -b "$name" "$rundir" "$base"; or return 1
            end
        end
    end

    set -l state_file "/tmp/ocw-"(string replace -a '/' '_' "$id")
    test -n "$profile"; and printf '%s\n' "$profile" > "$state_file"
    test -f "$state_file"; and set profile (cat "$state_file")

    set -l cfg
    if set -q XDG_CONFIG_HOME; and test -n "$XDG_CONFIG_HOME"
        set cfg "$XDG_CONFIG_HOME/opencode"
    else
        set cfg "$HOME/.config/opencode"
    end

    set -l profile_file
    set -l cli_file
    set -l runtime_root
    if test -n "$profile"
        set profile_file (__ocw_find_json "$cfg/profiles/$profile"); or begin
            echo "ocw: profile '$profile' not found in $cfg/profiles" >&2
            return 2
        end
        set cli_file "$cfg/cli/$profile.json"
        if not test -f "$cli_file"
            echo "ocw: CLI profile '$profile' not found: $cli_file" >&2
            return 2
        end
        set runtime_root (__ocw_prepare_profile_root "$cfg" "$profile" "$profile_file"); or return $status
    end

    if test -n "$profile"
        set -e OPENCODE_CONFIG
        set -e OPENCODE_CONFIG_CONTENT
        set -lx OPENCODE_CONFIG_DIR "$runtime_root"
        set -lx OPENCODE_CLI_CONFIG_CONTENT (cat "$cli_file" | string collect)
    end

    if test $explain -eq 1
        pushd "$rundir" >/dev/null; or return 1
        __ocw_explain "$profile" "$profile_file" "$cli_file" "$rundir" "$runtime_root"
        set -l explain_status $status
        popd >/dev/null
        return $explain_status
    end

    set -l first ''
    test (count $args) -gt 0; and set first $args[1]

    if test -n "$profile"
        # OpenCode 2.0.11 debug config/agents do not expose the compatibility
        # runtime profile correctly. Project those diagnostics from the generated
        # runtime config so profiled debug commands remain useful and JSON-safe.
        if test (count $args) -ge 2; and test "$args[1]" = debug; and test "$args[2]" = config
            echo "ocw: active profile -> [$profile] (compat debug config)" >&2
            jq -n \
                --arg path "$runtime_root/opencode.json" \
                --arg dir "$runtime_root" \
                --slurpfile cfg "$runtime_root/opencode.json" \
                '[{type:"document", path:$path, info:$cfg[0]}, {type:"directory", path:$dir}]'
            return $status
        end

        if test (count $args) -ge 2; and test "$args[1]" = debug; and test "$args[2]" = agents
            echo "ocw: active profile -> [$profile] (compat-projected debug agents)" >&2
            set -l agents_json (fish -c 'cd $argv[1]; or exit 1; opencode debug agents' -- "$rundir" | string collect)
            or return $status
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
            return $status
        end

        switch "$first"
            case run
                echo "ocw: active profile -> [$profile] (standalone)" >&2
                set -e args[1]
                fish -c 'cd $argv[1]; or exit 1; exec opencode run --standalone $argv[2..-1]' -- "$rundir" $args
            case '' '-*'
                echo "ocw: active profile -> [$profile] (standalone)" >&2
                fish -c 'cd $argv[1]; or exit 1; exec opencode --standalone $argv[2..-1]' -- "$rundir" $args
            case '*'
                echo "ocw: active profile -> [$profile]" >&2
                fish -c 'cd $argv[1]; or exit 1; exec opencode $argv[2..-1]' -- "$rundir" $args
        end
    else
        fish -c 'cd $argv[1]; or exit 1; exec opencode $argv[2..-1]' -- "$rundir" $args
    end
end

function ocw-rm
    test (count $argv) -ge 1; or begin
        echo 'usage: ocw-rm <branch>' >&2
        return 1
    end
    set -l name $argv[1]
    set -l root (git rev-parse --show-toplevel 2>/dev/null); or return 1
    git worktree remove --force "$root-wt/$name"; and git branch -D "$name"
end

function ocw-ls
    git worktree list
end

function __ocw_worktree_names
    set -l root (git rev-parse --show-toplevel 2>/dev/null); or return
    set -l wtdir "$root-wt"
    test -d "$wtdir"; or return
    for d in $wtdir/*/
        basename $d
    end
end

complete -c ocw -f -n 'test (count (commandline -opc)) -eq 1' -a '(__ocw_worktree_names)'
complete -c ocw-rm -f -n 'test (count (commandline -opc)) -eq 1' -a '(__ocw_worktree_names)'
