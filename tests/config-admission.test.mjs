import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getEventListeners } from 'node:events'
import { mkdtemp, writeFile, rm, copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { loadConfig } from '../.test-build/config.js'
import { admitConfigLoad, configLoadStatus } from '../.test-build/config-admission.js'

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const tick = () => new Promise(r => setImmediate(r))
async function idle() {
  for (let i = 0; i < 20 && configLoadStatus().active; i++) await tick()
  assert.equal(configLoadStatus().active, 0)
  assert.equal(configLoadStatus().waiting, 0)
}
function memoryFile(text = '{}', overrides = {}) {
  const bytes = Buffer.from(text)
  return {
    stat: async () => ({ size: BigInt(bytes.length), mtimeNs: 0n, ctimeNs: 0n, isFile: () => true }),
    read: async (buffer, offset, length, position) => {
      const n = Math.min(length, bytes.length - position)
      if (n) bytes.copy(buffer, offset, position, position + n)
      return { bytesRead: n }
    },
    close: async () => {}, ...overrides,
  }
}
function blocked(t, signal) {
  const entered = deferred(), release = deferred(); let opens = 0, closes = 0
  const promise = loadConfig(['blocked'], JSON.parse, async () => {
    opens++; entered.resolve(); await release.promise
    return memoryFile('{}', { close: async () => { closes++ } })
  }, signal)
  t.after(async () => { release.resolve(); await promise; await idle() })
  return { promise, entered: entered.promise, release: release.resolve, opens: () => opens, closes: () => closes }
}
function failed(snapshot, code) {
  assert.equal(snapshot.config.instructions.enabled, false)
  assert.equal(snapshot.config.ledger.capture, 'off')
  assert.deepEqual(snapshot.config.agents, {})
  assert.match(snapshot.errors.join('\n'), new RegExp(code))
}

// All gates are explicit promises, not sleeps or assumed filesystem timings.
test('one active and eight waiting are admitted; the ninth waiter fails without I/O', async t => {
  const first = blocked(t); await first.entered
  let opened = 0, decoded = 0
  const pending = []
  for (let n = 0; n < 7; n++) pending.push(loadConfig(['later'], s => { decoded++; return JSON.parse(s) }, async () => { opened++; return memoryFile() }))
  assert.equal(configLoadStatus().waiting, 7)
  pending.push(loadConfig(['eighth'], JSON.parse, async () => { opened++; return memoryFile() }))
  assert.equal(configLoadStatus().waiting, 8)
  const refused = await loadConfig(['ninth'], () => { throw new Error('must not decode') }, async () => { throw new Error('must not open') })
  failed(refused, 'LOOM_CONFIG_LOAD_OVERFLOW'); assert.deepEqual(refused.sources, [])
  assert.equal(opened, 0); assert.equal(decoded, 0)
  first.release(); await first.promise; await Promise.all(pending)
  assert.equal(opened, 8); assert.equal(decoded, 7); await idle()
})

test('FIFO admission does not allow a just-resolved caller to overtake waiting work', async t => {
  const first = blocked(t); await first.entered; const order = []
  const waiting = [1, 2, 3].map(n => loadConfig([String(n)], JSON.parse, async () => { order.push(n); return memoryFile() }))
  const overtaker = first.promise.then(() => loadConfig(['4'], JSON.parse, async () => { order.push(4); return memoryFile() }))
  first.release(); await Promise.all([...waiting, overtaker]); assert.deepEqual(order, [1, 2, 3, 4])
})

test('cancelled waiter releases waiting capacity immediately and is never opened', async t => {
  const first = blocked(t); await first.entered; let opened = false
  const controller = new AbortController()
  const cancelled = loadConfig(['never'], JSON.parse, async () => { opened = true; return memoryFile() }, controller.signal)
  assert.equal(configLoadStatus().waiting, 1)
  controller.abort('a private caller reason that must not be logged')
  failed(await cancelled, 'LOOM_CONFIG_LOAD_CANCELLED')
  assert.equal(configLoadStatus().waiting, 0); assert.equal(opened, false)
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
  first.release(); await first.promise
})

test('already cancelled caller takes no slot even when the queue is full', async t => {
  const first = blocked(t); await first.entered
  const pending = Array.from({ length: 8 }, () => loadConfig([], JSON.parse))
  const controller = new AbortController(); controller.abort('private-reason')
  const snapshot = await loadConfig(['never'], JSON.parse, async () => { throw new Error('must not open') }, controller.signal)
  failed(snapshot, 'LOOM_CONFIG_LOAD_CANCELLED'); assert.ok(!JSON.stringify(snapshot).includes('private-reason'))
  assert.equal(configLoadStatus().waiting, 8)
  first.release(); await Promise.all(pending); await first.promise
})

test('active cancellation settles its caller but keeps the slot until opened-file cleanup finishes', async t => {
  const controller = new AbortController(), first = blocked(t, controller.signal)
  await first.entered; let nextOpened = false
  const next = loadConfig(['next'], JSON.parse, async () => { nextOpened = true; return memoryFile() })
  controller.abort(); failed(await first.promise, 'LOOM_CONFIG_LOAD_CANCELLED')
  await tick(); assert.equal(configLoadStatus().active, 1); assert.equal(configLoadStatus().waiting, 1)
  assert.equal(nextOpened, false); assert.equal(first.closes(), 0)
  first.release(); await next
  assert.equal(first.closes(), 1); assert.equal(nextOpened, true); await idle()
})

test('cancelling a blocked read starts no further reads or decoding and closes the handle', async t => {
  const entered = deferred(), release = deferred(), controller = new AbortController(); let reads = 0, decodes = 0, closes = 0
  const file = memoryFile('{}')
  const request = loadConfig(['read'], () => { decodes++; return {} }, async () => ({ ...file,
    read: async (...args) => { reads++; entered.resolve(); await release.promise; return file.read(...args) },
    close: async () => { closes++ },
  }), controller.signal)
  t.after(async () => { release.resolve(); await request; await idle() })
  await entered.promise; controller.abort(); failed(await request, 'CANCELLED')
  assert.equal(configLoadStatus().active, 1); release.resolve(); await idle()
  assert.equal(reads, 1); assert.equal(decodes, 0); assert.equal(closes, 1)
})

test('cancellation while close is pending cannot publish settings or prematurely free capacity', async t => {
  const entered = deferred(), release = deferred(), controller = new AbortController(); let decoded = false
  const request = loadConfig(['closing'], () => { decoded = true; return {} }, async () => memoryFile('{}', {
    close: async () => { entered.resolve(); await release.promise },
  }), controller.signal)
  t.after(async () => { release.resolve(); await request; await idle() })
  await entered.promise; controller.abort(); failed(await request, 'CANCELLED')
  assert.equal(decoded, false); assert.equal(configLoadStatus().active, 1)
  release.resolve(); await idle(); assert.equal(decoded, false)
})

for (const point of ['open', 'stat', 'read', 'close', 'decode']) test(`${point} failure releases its slot and permits a later fresh load`, async () => {
  const fail = () => { throw new Error(`injected ${point} failure`) }
  const opener = async () => point === 'open' ? fail() : memoryFile('{}', point === 'decode' ? {} : { [point]: async () => fail() })
  const snapshot = await loadConfig(['error'], point === 'decode' ? fail : JSON.parse, opener)
  failed(snapshot, `injected ${point} failure`)
  const next = await loadConfig(['next'], JSON.parse, async () => memoryFile('{"agents":{"a":{"roles":["qa"]}}}'))
  assert.equal(next.errors.length, 0); assert.deepEqual(next.config.agents.a.roles, ['qa']); await idle()
})

test('synchronous admitted-operation throws release the slot without unhandled work', async () => {
  await assert.rejects(admitConfigLoad(() => { throw new Error('sync failure') }), /sync failure/)
  assert.equal(await admitConfigLoad(async () => 42), 42); await idle()
})

test('late active failure after caller cancellation is consumed and the next load still runs', async t => {
  const entered = deferred(), release = deferred(), controller = new AbortController()
  const request = admitConfigLoad(async () => { entered.resolve(); await release.promise; throw new Error('late failure') }, controller.signal)
  t.after(async () => { release.resolve(); await idle() })
  await entered.promise; controller.abort(); await assert.rejects(request, /CANCELLED/)
  const next = admitConfigLoad(async () => 'next'); release.resolve(); assert.equal(await next, 'next')
})

test('fresh reads are independent, not a shared successful result or stale cache', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'loom-admission-fresh-')), path = join(dir, '.loom.yaml')
  t.after(() => rm(dir, { recursive: true, force: true }))
  await writeFile(path, '{"agents":{"old":{"roles":["qa"]}}}')
  const first = blocked(t); await first.entered
  const pending = loadConfig([path], JSON.parse)
  await writeFile(path, '{"agents":{"new":{"roles":["planning"]}}}')
  first.release(); const result = await pending
  assert.equal(result.config.agents.old, undefined); assert.deepEqual(result.config.agents.new.roles, ['planning'])
  result.config.agents.new.roles.push('mutated-by-caller')
  const again = await loadConfig([path], JSON.parse); assert.deepEqual(again.config.agents.new.roles, ['planning'])
})

