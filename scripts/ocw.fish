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
#   ocw <branch> [base] [--profile PROFILE] [--no-worktree] [-- opencode-args...]
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

function ocw
    test (count $argv) -ge 1; or begin
        echo "usage: ocw <branch> [base] [-p profile] [--no-worktree]" >&2
        return 1
    end

    set -l name $argv[1]
    set -e argv[1]

    set -l args
    set -l pre_args
    set -l post_args
    set -l profile
    set -l no_worktree 0
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
            case --no-worktree
                set no_worktree 1
                set -e argv[1]
            case '*'
                set -a pre_args $argv[1]
                set -e argv[1]
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

    if set -q XDG_CONFIG_HOME; and test -n "$XDG_CONFIG_HOME"
        set -l cfg "$XDG_CONFIG_HOME/opencode"
    else
        set -l cfg "$HOME/.config/opencode"
    end

    set -l profile_file
    set -l cli_file
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
    end

    if test -n "$profile"
        set -lx OPENCODE_CONFIG "$profile_file"
        set -lx OPENCODE_CLI_CONFIG_CONTENT (cat "$cli_file")
        echo "ocw: active profile -> [$profile]"
    end

    # Run OpenCode in a child Fish process so sourcing this file never replaces
    # the user's interactive shell. Exported local variables are inherited.
    fish -c 'cd $argv[1]; or exit 1; exec opencode $argv[2..-1]' -- "$rundir" $args
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
