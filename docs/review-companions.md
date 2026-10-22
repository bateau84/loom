# Assessment and QA skill companions

Loom restores two read-only tools alongside its five Action/context/ledger tools.
They load different review instructions for the same installed skill. They do
not restore the old workflow engine.

| Tool | Required configured role | File returned |
| --- | --- | --- |
| `loom_assessment` | `assessment` | `ASSESSMENT.md` |
| `loom_qa` | `qa` | `QA.md` |

Both role IDs already existed in Loom's built-in role guidance. No new role,
agent, scheduler, approval stage or database schema is introduced.

## Configure the callers

Use actual native agent IDs in your existing private `.loom.yaml`:

```yaml
agents:
  reviewer:
    roles: [assessment]
  critic:
    roles: [qa]
```

These names are examples, not hard-coded identities. Any enabled native agent
mapped to `assessment` may use `loom_assessment`; any mapped to `qa` may use
`loom_qa`. An agent may have both roles. Keep its other roles when editing the
mapping. A role description or a Plan node's `roles` field does not assign a
role to the calling agent. Missing/disabled/wrong mappings deny the tool before
skill lookup. Configuration errors deny loading rather than trusting stale roles.
Changes are read on each invocation and checked again after native approval.
Instruction injection may be disabled without disabling an otherwise valid mapping.

## Load a lens

Call `loom_assessment` with:

```json
{"skill":"software-engineering"}
```

Call `loom_qa` with the same input to obtain the QA lens. In Code Mode, search for
the tool and use the exact callable path returned by search. Request `response_format:"json"` and parse its JSON text
once; the payload is under `result`.

Use an exact ID from OpenCode's current native skill registry. OpenCode 2.1.1
supports two local entry-file layouts, and Loom uses the selected native path:

- Directory skills: `<skill-id>/SKILL.md` — companions live beside `SKILL.md`.
- Flat skills: `<skill-id>.md` — companions live in the separate sibling
  directory `<skill-id>/ASSESSMENT.md` or `<skill-id>/QA.md`. A flat skill without
  that directory returns `available:false`, not an invalid-path error.

The separate folder for flat skills matters: their parent is a shared native
skill source and root-level `ASSESSMENT.md` or `QA.md` can be registered as
independent skills. Loom never borrows such a shared-root file for `opencode.md`
or another flat skill. Registry paths must match their native skill ID and use
one of these two forms, not an arbitrary Markdown file.

Native installation locations and precedence remain authoritative. Loom does
not fetch from GitHub, scan a hard-coded `~/.agents/skills` directory, bundle
engineering skills, or use caller-supplied paths. Symlinked installation
directories are supported; the companion must be a regular non-symlink file.
Loom's bundled `loom` skill uses `SKILL.md` and currently ships no Assessment or
QA companion; both tools report `available:false` for that skill.

The tool returns `skill`, `methodology`, `available`, and the resolved `path`.
An available companion also includes full UTF-8 `content` and `sha256` of the
source bytes. Files are reread, not cached. A missing companion reports
`available:false` with `reason:companion-not-found`, without content or a digest.
An unknown skill, invalid registry path, permission rejection, unreadable file,
nonregular file, invalid UTF-8, changed file during reading, or file larger than
64 KiB fails visibly. No partial/truncated lens or `SKILL.md` fallback is returned.

## Permissions and review meaning

The loader calls OpenCode's native `permission.assert` with action `skill`, the
selected skill ID, and the actual calling Session/agent/tool source. Native
allow/ask/deny behavior is preserved. It does not install permission hooks,
override rules, or turn a role into permission to use other native tools.
The location and role checks apply only to these companion loaders; this is
not a general filesystem sandbox or a claim that other allowed read tools are
blocked from reading the same files.

Assessment checks conformance and domain obligations. QA challenges hidden
failures, shared assumptions and false confidence after competent work/review.
Choose skills from the work and its risks independently of the producer's list.
Load practitioner guidance natively when useful; no prior load receipt is required.
No Action or Plan is required. Loading a file is not performing a review, proving
independence, completing a task, or producing a verdict. Record actual findings
separately with `loom_record` using `kind:assessment` or `kind:qa`.
Without an Action/selection, these verdicts are stored under the calling
Session. If the Session has another Action selected, add `"session_only":true`
to avoid attaching the review to that Action. Use `loom_context` with
`{"mode":"independent"}` to request an independent view even when no Action
exists. It does not erase prior conversation or prove reviewer independence.
Read the caller's Session records with `loom_record` operation `query` and
`session_only:true` (or `full_thread` with an explicit `session_id`).

## Verification

`bun test tests/review-companions-native.test.ts` exercises the public plugin's
registered tools, the real configuration loader, and real temporary files with a
simulated native registration/permission host. It covers separate lenses and
hashes, role checks and reloads, permission rejection/revocation, missing and
changed companions, unsafe inputs, symlinked installs, bounded file reads,
cancellation, and absence of Action/Plan/dispatch side effects.

`bun run typecheck`, `bun run test:core`, `bun run test:native`, and the existing
Code Mode search CI check validate the integration. A simulated permission
assertion test is not a live-host permission test or proof of independent review.
