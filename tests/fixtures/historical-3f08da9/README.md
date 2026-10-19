# Frozen historical database writer

`store.ts`, `collaboration.ts` and `model.ts` are byte-for-byte copies of
`src/` at Loom commit **3f08da989c6c64aa94f797732201441119f88180**
(`feat: persist exact assignments and atomic answer delivery intent`, authored
by Mats Bøe Bergmann, 2026-10-16). `provenance.json` records each original path,
Git blob ID and SHA-256. All original source comments are retained. That commit
contains no separate license, copying or notice file; none has been invented
for this same-repository fixture.

These three modules are the complete local import closure of the old Store;
their only other imports are Node built-ins. No old plugin, host, dependencies,
database binary or unrelated history is vendored. Do not modernize these files
or redirect their imports to current `src/`.

The historical case in `tests/primary-sender-native.test.ts` verifies the hashes
before importing this writer. It creates a fresh private database through the
old Store's create/plan/assign/ask/answer operations, checks its version-1 schema
(including the absence of `primary_deliveries`) and false automatic-consent
intent **before** current Store initialization. It then checks that upgrade and
later authorization preserve the old intent's text and SQLite BLOB bytes,
without projection rows or host I/O. Tests need neither Git nor repository
history, including in depth-one checkouts and source archives.

## Reproduce provenance (maintainer-only, full source history required)

From the repository root:

```sh
python3 - <<'PY'
import hashlib, json, pathlib, subprocess
root = pathlib.Path('tests/fixtures/historical-3f08da9')
manifest = json.loads((root / 'provenance.json').read_text())
for entry in manifest['files']:
    source = subprocess.check_output(['git', 'show', manifest['commit'] + ':' + entry['source']])
    frozen = (root / entry['path']).read_bytes()
    assert frozen == source, entry['path']
    assert hashlib.sha256(frozen).hexdigest() == entry['sha256'], entry['path']
    blob = b'blob ' + str(len(frozen)).encode() + b'\0' + frozen
    assert hashlib.sha1(blob).hexdigest() == entry['git_blob'], entry['path']
    print(entry['path'], 'source bytes, SHA-256 and Git blob verified')
PY
```

This optional audit command is not test setup and must never run during tests.
Changing the historical baseline requires an explicit fixture/provenance review,
not regenerating this fixture from current source or weakening its assertions.
