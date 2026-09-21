# ocw - OpenCode Worktree Launcher (Fish / OpenCode v2)
#
# CONFIG LAYOUT:
#   $XDG_CONFIG_HOME/opencode/ (or ~/.config/opencode/)
#   ├── opencode.jsonc
#   ├── cli.json
#   ├── profiles/<profile>.jsonc
#   ├── cli/<profile>.json
#   └── themes/*.json
#
# USAGE:
#   ocw <branch> [base] [--profile PROFILE] [--explain] [--no-worktree] [-- opencode-args...]
#   ocw-rm <branch>
#   ocw-ls
#
# --explain verifies the effective profile by starting a temporary V2/core
# server and querying its /api/config and /api/agent endpoints directly.

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
        echo 'ocw: jq is required to merge OpenCode v2 profiles' >&2
        return 2
    end

    set -l uid (id -u)
    set -l runtime_base /tmp
    if set -q XDG_RUNTIME_DIR; and test -n "$XDG_RUNTIME_DIR"
        set runtime_base $XDG_RUNTIME_DIR
    end
    set -l root "$runtime_base/ocw-opencode-$uid-$profile"
    mkdir -p "$root"; or return 1

    for item in $cfg/*
        test -e "$item"; or continue
        set -l name (basename "$item")
        switch $name
            case . .. opencode.json opencode.jsonc cli.json cli.jsonc profiles cli
                continue
        end
        test -e "$root/$name"; or ln -s "$item" "$root/$name" 2>/dev/null; or true
    end

    set -l base (__ocw_find_json "$cfg/opencode" 2>/dev/null)
    set -l tmp "$root/.opencode.json.tmp.$fish_pid"
    if test -n "$base"
        jq -s '.[0] * .[1]' "$base" "$profile_file" > "$tmp"; or begin
            rm -f "$tmp"
            echo "ocw: failed to merge $base with $profile_file (profiles must be JSON-compatible JSONC)" >&2
            return 2
        end
    else
        jq '.' "$profile_file" > "$tmp"; or begin
            rm -f "$tmp"
            echo "ocw: failed to parse $profile_file (profiles must be JSON-compatible JSONC)" >&2
            return 2
        end
    end
    mv -f "$tmp" "$root/opencode.json"; or return 1
    echo "$root"
end

function __ocw_pick_port
    type -q python3; or begin
        echo 'ocw: python3 is required for --explain runtime verification' >&2
        return 2
    end
    python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()'
end

function __ocw_print_agent_models
    set -l output $argv[1]
    if not printf '%s\n' "$output" | jq -e 'type == "array"' >/dev/null 2>&1
        printf '%s\n' "$output"
        return 2
    end

    printf '%s\n' "$output" | jq -r '
      def modelstr:
        if .model == null then "<inherit session>"
        elif (.model | type) == "string" then .model
        else
          ((.model.providerID // .model.provider // "?") | tostring)
          + "/"
          + ((.model.modelID // .model.id // .model.model // "?") | tostring)
          + (if ((.model.variant // "") | tostring) != "" then "#" + ((.model.variant // "") | tostring) else "" end)
        end;
      .[] | [(.id // .name // "?"), modelstr] | @tsv
    ' | awk -F '\t' '{ printf "  %-22s %s\n", $1, $2 }'
end

function __ocw_verify_profile_models
    set -l profile_file $argv[1]
    set -l agents_file $argv[2]
    set -l expected_file $argv[3]

    jq -r '
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
    ' "$profile_file" > "$expected_file"; or return 2

    if not jq -e 'type == "array"' "$agents_file" >/dev/null 2>&1
        echo 'ocw: standalone server /api/agent returned an unexpected response shape' >&2
        return 2
    end

    set -l count 0
    set -l mismatches 0
    printf '  %-20s %-32s %-32s %s\n' agent expected effective status
    while read -l line
        test -n "$line"; or continue
        set -l fields (string split (printf '\t') -- "$line")
        set -l id $fields[1]
        set -l model $fields[2]
        set count (math $count + 1)
        set -l actual (jq -r --arg id "$id" '
          def modelstr:
            if .model == null then "<inherit session>"
            elif (.model | type) == "string" then .model
            else
              ((.model.providerID // .model.provider // "?") | tostring)
              + "/"
              + ((.model.modelID // .model.id // .model.model // "?") | tostring)
              + (if ((.model.variant // "") | tostring) != "" then "#" + ((.model.variant // "") | tostring) else "" end)
            end;
          first(.[] | select((.id // .name) == $id) | modelstr) // "<missing agent>"
        ' "$agents_file")
        if test "$actual" = "$model"
            printf '  %-20s %-32s %-32s %s\n' "$id" "$model" "$actual" OK
        else
            printf '  %-20s %-32s %-32s %s\n' "$id" "$model" "$actual" MISMATCH
            set mismatches (math $mismatches + 1)
        end
    end < "$expected_file"

    if test $count -eq 0
        echo '  (profile defines no explicit agent models)'
        return 2
    end
    test $mismatches -eq 0
end

function __ocw_stop_verify_server
    set -l pid $argv[1]
    if test -n "$pid"
        kill "$pid" 2>/dev/null; or true
        for i in (seq 1 20)
            kill -0 "$pid" 2>/dev/null; or break
            sleep 0.05
        end
        if kill -0 "$pid" 2>/dev/null
            kill -9 "$pid" 2>/dev/null; or true
        end
        wait "$pid" 2>/dev/null; or true
    end
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
    if test -n "$profile"
        echo '  server mode:    private/standalone'
    else
        echo '  server mode:    shared'
    end
    printf '  runtime root:   %s\n' (test -n "$runtime_root"; and echo "$runtime_root"; or echo '<global/default>')

    if test -z "$profile"
        echo
        echo 'resolved agents (global/default debug view)'
        opencode debug agents
        return $status
    end

    type -q jq; or begin
        echo 'ocw: jq is required for --explain' >&2
        return 2
    end
    type -q curl; or begin
        echo 'ocw: curl is required for --explain runtime verification' >&2
        return 2
    end

    set -l port (__ocw_pick_port); or return $status
    set -l verify_user opencode
    set -l verify_password (python3 -c 'import secrets; print(secrets.token_urlsafe(24))'); or return 2
    set -l runtime_base /tmp
    if set -q XDG_RUNTIME_DIR; and test -n "$XDG_RUNTIME_DIR"
        set runtime_base $XDG_RUNTIME_DIR
    end
    set -l logdir "$runtime_base/ocw-verify-"(id -u)
    mkdir -p "$logdir"; or return 1
    set -l logfile "$logdir/$profile-$port.log"

    begin
        cd "$rundir"; or exit 1
        set -e OPENCODE_CONFIG
        set -e OPENCODE_CONFIG_CONTENT
        set -e XDG_CONFIG_HOME
        set -lx OPENCODE_CONFIG_DIR "$runtime_root"
        set -lx OPENCODE_SERVER_USERNAME "$verify_user"
        set -lx OPENCODE_SERVER_PASSWORD "$verify_password"
        set -e OPENCODE_PASSWORD
        exec opencode serve --hostname 127.0.0.1 --port "$port"
    end >"$logfile" 2>&1 &
    set -l pid $last_pid

    set -l ready 0
    for i in (seq 1 100)
        if not kill -0 "$pid" 2>/dev/null
            echo 'ocw: standalone verification server exited during startup' >&2
            sed -n '1,120p' "$logfile" >&2
            __ocw_stop_verify_server "$pid"
            return 3
        end
        if curl -fsS --max-time 1 --user "$verify_user:$verify_password" "http://127.0.0.1:$port/api/health" >/dev/null 2>&1
            set ready 1
            break
        end
        sleep 0.05
    end

    if test $ready -ne 1
        echo 'ocw: standalone verification server did not become ready' >&2
        sed -n '1,120p' "$logfile" >&2
        __ocw_stop_verify_server "$pid"
        return 3
    end

    set -l tmpdir "$runtime_base/ocw-verify-"(id -u)"-$port"
    mkdir -p "$tmpdir"; or begin
        __ocw_stop_verify_server "$pid"
        return 1
    end
    set -l config_file "$tmpdir/config.json"
    set -l agents_file "$tmpdir/agents.json"
    set -l expected_file "$tmpdir/expected.tsv"

    curl -fsS --max-time 5 --user "$verify_user:$verify_password" -H "x-opencode-directory: $rundir" "http://127.0.0.1:$port/api/config" > "$config_file"; or begin
        echo 'ocw: failed to query standalone server /api/config' >&2
        __ocw_stop_verify_server "$pid"
        return 3
    end
    curl -fsS --max-time 5 --user "$verify_user:$verify_password" -H "x-opencode-directory: $rundir" "http://127.0.0.1:$port/api/agent" > "$agents_file"; or begin
        echo 'ocw: failed to query standalone server /api/agent' >&2
        __ocw_stop_verify_server "$pid"
        return 3
    end

    echo
    echo 'private V2/core server config'
    if jq -e 'type == "object"' "$config_file" >/dev/null 2>&1
        printf '  default agent:     %s\n' (jq -r '.default_agent // "<unset>"' "$config_file")
        printf '  configured agents: %s\n' (jq -r '(.agent // .agents // {}) | length' "$config_file")
        printf '  providers:         %s\n' (jq -r '(.provider // .providers // {}) | keys | join(", ")' "$config_file")
    else
        echo 'ocw: standalone server /api/config returned an unexpected response shape' >&2
        cat "$config_file" >&2
        __ocw_stop_verify_server "$pid"
        return 3
    end

    echo
    echo 'resolved agents (private V2/core server)'
    set -l agents_output (cat "$agents_file" | string collect)
    __ocw_print_agent_models "$agents_output"; or begin
        __ocw_stop_verify_server "$pid"
        return 3
    end

    echo
    echo 'profile model verification'
    __ocw_verify_profile_models "$profile_file" "$agents_file" "$expected_file"
    set -l verify_status $status
    __ocw_stop_verify_server "$pid"
    rm -rf "$tmpdir" 2>/dev/null

    if test $verify_status -ne 0
        echo >&2
        echo 'ocw: profile verification FAILED' >&2
        return 3
    end

    echo
    echo 'profile load: OK'
    return 0
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
            echo "usage: ocw <branch> [base] [-p profile] [--explain] [--no-worktree]" >&2
            echo "       ocw --profile PROFILE --explain" >&2
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

    if test -n "$profile"
        switch "$args[1]"
            case debug db models mcp
                echo "ocw: active profile -> [$profile]"
                fish -c 'cd $argv[1]; or exit 1; exec opencode $argv[2..-1]' -- "$rundir" $args
            case run
                echo "ocw: active profile -> [$profile] (standalone)"
                set -e args[1]
                fish -c 'cd $argv[1]; or exit 1; exec opencode run --standalone $argv[2..-1]' -- "$rundir" $args
            case '*'
                echo "ocw: active profile -> [$profile] (standalone)"
                fish -c 'cd $argv[1]; or exit 1; exec opencode --standalone $argv[2..-1]' -- "$rundir" $args
        end
    else
        fish -c 'cd $argv[1]; or exit 1; exec opencode $argv[2..-1]' -- "$rundir" $args
    end
end

function ocw-rm
    test (count $argv) -ge 1; or begin
        echo "usage: ocw-rm <branch>" >&2
        return 1
    end
    set -l name $argv[1]
    set -l root (git rev-parse --show-toplevel 2>/dev/null); or return 1
    git worktree remove --force "$root-wt/$name"; and git branch -D "$name"
end

function ocw-ls
    git worktree list
end

# --- tab completion ---
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
