---
name: cli-design
description: CLI as a first-class human interface — command grammar, composability, exit semantics, stdin/stdout/stderr contracts, discoverability, help text design, and error message design. Use when designing any command-line interface: developer tools, build systems, deployment tools, data processing pipelines, or system administration tools. Also load when reviewing an existing CLI for design quality. Not for TUI interactive applications with persistent sessions (→ `tui-design`), general interaction patterns (→ `interaction-design`), or implementing CLI code in a specific language (→ `golang-cli` or equivalent).
metadata:
  version: "1.0.0"
---

# CLI Design

## What this skill is for

CLI design is the professional practice of designing command-line interfaces as human interfaces with genuine UX obligations. A CLI is not the absence of UI — it is a distinct interaction surface with its own grammar, conventions, composability requirements, and failure modes. Treating it as pure plumbing produces opaque, automation-hostile, expert-only tools that frustrate users and break pipelines.

> "Today's command line is human-first: a text-based UI that affords access to all kinds of tools, systems and platforms." — clig.dev (Command Line Interface Guidelines, 2021)

**Load this skill when:**
- Designing the command hierarchy, subcommand structure, or flag vocabulary for a CLI tool
- Designing stdin/stdout/stderr behavior, exit codes, or piping behavior
- Designing help text, error messages, or discoverability for a CLI
- Reviewing an existing CLI for design quality — grammar coherence, stream contracts, exit code correctness
- The tool will be used both interactively and in scripts, pipelines, or CI environments

**Do NOT load this skill when:**
- Designing a TUI — a stateful interactive application that holds the terminal for multiple interactions (→ `tui-design`). The boundary: if the program runs and exits per command, it is a CLI. If it holds a persistent interactive session with a render loop, it is a TUI.
- Implementing CLI parsing or flag handling in code (→ `golang-cli` or language equivalent)
- Designing general interaction patterns not specific to CLI (→ `interaction-design`)

**Boundary with `tui-design`:** Session model is the line. A CLI executes one command and exits — the session model is stateless command-response. A TUI owns the terminal across multiple user interactions — it has a render loop and persistent state. A tool that embeds a `:` command mode (like vim) occupies both; load both skills.

---

## CLI is a human interface

The "CLI is not UI" assumption is itself a named failure mode. A CLI:

- Has interaction patterns — the user constructs a command, reads a response, decides what to do next
- Has discoverability constraints — a user who doesn't know a flag exists cannot hover over something to find it
- Has error message design obligations — a bad error message leaves the user stranded
- Has progressive disclosure requirements — novice users need different affordances than power users
- Has accessibility implications — screen readers interact with terminal output; exit codes are accessibility signals for automated tools

The consequence: CLI design decisions are design decisions. They require the same intentionality as web or desktop UI decisions.

**Sources:** clig.dev (primary modern synthesis, community-vetted, 2021, verified live 2026-09-02); The Art of Unix Programming (Eric S. Raymond, 2003) foundational Unix composability philosophy; GNU Coding Standards (Free Software Foundation) for flag naming conventions; POSIX.1-2017 IEEE Std 1003.1-2017 §2.8.2 for exit code normative specification; no-color.org for the `NO_COLOR` informal standard (200+ tools conforming, verified 2026-09-02).

---

## Command grammar

A command grammar defines how a CLI parses user intent from a sequence of tokens. Grammar design is the IA problem applied to CLI: the same principles of hierarchy, labeling, and mental model alignment apply — but expressed as command syntax.

### Two dominant grammar patterns

**Verb-noun (resource-oriented):** `kubectl get pods`, `docker build .`, `npm install express`. The tool name is the domain, the first positional is the action verb, subsequent arguments are targets. Fits tools with many resource types and operations on them. Subcommand discovery is natural: `kubectl --help` shows all verbs.

**Action-first (repository-oriented):** `git checkout main`, `git commit -m "msg"`, `git push origin`. The subcommand is the operation. Fits tools where the operation is the user's primary mental model. `git`'s vocabulary maps to what you do in a repository — the verbs are git operations, not generic CRUD.

**When to use subcommands vs flags:**
- Use subcommands when the tool has genuinely distinct operation types requiring different argument patterns
- Use subcommands when there are more than 5–7 top-level operations
- Avoid subcommands for single-purpose tools — they add discoverability overhead without benefit
- Use verb-first subcommand naming (`get`, `create`, `delete`, `list`) when operations are the primary mental model
- Use noun-first when objects are the primary mental model and operations are few

**Flat (no subcommands):** `grep`, `ls`, `cp`. No subcommands; action determined by flags and positional arguments. Appropriate for single-purpose tools. Does not scale to multi-domain tools.

