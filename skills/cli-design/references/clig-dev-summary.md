# clig.dev — Key Design Rules Summary

Source: Command Line Interface Guidelines (clig.dev), 2021. Authors: Aanand Prasad, Ben Firshman, Carl Tashian, Eva Parish. Open-source, community-vetted. Verified live 2026-09-02.

This summary captures the non-negotiable rules and high-signal design guidance. The full document at clig.dev is the authoritative source.

---

## Non-negotiable rules (stated as absolutes in clig.dev)

1. **Return zero exit code on success, non-zero on failure.** No exceptions.
2. **Send output to stdout. Send messaging to stderr.** Every diagnostic, error, warning, and progress message goes to stderr.
3. **Only use prompts or interactive elements if stdin is an interactive terminal (a TTY).** Never hang waiting for input when stdin is piped.
4. **Use `--help` / `-h` for help.** Do NOT reassign `-h` to another purpose.
5. **Output should be machine-parseable by default when piped.** Detect TTY and format differently for humans vs machines.

---

## Flag convention table

These are established conventions that users bring as prior expectations. Deviation requires specific cause.

| Short | Long | Meaning |
|---|---|---|
| `-a` | `--all` | Show all |
| `-d` | `--debug` | Debug output |
| `-f` | `--force` | Force without confirmation |
| — | `--json` | JSON structured output |
| `-h` | `--help` | Help (never reassign) |
| `-n` | `--dry-run` | Simulate without acting |
| `-o` | `--output` | Output file |
| `-p` | `--port` | Port number |
| `-q` | `--quiet` | Suppress non-essential output |
| `-v` | `--verbose` | Verbose (also `--version` — avoid conflict) |
| — | `--version` | Version information |
| — | `--no-color` | Disable color |

---

## Named failure modes (clig.dev)

- **Positional argument ambiguity:** Two positional arguments serving different purposes. "If you've got two or more arguments for different things, you're probably doing something wrong."
- **Secrets in flags:** "Don't store secrets in environment variables or flags — use files." Flag values appear in shell history and `ps` output.
- **Prompting when not interactive:** Any prompt or interactive element when stdin is not a TTY hangs automation.
- **Unreadable error messages:** Raw exception output instead of human-rewritten errors with actionable guidance.

---

## Grammar design guidance

- Use subcommands when the tool has "a natural grouping of things to do with a noun"
- Prefer flags over positional arguments — "they're self-documenting"
- Exception: source → destination pairs (`cp <src> <dst>`) are established enough to keep
- Keep subcommand grammar consistent: if some subcommands use `--output`, all should use `--output`, not mix with `-o` only

---

## Help text content contract

Every `--help` must include:
1. Tool/command description (one sentence)
2. Usage syntax
3. All flags with descriptions and defaults
4. At least one example
5. Pointer to further documentation

Order flags by frequency, not alphabetically. Most-used flags first.

---

## Unix philosophy applied (attributed to Doug McIlroy)

"Expect the output of every program to become the input to another, as yet unknown, program."

Practical implication: every output format decision is a decision about future composability. Clean stdout, stable exit codes, and `--json` support are the composability contract.
