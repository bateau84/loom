---
type: Configuration
title: "Configuration input: bounded reads, explicit decoder boundary"
description: "Explains bounded configuration reads, file limits and error handling."
tags: [loom, configuration, resource-safety]
timestamp: 2026-10-24T00:00:00Z
---

# Configuration input: bounded reads, explicit decoder boundary

The file-read contract below was introduced in `3881ece` after `3a8fc97` and
remains in force. **Production decoding now uses the construction-bounded parser
in [Configuration decoding](configuration-parser.md).** The Bun allocation audit
below describes the replaced decoder, not the current production callback.
Neither change claims an exact heap quota or closes all of finding E.

## What the file reader enforces

`readConfigSource()` opens one descriptor and validates the opened object, rather
than inspecting a path and then opening it again through `readFile()`.

- At most **65,536 source bytes per file**, with one additional sentinel byte
  permitted only to detect overflow. It allocates one fixed 65,537-byte buffer.
- At most **64 positional reads per opened file**. Short reads advance the
  position. Exhaustion is an error, not permission to decode a prefix.
- At most **three configuration layers per load**; more layers cause no I/O or
  decoding. Reads are sequential. These limits are per load, not an aggregate
  limit across simultaneous host requests.
- Only regular files, including symlinks to regular files, are accepted.
  Nonblocking open prevents a FIFO with no writer from holding the loader before
  the regular-file check. This is not a deadline for filesystem I/O.
- The opened file's size, nanosecond modification/change times, and actual byte
  count are checked again after EOF. Observed concurrent edits fail visibly.
  Atomic replacement is read through the already opened descriptor; it cannot
  redirect a subsequent pathname read to a larger file.
- UTF-8 is decoded only after complete admission. Invalid byte sequences fail
  rather than producing replacement characters in instructions or agent names.
  A leading UTF-8 BOM is accepted and removed by the text decoder.
- Closing is attempted on every exit after opening, including overflow and
  read/stat/decode failure. YAML is invoked only after close succeeds; a close
  failure prevents admission rather than being ignored.

Only ENOENT from **opening** a layer is treated as optional absence. A later
read/stat/close error or a decoder error carrying that code is still an error.
Any layer error retains the existing fail-closed configuration behavior: no
partial or stale roles are applied; automatic instruction injection and new
capture are disabled, diagnostics remain available, and native work is not gated.
A later call rereads the corrected files without a background watcher.

The timestamp checks detect observed changes; they are not an atomic filesystem
snapshot, protection from malicious timestamp restoration, or a lease against
later edits. A successful load can become outdated immediately afterward. No
cross-file atomic version is promised. Config writers should use atomic file
replacement when possible; an observed-change error is recoverable on the next
load. Startup disk latency, OS failures and hostile same-process code are not
bounded by counting bytes and read calls.

## Reproduced source-growth counterexample

A controlled local probe used real Node filesystem operations. It appended
2 MiB after the original `stat()` returned its small-file metadata, before the
original loader called `readFile()`.

| Reader | Bytes returned by the read path before rejection |
| --- | ---: |
| Original `3a8fc97` | 2,097,154 |
| New reader, same growth ordering | 65,537 |

Both report an oversized file; the difference is that the new reader does not
allocate/read the entire growing file first. The regression forwards actual
file operations and controls interleaving only. It also checks that the decoder
is not called and that the descriptor closes. This is a byte-transfer result,
not a peak-RSS or wall-clock measurement.

## Historical YAML allocation audit at `3881ece`

The production callback at that revision was `YAML.parse(source)` from Bun.
The pinned **Bun 1.4.2** implementation was inspected, rather than inferred from
a few RSS samples:

- Its parse entry calls the native parser with an arena, source and cyclic-alias
  policy. The exposed call path has **no caller-supplied heap, node or elapsed-time
  allowance**.
- The native parser produces an expression graph before JavaScript schema
  validation runs. Its runtime conversion tracks collection pointer identity;
  arrays/objects are registered before children are converted, so aliases reuse
  those collections and cycles do not force recursive tree copying.
- Conversion has a stack-safety check and allocation-error paths. These are
  engine protections, **not a Loom-controlled allocation budget**.

Sources: [pinned parse entry and conversion](https://github.com/oven-sh/bun/blob/bun-v1.4.2/src/runtime/api/YAMLObject.rs#L1018-L1228),
[pinned parser entry](https://github.com/oven-sh/bun/blob/bun-v1.4.2/src/parsers/yaml.rs#L24-L82),
[public YAML API](https://bun.com/docs/runtime/yaml), and
[Node file-handle reads](https://nodejs.org/download/release/v22.16.0/docs/api/fs.html#filehandlereadbuffer-offset-length-position).

The source-byte limit alone does not bound that native arena, scalar conversions,
temporary buffers, resulting graph, cumulative allocations or parsing time.
Post-decoding shape checks cannot undo those earlier allocations. The existing
five-fixture Bun characterization remains evidence about those examples, not a
proof for every admitted input. Tests that intentionally pass Bun's decoder to
the generic reader remain compatibility/reference tests, not tests of production
parser limits.

The replacement [decoder-level policy](configuration-parser.md) applies explicit
limits during construction while retaining tested alias, quote and multiline
semantics. It does not impose a heuristic syntax ban or move parsing to another
process. Its dependency and structural limits are documented separately from
this unchanged file-reader contract.

## Verification and remaining operating policy

`tests/config-source.test.mjs` covers exact/over-limit files, growth after fstat,
truncation, observed same-size edits, short reads, operation exhaustion, byte vs
character size, invalid UTF-8, BOM, empty/missing files, symlinks, pathname
replacement, directories, a FIFO without a writer, failures/cleanup, error
classification, layer limits and ordinary precedence/reload behavior. The original
local run used Node 22.16.0 and strict TypeScript 5.8.3 compilation of the
configuration module. Growth and short-read probes forward real filesystem
operations; separate fault probes inject failures or changed timestamp metadata.

`tests/config-source-native.test.ts` retains real Bun filesystem/YAML checks for
aliases and multiline text, exact byte admission, growth, invalid UTF-8, cyclic
schema rejection and a corrected-file reload. Its deep-input check deliberately
shows that the old Bun callback decodes before schema rejection. Current parser
construction and differential tests live in the `config-parser` suites. Use
`bun run test`, not bare `bun test`, so Node-only suites keep their prerequisites.

Full committed-head CI results must be recorded separately from local checks.
No formal independent review or installed two-agent acceptance is supplied by
these tests. The existing host smoke test remains boot/empty-ledger evidence.

Startup/index-build cost and on-disk retention still require an explicit operating
policy. No automatic deletion or pruning is introduced. Preserved oversized
records may remain unreadable through normal tools; tested backup/export/restore
is separate release work. Main plugin CI now checks a frozen lockfile; separate
host installation reproducibility, meaningful-record Research-to-Worker resumption
and combined independent review remain open.
