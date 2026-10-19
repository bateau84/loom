# Configuration decoding: limits during construction

Follow-up to `3881ece` and finding E. The production plugin now passes
`decodeConfigYaml` to the existing bounded file reader. The reader, role schema,
layer precedence and error policy are unchanged. The decoder uses exactly
`js-yaml@4.3.2`, not `Bun.YAML.parse` and not a native fallback.

## Enforceable boundary

The pinned loader invokes its `open` listener before composing the next node.
Loom counts every attempt, including speculative parsing, and throws before
that attempt proceeds when its allowance is exhausted. The callback is inside
the parser, not a walk over an already completed document. No separate process,
worker, background service or restricted YAML pre-parser is introduced.

| Per-decode allowance | Limit | Enforcement point |
| --- | ---: | --- |
| UTF-8 source | 65,536 bytes | Before entering the parser; also enforced by the file reader |
| Node composition attempts | 8,192 | The parser's pre-composition callback |
| Active parser frames | 32 | The same callback, before descending farther |
| Array item inspections | 16,384 | During collection construction, before possible key conversion |
| One flat-array key's estimated text | 65,536 characters | Before the loader can join it into a mapping-key string |
| Cumulative possible array conversions | 1,048,576 characters | Charged on every array occurrence, including aliases |

Depth means parser frames, not simply bracket nesting. The pinned parser may
speculatively compose a mapping inside another collection. The exact regression
accepts 30 nested flow arrays around a scalar and rejects 31. Budgets are not
refunded when the parser backtracks. They reset for a new decode call.

Aliases reuse their target objects rather than recursively copying a tree.
The adapter never stringifies the decoded graph to measure it. A bounded weak
identity cache avoids re-inspecting unchanged arrays. It does not exempt aliases
from cumulative key-conversion accounting: repeatedly joining the same long
array must not multiply work without being charged. Partially constructed cyclic
arrays can change length; those are rechecked and charged to the inspection cap.
Nested array keys are rejected by the pinned loader before conversion. Other
object keys use its fixed representation rather than arbitrary object methods.

The array checks run after that bounded array has been constructed but **before
its later key-string conversion**. They do not claim to prevent its earlier
child allocations; the pre-composition limits govern that stage. The cumulative
allowance conservatively charges arrays even when they are values, since the
listener does not independently decide whether a node will become a key.

## What this is not

These are source and structural-work limits, **not an exact heap-byte quota**.
Input normalization, scalar strings, parser state, object overhead, garbage
collection and engine bookkeeping still allocate memory. The bounded source is
already a JavaScript string on entry. No fixed peak-RSS, elapsed-time deadline,
OS memory ceiling, aggregate simultaneous-request cap or hostile same-process
code containment is claimed. Startup/index construction and retention remain
separate operating-policy work.

The dependency's version and listener behavior are part of the implementation
contract. The manifest pins 4.3.2; the adapter checks the loaded version; tests
exercise the actual parser. Upgrading it requires rechecking callback order,
scalar/key conversion and compatibility, not just changing a version range.

## Compatibility and failure

The adapter uses the YAML core scalar schema and last-key-wins duplicate handling.
The differential Bun suite compares complete merged configurations for ordinary
mapping/sequence/scalar aliases, single and double quotes, escapes and Unicode,
literal and folded multiline instructions, CRLF, core tags, a YAML 1.2 directive,
marker-looking text inside strings, ordinary non-boolean words, dates as text,
duplicate keys and the published example. No textual ban on `&`, `*`, brackets
or quotes is used. Collection aliases retain identity; cyclic shapes remain
subject to the existing schema rejection.

Both 200 explicitly written agents with 20 roles and 200 agents sharing a long
role-list alias are tested. Finite complexity admission is new: unusually deep,
wide or conversion-heavy YAML can now fail before schema validation. This is
not a proof of complete equivalence for every Bun-specific YAML dialect corner.
Do not silently broaden accepted tag constructors or fall back to an unbounded
decoder to resolve a compatibility report.

Limit errors have code `LOOM_CONFIG_PARSE_LIMIT` and name the exhausted boundary.
The existing loader turns any layer error into disabled instruction injection
and new automatic capture, not partial role configuration. Native work remains
usable. Correcting the file permits a later load. Syntax errors retain a short
reason without the parser's surrounding source snippet; this is not a general
secret-redaction service.

## Verification and dependency lock

The core tests cover rejection while parsing, not just final graph size. Deep
and wide inputs contain malformed suffixes that must never be reached; the
reported parser positions and attempt counts demonstrate earlier termination.
Other tests cover source-byte admission, shared and cyclic aliases, key-conversion
amplification, budget reset, errors, layer failure and corrected reload.

The first parser commit passed the existing suites plus 19 new core and 15 Bun
checks in CI. Five further exact-boundary/alias tests were added before finalizing.
The repeated-key probe initially failed the new expected bound; cumulative
conversion accounting corrected it. Locally, all 24 parser tests passed with
Node 22.16.0 and the actual installed 4.3.2 package obtained from CI. Full SDK/Bun
results must be reported for the final committed head separately.

The committed lock adds only the root `js-yaml` declaration and resolved entries
for `js-yaml@4.3.2` and its CLI dependency `argparse@2.0.1`. Existing resolutions
are unchanged. The lock was generated by Bun 1.4.2 and compared with the preceding
committed lock; its Git blob is `359f18dc7a066a3b848797b214649d93b8c011fa`.
Main plugin CI now verifies a frozen install and unchanged lock. The separately
installed OpenCode host and its dependency graph still need their own release
reproducibility work. Temporary dependency-audit artifact steps were removed.

Independent review of this parser boundary and the combined plugin remains open.
The installed-host boot probe is not the meaningful-record Research-to-Worker,
task-removal, explicit-recovery and fresh-session acceptance scenario. No model
inference, independent review verdict or two-agent acceptance is supplied here.
No orchestration, schema, permissions or tools are added by this change.

## Audited primary sources

- [Pinned js-yaml options and core schema](https://github.com/nodeca/js-yaml/blob/4.3.2/README.md)
- [Pinned loader: composition listener, aliases and mapping-key handling](https://github.com/nodeca/js-yaml/blob/4.3.2/lib/loader.js)
- [Earlier Bun decoder audit and current file-read contract](configuration-limits.md)
- [Remaining general processing boundary](processing-limits.md)