test('completed success and failure detach cancellation listeners', async () => {
  for (const error of [false, true]) {
    const c = new AbortController()
    const result = await loadConfig(['file'], JSON.parse, async () => {
      if (error) throw new Error('failure')
      return memoryFile()
    }, c.signal)
    assert.equal(result.errors.length, Number(error)); assert.equal(getEventListeners(c.signal, 'abort').length, 0)
    c.abort(); await idle()
  }
})

test('cancelling the last waiter does not skip the surviving FIFO requests', async t => {
  const first = blocked(t); await first.entered; const order = [], last = new AbortController()
  const a = admitConfigLoad(async () => order.push('a'))
  const b = admitConfigLoad(async () => order.push('b'))
  const c = admitConfigLoad(async () => order.push('cancelled'), last.signal)
  last.abort(); await assert.rejects(c, /CANCELLED/); assert.equal(configLoadStatus().waiting, 2)
  first.release(); await Promise.all([a, b]); assert.deepEqual(order, ['a', 'b'])
})

test('re-evaluated module observes the same active slot and waiting capacity', async t => {
  const first = blocked(t); await first.entered
  const requests = Array.from({ length: 8 }, () => loadConfig([], JSON.parse))
  const fresh = await import(`../.test-build/config-admission.js?replacement=${randomUUID()}`)
  assert.deepEqual(fresh.configLoadStatus(), configLoadStatus())
  await assert.rejects(fresh.admitConfigLoad(async () => 'no'), /OVERFLOW/)
  first.release(); await Promise.all(requests); await first.promise; assert.equal(fresh.configLoadStatus().active, 0)
})

