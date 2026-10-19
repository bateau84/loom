import { test } from 'node:test'
import assert from 'node:assert/strict'
import { constants } from 'node:fs'
import { open, mkdtemp, writeFile, appendFile, rename, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import * as config from '../.test-build/config.js'
const MAX = 65536
const parse = JSON.parse
async function fixture(t, contents = '{}') {
  const dir = await mkdtemp(join(tmpdir(), 'loom-config-source-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, '.loom.yaml')
  await writeFile(path, contents)
  return { dir, path }
}
function disabled(value, pattern) {
  assert.equal(value.config.instructions.enabled, false)
  assert.equal(value.config.ledger.capture, 'off')
  assert.deepEqual(value.config.agents, {})
  assert.equal(value.errors.length, 1)
  assert.match(value.errors[0], pattern)
}
function trace() {
  const state = { opened: 0, closed: 0, transferred: 0, reads: [], buffers: new Set() }
  const opener = async (path, flags) => {
    state.opened++
    assert.equal(flags & constants.O_NONBLOCK, constants.O_NONBLOCK)
    const file = await open(path, flags)
    return {
      stat: options => file.stat(options),
      read: async (buffer, offset, length, position) => {
        state.buffers.add(buffer)
        const value = await file.read(buffer, offset, length, position)
        state.reads.push({ offset, length, position, capacity: buffer.length })
        state.transferred += value.bytesRead
        return value
      },
      close: async () => { state.closed++; await file.close() },
    }
  }
  return { state, opener }
}

test('a complete exact 64 KiB source reaches the decoder unchanged', async t => {
  const text = '{}' + ' '.repeat(MAX - 2), { path } = await fixture(t, text), { state, opener } = trace()
  let decoded
  const value = await config.loadConfig([path], source => { decoded = source; return parse(source) }, opener)
  assert.deepEqual(value.errors, []); assert.equal(decoded, text)
  assert.equal(state.transferred, MAX); assert.equal(state.closed, 1)
  assert.equal(state.buffers.size, 1); assert.equal(state.reads[0].capacity, MAX + 1)
})
test('65,537-byte files fail before decoding and still close their descriptor', async t => {
  const { path } = await fixture(t, '{}' + ' '.repeat(MAX - 1)), { state, opener } = trace()
  let called = false
  disabled(await config.loadConfig([path], () => { called = true }, opener), /64 KiB/)
  assert.equal(called, false); assert.equal(state.transferred, 0); assert.equal(state.closed, 1)
})
test('growth after the opened-file size check cannot cause an unbounded read', async t => {
  const { path } = await fixture(t), { state, opener } = trace()
  let changed = false, decoded = false
  const growing = async (...args) => {
    const handle = await opener(...args)
    return { ...handle, stat: async options => {
      const info = await handle.stat(options)
      if (!changed) { changed = true; await appendFile(path, ' '.repeat(2 * 1024 * 1024)) }
      return info
    } }
  }
  disabled(await config.loadConfig([path], () => { decoded = true }, growing), /64 KiB/)
  assert.equal(decoded, false); assert.equal(state.transferred, MAX + 1); assert.equal(state.buffers.size, 1)
  assert.equal(state.closed, 1)
})
test('truncation during the read is an error rather than a valid prefix configuration', async t => {
  const { path } = await fixture(t, '{"agents":{"original":{"roles":["qa"]}}}'), { opener } = trace()
  let changed = false
  const truncating = async (...args) => {
    const handle = await opener(...args)
    return { ...handle, read: async (...params) => {
      if (!changed) { changed = true; await writeFile(path, '{}') }
      return handle.read(...params)
    } }
  }
  disabled(await config.loadConfig([path], parse, truncating), /changed while being read/)
})
test('changed timestamps on a same-size edit are rejected before decoding', async t => {
  const { path } = await fixture(t), { state, opener } = trace()
  let decoded = false
  const edited = async (...args) => {
    const handle = await opener(...args); let stats = 0
    return { ...handle, stat: async options => {
      const info = await handle.stat(options)
      if (++stats === 2) info.mtimeNs += 1n
      return info
    } }
  }
  disabled(await config.loadConfig([path], () => { decoded = true }, edited), /changed while being read/)
  assert.equal(decoded, false); assert.equal(state.closed, 1)
})
test('short reads advance explicit positions and assemble one complete UTF-8 source', async t => {
  const text = JSON.stringify({ agents: { analyst: { description: 'Æøå🙂'.repeat(4), roles: ['qa'] } } })
  const { path } = await fixture(t, text), { state, opener } = trace()
  const short = async (...args) => {
    const handle = await opener(...args)
    return { ...handle, read: (buffer, offset, length, position) => handle.read(buffer, offset, Math.min(length, 7), position) }
  }
  const value = await config.loadConfig([path], parse, short)
  assert.deepEqual(value.errors, []); assert.equal(value.config.agents.analyst.description, 'Æøå🙂'.repeat(4))
  for (const read of state.reads) assert.equal(read.offset, read.position)
  assert.equal(state.transferred, Buffer.byteLength(text)); assert.ok(state.reads.length > 2)
})
test('repeated tiny reads stop at the operation cap without decoding a prefix', async t => {
  const { path } = await fixture(t, '{}' + ' '.repeat(200)), { state, opener } = trace()
  let decoded = false
  const short = async (...args) => {
    const handle = await opener(...args)
    return { ...handle, read: (buffer, offset, _length, position) => handle.read(buffer, offset, 1, position) }
  }
  disabled(await config.loadConfig([path], () => { decoded = true }, short), /read-operation limit/)
  assert.equal(state.reads.length, 64); assert.equal(state.transferred, 64)
  assert.equal(state.closed, 1); assert.equal(decoded, false)
})
test('UTF-8 byte size is checked independently of character length', async t => {
  const source = JSON.stringify({ unused: 'é'.repeat(33000) }), { path } = await fixture(t, source)
  assert.ok(source.length < MAX); assert.ok(Buffer.byteLength(source) > MAX)
  disabled(await config.loadConfig([path], parse), /64 KiB/)
})
for (const bytes of [Buffer.from([0xc0, 0xaf]), Buffer.from([0xe2, 0x82]), Buffer.from([0xff])]) test(`invalid UTF-8 ${bytes.toString('hex')} is rejected, not replaced`, async t => {
  const { path } = await fixture(t, bytes), { state, opener } = trace(); let decoded = false
  disabled(await config.loadConfig([path], () => { decoded = true }, opener), /valid UTF-8/)
  assert.equal(decoded, false); assert.equal(state.closed, 1)
})
test('UTF-8 BOM, empty files and missing layers retain useful behavior', async t => {
  const { dir, path } = await fixture(t, '\ufeff{}')
  assert.deepEqual((await config.loadConfig([path], parse)).errors, [])
  await writeFile(path, '')
  assert.equal(await config.readConfigSource(path), '')
  assert.equal(await config.readConfigSource(join(dir, 'missing')), undefined)
  assert.deepEqual(await config.loadConfig([], parse), { config: config.defaults(), sources: [], errors: [] })
})
test('regular-file symlinks remain supported', async t => {
  const { dir, path } = await fixture(t, '{"agents":{"external":{"roles":["research"]}}}')
  const alias = join(dir, 'alias.yaml'); await symlink(path, alias)
  const value = await config.loadConfig([alias], parse)
  assert.deepEqual(value.errors, []); assert.deepEqual(value.config.agents.external.roles, ['research'])
})
test('an opened descriptor is not replaced by a second pathname read', async t => {
  const { dir, path } = await fixture(t, '{"version":1}'), { state, opener } = trace()
  const replacement = async (...args) => {
    const handle = await opener(...args)
    await rename(path, join(dir, 'old.yaml')); await writeFile(path, 'x'.repeat(2 * MAX))
    return handle
  }
  assert.equal(await config.readConfigSource(path, replacement), '{"version":1}')
  assert.equal(state.opened, 1); assert.equal(state.closed, 1)
})
test('directory input is rejected and its opened descriptor is closed', async t => {
  const { dir } = await fixture(t), { state, opener } = trace()
  disabled(await config.loadConfig([dir], parse, opener), /regular file|EISDIR/)
  assert.equal(state.closed, 1)
})
test('a FIFO with no writer cannot stall configuration loading', async t => {
  const { dir } = await fixture(t), path = join(dir, 'pipe.yaml')
  const mkfifo = spawnSync('mkfifo', [path], { encoding: 'utf8' })
  assert.equal(mkfifo.status, 0, mkfifo.stderr)
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import {loadConfig} from ${JSON.stringify(new URL('../.test-build/config.js', import.meta.url).href)};
    const value=await loadConfig([${JSON.stringify(path)}], JSON.parse);
    console.log(JSON.stringify(value));
  `], { encoding: 'utf8', timeout: 3000 })
  assert.equal(result.status, 0, result.stderr || String(result.error))
  disabled(JSON.parse(result.stdout), /regular file/)
})
for (const failing of ['stat', 'read', 'close']) test(`${failing} errors close the descriptor and do not publish partial configuration`, async t => {
  const { path } = await fixture(t), { state, opener } = trace()
  const broken = async (...args) => {
    const handle = await opener(...args)
    return { ...handle, [failing]: async (...params) => {
      if (failing === 'close') await handle.close()
      throw new Error(`injected ${failing} failure`)
    } }
  }
  disabled(await config.loadConfig([path], parse, broken), new RegExp(`injected ${failing} failure`))
  assert.equal(state.closed, 1)
})
test('a failed open other than ENOENT remains visible', async () => {
  disabled(await config.loadConfig(['/x'], parse, async () => { throw Object.assign(new Error('permission denied'), { code: 'EACCES' }) }), /permission denied/)
})
test('ENOENT after opening is an error, not a missing optional layer', async t => {
  const { path } = await fixture(t), { state, opener } = trace()
  const missingRead = async (...args) => {
    const handle = await opener(...args)
    return { ...handle, read: async () => { throw Object.assign(new Error('opened file read failed'), { code: 'ENOENT' }) } }
  }
  disabled(await config.loadConfig([path], parse, missingRead), /opened file read failed/)
  assert.equal(state.closed, 1)
})
test('decoder errors tagged ENOENT cannot be silently ignored', async t => {
  const { path } = await fixture(t), { state, opener } = trace()
  disabled(await config.loadConfig([path], () => { throw Object.assign(new Error('decoder failed'), { code: 'ENOENT' }) }, opener), /decoder failed/)
  assert.equal(state.closed, 1)
})
test('decoding starts after the descriptor has closed', async t => {
  const { path } = await fixture(t), { state, opener } = trace()
  const value = await config.loadConfig([path], source => { assert.equal(state.closed, 1); return parse(source) }, opener)
  assert.deepEqual(value.errors, [])
})
test('three-layer precedence, explicit removals and hot reload remain unchanged', async t => {
  const { dir, path } = await fixture(t, '{"agents":{"a":{"roles":["research"],"description":"original"},"b":{"roles":["qa"]}}}')
  const project = join(dir, 'project.yaml'), local = join(dir, 'local.yaml')
  await writeFile(project, '{"agents":{"a":{"roles":["implementation"]}}}')
  await writeFile(local, '{"agents":{"b":null}}')
  const paths = [path, project, local], value = await config.loadConfig(paths, parse)
  assert.deepEqual(value.errors, []); assert.deepEqual(value.sources, paths)
  assert.deepEqual(value.config.agents.a, { roles: ['implementation'], description: 'original', enabled: true })
  assert.equal(value.config.agents.b, undefined)
  await writeFile(local, 'invalid')
  disabled(await config.loadConfig(paths, parse), /local.yaml/)
  await writeFile(local, '{"agents":{"a":{"roles":["qa"]}}}')
  assert.deepEqual((await config.loadConfig(paths, parse)).config.agents.a.roles, ['qa'])
})
test('more than three layers causes no reads or decoding', async () => {
  let opened = false, decoded = false
  disabled(await config.loadConfig(['a','b','c','d'], () => { decoded = true }, async () => { opened = true; throw new Error('must not open') }), /three configuration layers/)
  assert.equal(opened, false); assert.equal(decoded, false)
})
test('malformed short-read result is rejected rather than changing the offset', async t => {
  const { path } = await fixture(t), { state, opener } = trace()
  const broken = async (...args) => {
    const handle = await opener(...args)
    return { ...handle, read: async () => ({ bytesRead: -1 }) }
  }
  disabled(await config.loadConfig([path], parse, broken), /Invalid configuration read result/)
  assert.equal(state.closed, 1)
})