### Grammar rules for arguments and flags

- **Positional arguments** are order-sensitive and opaque in scripts — the user must know which position means what
- **Flags** are named, order-independent, and self-documenting — prefer flags over positional arguments
- If two or more positional arguments serve different purposes, this is a grammar design problem: name them as flags instead
- **Exception worth keeping:** the `source → destination` positional pair (`cp <src> <dst>`, `mv <from> <to>`) is established convention whose brevity is worth the positional ambiguity
- Make flags and subcommands order-independent where possible — a global flag that must appear before the subcommand breaks muscle memory

### Command naming

- **Verbs:** Imperative, specific, unambiguous. `create` not `make`. `delete` not `remove` (unless the tool's domain uses "remove"). `build` not `run-build`.
- **Nouns:** Match the user's mental model, not the system's internal structure. `user` not `auth-entity`. `deploy` not `run-ci-pipeline-with-deploy-stage`.
- **Consistency:** If the tool uses `create` for one resource, it must use `create` for all resources — not `create`, `add`, `new` mixed across subcommands.
- **Single-responsibility:** Each command does one thing. A command that deploys AND sends notifications AND updates a ticket tracker is three commands packaged poorly.

### The single-responsibility principle for commands

Each command does one thing and signals its outcome via exit code. A command that partially succeeds at multiple operations leaves the caller unable to determine what happened. When a command must orchestrate multiple operations, each step should fail loudly and early so the caller can retry or intervene.

---

## Flag conventions

Flags are the primary configuration mechanism for CLI tools. Poor flag design accumulates debt that cannot be fixed without breaking users' muscle memory and scripts.

### Short flags vs long flags

**Short flags** (`-f`, `-v`, `-q`): Single dash, single character. Faster to type interactively. Cannot be self-documenting in scripts — reading `-f` in a shell script tells you nothing without context. Reserve for genuinely common operations only.

**Long flags** (`--force`, `--verbose`, `--quiet`): Double dash, full word. Self-documenting in scripts. Every short flag must have a long-flag equivalent — never provide only a short flag. Per GNU Coding Standards (cited by clig.dev), long forms are mandatory.

**Standard flag vocabulary** (from clig.dev, drawn from established UNIX conventions — deviate from these only with specific cause):

| Short | Long | Meaning |
|---|---|---|
| `-a` | `--all` | Show all items |
| `-d` | `--debug` | Debug output |
| `-f` | `--force` | Force action without confirmation |
| — | `--json` | Structured JSON output |
| `-h` | `--help` | Help text (MUST NOT be reassigned) |
| `-n` | `--dry-run` | Simulate without acting |
| `-o` | `--output` | Output file path |
| `-p` | `--port` | Port number |
| `-q` | `--quiet` | Suppress non-essential output |
| `-v` | `--verbose` | Verbose output (or version — avoid this conflict) |
| — | `--version` | Version information |
| — | `--no-color` | Disable color output |
| — | `--no-input` | Disable interactive prompts (for CI) |

**The `-h` rule is absolute:** `-h` means help. Never reassign `-h` to another purpose. A user who types `-h` expecting help must receive help.

### Boolean flags

A boolean flag is present or absent — it takes no value:
- Correct: `--verbose` (verbose mode on), `--no-verbose` or `--quiet` (verbose mode off)
- Wrong: `--verbose true` (boolean flag should not accept a value)
- The negation convention: `--no-<flag>` for disabling a flag that defaults to on

### Value flags

Flags that accept a value must support both `=` and space-separated forms:
- `--count=5` (POSIX convention, unambiguous in parsing)
- `--count 5` (more natural to type; what most users try first)

Supporting only one form breaks muscle memory for users of the other convention. A CLI that accepts only `--count=5` will generate constant user error when people type `--count 5`. Design the parsing to accept both.

### Secrets and flags — a security design constraint

Do NOT accept secrets (passwords, API keys, tokens) via flags. Flag values appear in:
- `ps` output — visible to all users on the system
- Shell history — stored in `~/.bash_history` or equivalent
- CI/CD logs — often stored and searched

Instead, accept secrets via:
- `--password-file <path>` (reads from file)
- `--token-file <path>` (reads from file)
- Environment variables (appropriate for session-scoped secrets)
- stdin (when the caller can pipe the secret)

This is a design constraint, not just implementation hygiene. The spec must define which mechanism is used.

### Global flags vs subcommand flags

When a CLI has subcommands, every flag must belong somewhere:
- **Global flags:** Apply to all subcommands — `--verbose`, `--config`, `--output`. Should appear before the subcommand.
- **Subcommand flags:** Apply only to one subcommand — `--branch` for `git checkout`, `--message` for `git commit`.

Design decision: a flag that is almost always the same across subcommands is a global flag. A flag specific to one operation belongs only on that subcommand.

**Discoverability implication:** Users learn where to look for flags. If the same flag appears in some subcommands but not others, users cannot predict where to find it. Consistency is a discoverability obligation.

### The `--` separator

`--` signals "end of flags." Everything after `--` is treated as a positional argument, even if it starts with `-`. This is POSIX convention and enables commands like:

```bash
git checkout -- -unusual-filename
grep -- -v pattern file  # -v is a filename here, not "verbose"
```

Any CLI that processes filenames or arbitrary strings must handle `--`. Design the grammar to document when `--` is relevant.

---

## stdin / stdout / stderr stream discipline

Stream discipline is the design contract that makes CLIs composable. Violations break pipelines silently. This is one of the most frequently violated contracts in CLI design, and the one with the highest composability cost.

### The three streams

**stdout** — The primary data stream. Where results go. What `|` sends to the next program in a pipeline. The contract: **only data that belongs to the command's output goes on stdout.** Nothing else. A user piping your command's output to another program receives exactly the data they want — no error messages, no progress indicators, no banners, no decorations.

**stderr** — The diagnostic stream. Where error messages, warnings, progress indicators, log messages, and interactive prompts go. stderr is NOT piped by default — it goes to the terminal even when stdout is piped. This means: the user sees diagnostic output in their terminal while downstream programs receive only clean data. The contract: **everything that is not primary output goes on stderr.**

**stdin** — The input data stream. What the previous program in the pipeline sent. A CLI that reads from stdin and writes to stdout is a filter — the fundamental composable unit of Unix.

### Why violations matter

Printing an error message on stdout corrupts the pipeline. If `Error: file not found` appears on stdout, the next program receives it as if it were data — it processes a line that says "Error: file not found" as part of its input. The behavior is undefined and usually wrong. Worse: this failure often appears as data corruption downstream, not as an obvious error. The user sees wrong results, not a clear error.

Printing progress indicators on stdout corrupts the pipeline. `Downloading... 25%  50%  75%  100%  Done!` printed to stdout means the next program receives that text as its input data.

**clig.dev rule:** "Send output to stdout. Send messaging to stderr." This is stated as a basic, non-negotiable rule.

### The interactive/non-interactive split

Design behavior differently based on whether stdout is a terminal:

- **stdout is a TTY (interactive terminal):** Format for humans. Use color, pagination, progress bars on stderr, human-readable summaries. Examples: `git log` shows a paginated log with color; `ls` aligns output in columns.
- **stdout is not a TTY (piped):** Format for machines. Plain text, stable columns, no color, no animation. Examples: `git log --oneline` piped to `grep` strips color; `ls` pipes as one filename per line.

Detection: `isatty()` on the stdout file descriptor. This is a design decision — the spec must define what changes in each mode.

**clig.dev rule:** "Only use formatting when output is to a TTY." This is the universal principle behind how `git`, `ls`, `rg` all behave.

### The `-` convention for stdin/stdout

Accept `-` as a filename argument to mean "read from stdin" (input) or "write to stdout" (output). This makes CLIs composable with pipes even when they primarily work with files:

```bash
cat file.txt | sort -     # sort reads from stdin
myapp process - | jq .    # myapp reads stdin, pipes to jq
```

Any CLI that works with files should support `-` as a filename. The spec should document which arguments accept `-`.

### Structured output

When complex data structures cannot be expressed as line-delimited text, provide `--json`:

```bash
myapp list --json | jq '.items[] | select(.status == "active")'
```

`--json` is the composability contract with `jq`, web APIs, and any JSON-aware tool. Design rules for `--json`:
- When `--json` is active, errors must also be JSON — a JSON consumer expects JSON on both success and failure
- The JSON schema must be documented — it is a contract consumers depend on
- Use `--output json` as an alternative form when the tool has multiple output formats

### The quiet mode obligation

A CLI with no quiet mode pollutes pipelines. Scripts that call a CLI to get a single value or exit code receive a stream of decorative output they must parse around. Provide `-q` / `--quiet` to suppress all non-essential output — progress indicators, summaries, banners. In quiet mode, only essential data output (if any) goes to stdout; exit code communicates success/failure.

---

## Exit codes

Exit codes are the machine-readable signal of success or failure. They are not optional decoration — they are the primary interface between a CLI and the scripts that orchestrate it. A script uses exit codes to branch, to decide whether to continue, to report failure to its caller. Every meaningful failure mode that a script might need to distinguish requires a distinct exit code.

### POSIX exit code conventions (normative)

From IEEE Std 1003.1-2017 §2.8.2 Exit Status for Commands:

| Code | Meaning |
|---|---|
| `0` | Success — the command completed successfully. Always, without exception. |
| `1` | General error — something went wrong |
| `2` | Misuse / usage error — the user invoked the command incorrectly (wrong flags, missing required arguments, invalid values) |

Beyond 2, POSIX leaves codes undefined. By de facto convention (not normative):

| Code | Meaning |
|---|---|
| `126` | Command found but not executable |
| `127` | Command not found |
| `128+N` | Process terminated by signal N (shell convention) |
| `130` | Script terminated by Ctrl-C (signal 2 = SIGINT → 128+2=130) |

### Designing a meaningful exit code taxonomy

For tools where scripts need to distinguish failure types, define explicit exit codes:

**Example: `grep`'s three-way exit code design:**
- `0` — match found
- `1` — no match (but the operation succeeded — searching just found nothing)
- `2` — error (permission denied, file not found)

This is a clean design. A script can write: `if grep pattern file; then ... elif [ $? -eq 1 ]; then # no match, not an error`.

**Design process:**
1. Enumerate every meaningful outcome the caller needs to distinguish
2. Assign each a code in the range 1–125 (avoid 126-130, shell-reserved by convention)
3. Document the exit code table as a Design Spec element — it is a contract
4. Implement the table as the definitive specification (verify that the code matches the table, not the other way around)

### Exit codes as a flow design element

A CLI is called in a flow: `set -e` stops the script on any non-zero exit. Conditional logic (`if`, `||`, `&&`) branches on exit codes. The user's script depends on exit codes behaving consistently.

Design implications:
- A command that partially succeeds must decide: is partial success a success (exit 0) or a failure (exit non-zero)? The answer depends on what the caller needs. If a script retries on failure, partial success that exits 0 prevents the retry. If a script logs failures, partial success that exits non-zero causes false alarms. Document the decision.
- A command that does nothing (no-op) must exit 0 — doing nothing successfully is success.
- A command that would do something but `--dry-run` prevents it must exit 0 (or the dry-run code if defined) — the dry-run succeeded.

### The most dangerous exit code anti-pattern

**Exiting 0 on failure.** This is the most destructive exit code error. A program that exits 0 when an operation fails breaks `set -e` silently — the script continues as if the operation succeeded, producing wrong results with no error signal. The user's pipeline appears to succeed while the output is corrupted.

**clig.dev rule:** "Return zero exit code on success, non-zero on failure." This is one of the few absolute, non-negotiable CLI design rules.

---

## Discoverability without a GUI

CLI discoverability is a design problem, not a documentation problem. A user who doesn't know a flag exists cannot find it by hovering over something. Every discoverability mechanism in a CLI must be explicitly designed.

### `--help` as the primary discovery mechanism

`--help` is required on every command and every subcommand. Design `--help` content as a first-class artifact, not as documentation added after the fact.

**What `--help` must contain:**
1. **Name and one-line description** — what this command does, in one sentence
2. **Usage line** — the grammar: `command [flags] <argument>`
3. **All flags** — with short and long forms, default values, and one-line descriptions
4. **Examples** — at least one concrete example showing common usage
5. **Pointer to more** — man page, documentation URL, or `--help` for subcommands

**What `--help` must not do:**
- Bury the usage line in paragraphs of description
- List flags in alphabetical order when frequency order would be more useful
- Omit examples — a user who can see `myapp push --branch main` learns faster than from any prose description
- Print to stdout — help text should go to stdout when the user requests it (for piping to `grep`), but consider the context

**Contextual help consistency:** `myapp subcommand --help` and `myapp help subcommand` must produce the same output. Users learn one pattern and expect it to work for all subcommands.

### Progressive disclosure in help text

Design help text in layers:
1. **Brief summary:** Running `myapp` with no arguments (if arguments are required) shows: command description, most common subcommand, one example, pointer to `--help`
2. **Full help:** `myapp --help` shows all flags, all subcommands, all options, multiple examples
3. **Subcommand help:** `myapp subcommand --help` shows the subcommand's flags and examples

The `gh` CLI exemplifies this: `gh` alone shows the most common subcommands and `gh --help` for the full list. This is deliberate IA applied to help text.

### Tab completion as discoverability

Shell tab completion is a discoverability mechanism. When a user types `myapp sub<TAB>`, the shell shows matching subcommands. When they type `myapp push --<TAB>`, the shell shows available flags.

Tab completion design decisions:
- Which subcommands should complete? (All of them — completions are the menu for the grammar)
- Which flag values should complete? (Enum values, file paths, resource names from API)
- Should the completion fetch live data? (e.g., `kubectl get <TAB>` can complete resource names from the cluster)

Implementation is language-specific (`golang-cli`), but the design decision is: what data is useful to expose via completion?

Modern CLIs that generate shell completion scripts: `kubectl completion bash`, `gh completion -s zsh`, `docker completion`. This is the standard pattern — provide a `completion` subcommand that outputs the completion script for the requested shell.

### Error messages as discoverability

"Did you mean `git status`?" is a discoverability feature embedded in an error path. When the user misspells a command, a good CLI suggests the closest valid alternative.

When a command fails, the error message is the user's primary navigation tool. Design error messages to:
1. Name what went wrong specifically (not "an error occurred")
2. Suggest what to do next (the fix, not just the problem)
3. Reference the relevant flag or subcommand (`Try 'myapp push --help' for more information`)

### Man pages

Man pages complement `--help`:
- `--help` is the quick-reference, always available without internet, displays immediately
- Man page is the full reference, with more examples, more context, explanation of edge cases, configuration file format

Design decision: what belongs in each. All flags and their descriptions belong in both. Extended usage examples, configuration file syntax, and environment variable documentation belong in the man page.

---

## Interactive vs non-interactive modes

CLIs are called from CI pipelines, Makefiles, scripts, and automated tools. Designing only for interactive use breaks every automation context.

### Detecting the context

Design behavior differently based on whether stdin and stdout are connected to a terminal:
- `isatty(stdin)` — is stdin connected to a terminal? If not, the user is piping input
- `isatty(stdout)` — is stdout connected to a terminal? If not, the output is being piped or redirected

When stdin is not a TTY: skip interactive prompts, require all inputs as flags or environment variables, do not wait for input that will never come.

**The interactive hang anti-pattern:** A command that waits for user input (a `y/n` prompt, a text editor, a confirmation) when stdin is piped hangs indefinitely. CI pipelines time out. Automated scripts stall. This breaks automation silently — the pipeline appears to be running, just never finishing.

**clig.dev rule:** "Only use prompts or interactive elements if stdin is an interactive terminal (a TTY)." This is a non-negotiable rule.

### Confirmations for destructive operations

- **Interactive:** Prompt with `y/n` or type the resource name to confirm
- **Non-interactive (pipeline):** Require explicit `--force` or `--yes` flag — fail loudly if not provided
- **Severe destruction** (delete a namespace, wipe a database): Require typing the resource name (`kubectl delete namespace foo --confirm=foo`) — typo protection even for users who remembered `--force`

The design decision: what is destructive enough to require explicit confirmation? Document the threshold.

### The `--yes` / `--force` / `--no-input` pattern

Make interactive-by-default commands scriptable:
- `--yes` / `-y`: Answer yes to all confirmations (for benign automation)
- `--force` / `-f`: Force destructive action without confirmation
- `--no-input`: Explicitly disable all interactive prompts; fail if any required input is missing

Provide all three when appropriate. `--yes` is for scripting, `--force` is for bypassing safety checks, `--no-input` is for strict pipeline contexts.

---

## Color and terminal decoration

Color is a design choice with automation implications. Default color output that cannot be disabled breaks CI logs (escape codes appear as garbage characters).

### When to disable color

Disable color automatically when:
- stdout is not a TTY (piped or redirected)
- `NO_COLOR` environment variable is set and non-empty (informal standard from no-color.org, 200+ tools conforming as of 2026)
- `TERM=dumb` (terminal that does not support escape codes)
- `--no-color` flag is explicitly passed

**Design rule:** Color on by default in TTY; color off by default in pipes. Users in TTY who want no color use `NO_COLOR`. Pipelines without color handling always get no color.

### Color and meaning

Never use color as the only signal of meaning. A green line vs a red line tells colorblind users nothing. Color + text is the correct pattern:
- `✓ Deployed successfully` (green text + symbol)
- `✗ Deployment failed: timeout after 30s` (red text + symbol)
- `⚠ Deprecated flag --old-flag, use --new-flag instead` (yellow text + symbol)

Color is an emphasis layer, not an information layer.

### Animations in non-TTY contexts

Progress bars, spinners, and animations must never appear when stdout is not a TTY. ANSI animation sequences produce garbage in CI logs. Detection is the same: `isatty(stdout)`. In non-TTY context, suppress all animation entirely.

---

## Error message design

Error messages are the primary negative-experience interface. A poor error message leaves the user with no understanding of what went wrong and no path forward.

### Criteria for a good CLI error message

1. **Directed to stderr** — error messages on stdout break pipelines (see stream discipline above)
2. **Specific** — names the thing that failed, not just that something failed. "Cannot write to file.txt" not "write error"
3. **Actionable** — tells the user what to do next. "Cannot write to file.txt — you may need to make it writable: `chmod +w file.txt`"
4. **Human-rewritten** — catches the raw exception and rewrites it in human terms. `EPERM: operation not permitted` becomes "Permission denied: cannot write to /etc/myapp.conf — try running with sudo, or change the config path with --config"
5. **No stack traces by default** — stack traces are developer output. Hide behind `--debug` flag
6. **Machine-parseable in `--json` mode** — when structured output is active, errors must also be structured: `{"error": "cannot write file", "path": "file.txt", "suggestion": "chmod +w file.txt"}`

### Placement of key information

The most important information (the fix) goes at the end of the error message — where the user's eye lands last in terminal scrollback. The least important context goes first:

```
# Good: key information last, where the eye goes
Error: Cannot connect to the deployment service
  Service URL: https://deploy.example.com:8080
  Timeout: 30s
  → Try: check that the service is running with `myapp service status`

# Poor: key information buried, user must scroll up to find the fix
→ Suggestion: run `myapp service status`
  (error occurred before this hint)
Error: Cannot connect
```

### Validation errors

Fail fast and be specific about which argument or flag is wrong:

```
# Good: identifies the specific problem
Error: --count must be a positive integer, got: -5
  Try: myapp process --count 10

# Poor: user must figure out what they did wrong
Error: invalid arguments
```

### Partial success

When a batch operation partially succeeds, communicate exactly what succeeded and what failed:

```
Deployed 3 of 5 services:
  ✓ api-service
  ✓ worker-service
  ✓ cache-service
  ✗ auth-service — connection timeout (try again with: myapp deploy auth-service)
  ✗ monitor-service — config invalid (see: myapp validate monitor-service)

Exit code 1 — some deployments failed
```

Partial success must exit non-zero if any operation failed — the script needs to know not all work completed.

---

## Composability

Composability is not about features — it is about contracts. A composable CLI is one that can be a well-behaved participant in a pipeline.

### The composability checklist

A CLI is composable when it satisfies all of:

1. **Clean stdout contract:** Only primary output data on stdout; all diagnostics on stderr
2. **Stable exit codes:** Documented codes that scripts can rely on and that do not change between versions
3. **Line-based text output by default:** `grep`, `awk`, `sed`, `sort` all operate on line-delimited text. Output that fits this model chains naturally with existing tools
4. **`--json` for structured data:** When complex structures cannot be line-delimited, provide `--json` for jq and JSON-aware tools
5. **Quiet mode:** `-q` / `--quiet` suppresses all non-essential output for scripts that need only the exit code or a single value
6. **`-` for stdin/stdout:** Accepts `-` as a filename argument to read from stdin or write to stdout
7. **No required interactive prompts:** All interactive prompts must have non-interactive alternatives via flags or environment variables

### The automation-first principle

Design for scripting first, interactive use second. Even developer tools are eventually scripted:
- Build scripts invoke compilers
- CI pipelines invoke test runners
- Infrastructure tools are called from Terraform or Ansible
- Deployment pipelines call CLIs directly

A tool designed only for interactive use accumulates automation friction that every script author must work around: stripping color codes, suppressing progress bars, parsing human-readable output, adding `--force` to bypass confirmations.

**The Unix philosophy applied:** Doug McIlroy's directive: "Expect the output of every program to become the input to another, as yet unknown, program." Design every command with this expectation. The unknown future consumer of your output is the most important design constraint you cannot see.

### Testing composability

Practitioners test piping explicitly:

```bash
myapp list | grep active
myapp list --json | jq '.items[] | .name'
result=$(myapp get-value --quiet)
myapp generate | wc -l
```

These paths expose stream contract violations that interactive testing misses. The spec should enumerate which piping patterns the design must support.

---

## Configuration hierarchy

A CLI can accept configuration from three sources. Design which source owns which type of configuration.

### The precedence order

**Flags > environment variables > config file > hardcoded defaults**

This is the conventional precedence order used by most professional CLIs. Each level overrides the levels below it:
- Flags are the most explicit, most transient — what the user typed this invocation
- Environment variables are session-scoped, inherited by subprocesses, appropriate for context configuration
- Config files are persistent, project-specific or user-specific
- Hardcoded defaults are the last resort when the user has configured nothing

**Why this order matters:** Explicit overrides implicit. A user who sets `--verbose` on the command line must get verbose output even if the config file says `verbose: false`. A CI pipeline that sets `MYAPP_NO_COLOR=1` must get no-color output even if the user's config file sets `color: true`.

### When to use each

**Flags:** Invocation-specific, transient, explicit. Use for: options that change per invocation (`--output`, `--count`, `--branch`). Scripts are auditable — anyone reading the script can see exactly what was passed. Flags are always the override mechanism — every config-file or env-var setting must be overridable by a flag.

**Environment variables:** Session-scoped, implicit, inherited. Use for: credentials (`MYAPP_TOKEN`, `MYAPP_API_KEY`), context settings (`MYAPP_REGION`, `MYAPP_PROFILE`), CI/CD integration (`MYAPP_NO_COLOR`, `MYAPP_DEBUG`). The pattern: prefix all env vars with the tool's name (`MYAPP_*`) to avoid collisions.

**Config files:** Persistent, project-specific or user-specific. Use for: defaults the user never wants to type again, project-level configuration. Support two levels:
- User-level: `~/.myapprc`, `~/.config/myapp/config.yaml` (XDG Base Directory on Linux)
- Project-level: `.myapp.yaml` or `.myapprc` in the project directory (overrides user-level)

**XDG Base Directory convention** (Linux): User config goes in `~/.config/<app>/` — `~/.myapprc` is tolerated but `~/.config/myapp/config.yaml` is the modern convention. On macOS: `~/Library/Application Support/<app>/`. On Windows: `%APPDATA%\<app>\`.

---

## Anti-patterns

Named failure modes specific to CLI design:

### A1: Exit code 0 on failure

A command that exits 0 when an operation fails silently breaks `set -e` and conditional logic. Scripts continue on failure. Pipeline results are corrupted. This is the most dangerous CLI failure mode because the error is invisible — the user sees apparent success while downstream data is wrong. **Source: clig.dev basics, named as non-negotiable.**

### A2: Error messages on stdout

Mixing diagnostic output into the primary data stream. A program that prints `Error: file not found` to stdout corrupts every pipeline it participates in. The next program receives the error text as if it were data. **Named anti-pattern, widespread in practice.**

### A3: Interactive hang in non-interactive context

A command that waits for user input when stdin is piped. Breaks CI pipelines (they time out), automated scripts (they stall), and any non-interactive use. The `cat` without arguments is the canonical example. Mitigation: detect `isatty(stdin)`, provide `--yes`/`--no-input` escapes. **Named anti-pattern from clig.dev.**

### A4: Color in non-TTY output

ANSI escape sequences in piped output or CI logs. Produces garbage characters in downstream text processing, breaks `grep` on the output, corrupts log files. Mitigation: detect `isatty(stdout)`, honor `NO_COLOR`. **Named anti-pattern, common in tools without automation testing.**

### A5: No quiet mode for scripting

A CLI that always prints human-readable output with decorations — progress bars, banners, summaries, table headers — with no way to suppress it. Scripts calling this CLI must parse around the decoration to get the value they need. **Named design failure.**

### A6: Positional argument ambiguity

Two or more positional arguments that serve different purposes without clear ordering convention. `tool foo bar` — what is `foo`? What is `bar`? Which is input, which is output? When in doubt, use named flags. **Named anti-pattern from clig.dev.**

### A7: Secrets accepted via flags

Accepting passwords or API tokens as flag values exposes them in shell history, `ps` output, and CI logs. **Security design constraint, not just implementation hygiene.**

### A8: Undiscoverable grammar

A subcommand hierarchy with inconsistent naming, no `--help` on subcommands, no tab completion, and no man page. The user must read source code or external documentation to discover what operations exist. **Named failure mode** — the opposite of progressive disclosure.

### A9: `--help` documenting a confusing interface

Using `--help` to explain a grammar that should be simplified. The right fix is restructuring the command, not writing more help text. When help text requires multiple paragraphs to explain how to invoke a single subcommand, the grammar is wrong. **Named anti-pattern** — help text is not a substitute for grammar clarity.

---

## AI-agent-specific adaptations

An AI design agent working on CLI design operates without the ability to run the CLI, observe users, or test pipeline compositions interactively.

### What an AI agent can evaluate from a specification

- **Grammar coherence:** Are subcommand names consistent? Do they follow a naming convention (verb-noun, action-first)? Are flags named per convention?
- **Exit code completeness:** Are all meaningful failure modes mapped to distinct exit codes? Is exit 0 reserved strictly for success?
- **Stream contract correctness:** Does the spec correctly route data to stdout and diagnostics to stderr? Are error messages specified to go to stderr?
- **Flag naming compliance:** Do flags follow GNU Coding Standards? Is `-h` reserved for help?
- **Help text completeness:** Does the design specify what `--help` shows? Does it include examples?
- **Composability signal:** Does the tool produce line-based output? Is `--json` specified? Is quiet mode specified?
- **Interactive vs non-interactive:** Does the spec define behavior when stdin is not a TTY? Are interactive prompts designed with flag-based escapes?

### What an AI agent cannot evaluate without runtime access

- Whether the tool actually honors its exit code contract (requires running it)
- Whether color is actually stripped in piped context (requires running it)
- Whether `isatty()` is called and correctly influences behavior (requires runtime)
- Whether interactive prompts actually hang in non-interactive context (requires a CI test)

### Adaptation: design artifacts as verification targets

When evaluating a CLI design, ask to see these as explicit design artifacts:
- **Exit code table:** Exhaustive list of exit codes, their meanings, and conditions
- **Stream contract spec:** Which output goes to stdout, which to stderr, by command
- **Help text draft:** The actual content of `--help`, not just "help will be provided"
- **Interactive/non-interactive behavior table:** What changes when stdin is not a TTY

These artifacts enable design evaluation without runtime access. When designing a new CLI, produce these as explicit outputs of the design process.

---

## Real-world reference tools

The following CLIs exemplify strong design decisions. Use as evidence, not prescription:

**`git`** — Verb-first grammar (`git commit`, `git push`, `git checkout`). Contextual help (`git help <command>`, `git <command> --help`, `man git-<command>` all work). Tab completion for branches, tags, remotes. Exit codes 0/1. Consistent flag naming across subcommands (though legacy inconsistencies exist in older commands). Error messages suggest fixes (`did you mean 'git commit'?`). **Design lesson:** Grammar is learnable when verbs are domain-specific and consistent.

**`gh` (GitHub CLI)** — Progressive disclosure: `gh` shows common subcommands; `gh --help` shows full list; `gh pr --help` shows PR-specific commands. `--json` with `--jq` for structured output piped directly to jq. Interactive mode when TTY, flag-based when not. Shell completion scripts for bash/zsh/fish/PowerShell. **Design lesson:** Well-designed help text is itself a composable element of the grammar.

**`kubectl`** — Verb-noun grammar (`kubectl get pods`, `kubectl apply -f`). Consistent across all resource types. `--output json/yaml/wide/name` for structured output. Exit code 1 for all errors (a weakness — no error differentiation). `--dry-run=client` for safe testing. Tab completion including live cluster resource names. **Design lesson:** A consistent grammar scales across hundreds of resource types.

**`rg` (ripgrep)** — Line-based output (just the matching lines, plain text). Color in TTY, no color in pipes. Exit codes 0 (match), 1 (no match), 2 (error) — exact match for `grep`'s convention. `--json` for structured match output. Quiet mode (`-q`). **Design lesson:** Exit code 1 meaning "no match" (not "error") is a design decision that enables `if rg pattern file; then ...` idiom.

**`docker`** — Early adopter of `--format` for template-based output. `--quiet` / `-q` for ID-only output (composable). Progress bars on stderr, not stdout. Interactive mode detection for `docker run`. **Design lesson:** Multiple output format options (`--format`, `--quiet`, `--json`) serve different automation needs.

---

## Design Spec output for CLI

When producing a Design Spec for a CLI, use the CLI-specific element adaptation from architecture §3:

| Generic element | CLI adaptation |
|---|---|
| View | Command (each top-level or subcommand) |
| Region | Output section (stdout structure, stderr structure) |
| Component | Flag/argument (with type, default, description) |
| State | Exit state (exit codes and their meaning) |
| Interaction | Command invocation (what happens when the command runs) |
| Focus behavior | Discoverability (how the user finds commands and options) |
| Layout constraint | Output format (human-readable vs machine-parseable, columnar alignment) |
| Visual semantics | Output styling (color usage, formatting conventions) |

A CLI Design Spec must include: command grammar (as explicit specification, not prose description), exit code table (all codes and their conditions), stream contracts (what goes to stdout vs stderr), help text structure (what `--help` shows for each command/subcommand), and error message patterns (specific language for common error conditions).

---

## References

- See `references/clig-dev-summary.md` for a structured summary of clig.dev conventions
- See `references/posix-exit-codes.md` for the normative POSIX exit code specification and extended conventions

---