test('a copied replacement module graph cannot reset or bypass the shared queue', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'loom-admission-replacement-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await writeFile(join(dir, 'package.json'), '{"type":"module"}')
  for (const file of ['config.js', 'config-admission.js', 'model-routing.js']) await copyFile(new URL(`../.test-build/${file}`, import.meta.url), join(dir, file))
  const fresh = await import(pathToFileURL(join(dir, 'config.js')).href)
  const first = blocked(t); await first.entered
  const owner = new AbortController()
  const oldWaiting = loadConfig([], JSON.parse, undefined, owner.signal)
  const more = Array.from({ length: 7 }, () => fresh.loadConfig([], JSON.parse))
  failed(await fresh.loadConfig([], JSON.parse), 'OVERFLOW')
  owner.abort(); failed(await oldWaiting, 'CANCELLED'); assert.equal(configLoadStatus().waiting, 7)
  const accepted = fresh.loadConfig([], JSON.parse)
  first.release(); await Promise.all([...more, accepted]); await idle()
})

test('cancelled active I/O still holds capacity, with no implied waiting-time deadline', async t => {
  const owner = new AbortController(), first = blocked(t, owner.signal); await first.entered
  owner.abort(); failed(await first.promise, 'CANCELLED')
  const waiting = Array.from({ length: 8 }, () => loadConfig([], JSON.parse))
  failed(await loadConfig([], JSON.parse), 'OVERFLOW')
  assert.equal(configLoadStatus().active, 1); assert.equal(configLoadStatus().wait_deadline, null)
  first.release(); await Promise.all(waiting); await idle()
})

test('layer admission and ordinary no-file behavior remain unchanged', async () => {
  const tooMany = await loadConfig(['a', 'b', 'c', 'd'], JSON.parse, async () => { throw new Error('must not open') })
  failed(tooMany, 'At most three')
  const noFiles = await loadConfig([], JSON.parse)
  assert.deepEqual(noFiles.sources, []); assert.deepEqual(noFiles.errors, []); assert.equal(noFiles.config.ledger.capture, 'automatic')
  await idle()
})
