import { assert, test } from 'orca/testing'
import type { ReadOutput, StatOutput, WriteInput, WriteOutput } from '../protocol'
import { createSync, type FileApi, type SyncState, type Timers } from './sync'

const PATH = '/tmp/pad.md'
const BASE = { version: 'v0', mtimeMs: 1000, size: 10 }

/** Faux minuteurs : une liste de { at, fn } et une horloge contrôlée. */
function fakeTimers() {
  let current = 0
  let seq = 0
  const queue: { id: number; at: number; fn: () => void }[] = []
  const timers: Timers = {
    now: () => current,
    set(fn, ms) {
      const id = ++seq
      queue.push({ id, at: current + ms, fn })
      return id
    },
    clear(handle) {
      const index = queue.findIndex((item) => item.id === handle)
      if (index >= 0) queue.splice(index, 1)
    },
  }
  return {
    timers,
    pending: () => queue.length,
    /** Avance l'horloge et exécute les minuteurs échus, dans l'ordre. */
    advance(ms: number) {
      const target = current + ms
      for (;;) {
        const due = queue.filter((item) => item.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0]
        if (!due) break
        queue.splice(queue.indexOf(due), 1)
        current = due.at
        due.fn()
      }
      current = target
    },
  }
}

type Deferred<T> = { promise: Promise<T>; resolve(value: T): void }
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

/** Laisse les promesses déjà résolues s'enchaîner. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

const saved = (version: string, mtimeMs = 2000, size = 20): WriteOutput => ({ status: 'saved', version, mtimeMs, size })
const statOk = (mtimeMs: number, size: number, exists = true): StatOutput => ({ status: 'ok', exists, mtimeMs, size })
const readOk = (content: string, version: string, mtimeMs = 3000, size = 30): ReadOutput => ({ status: 'ok', content, version, mtimeMs, size })

function setup(options: { text?: string; debounceMs?: number; maxWaitMs?: number } = {}) {
  const clock = fakeTimers()
  const calls = { stat: [] as string[], read: [] as string[], write: [] as WriteInput[], applied: [] as string[] }
  const states: SyncState[] = []
  const env = {
    text: options.text ?? 'hello',
    statResult: statOk(BASE.mtimeMs, BASE.size) as StatOutput,
    readResult: readOk('disk', 'v-disk') as ReadOutput,
    writeResults: [] as (WriteOutput | Promise<WriteOutput>)[],
  }
  const api: FileApi = {
    async stat(path) {
      calls.stat.push(path)
      return env.statResult
    },
    async read(path) {
      calls.read.push(path)
      return env.readResult
    },
    async write(input) {
      calls.write.push(input)
      return env.writeResults.shift() ?? saved(`v${calls.write.length}`)
    },
  }
  const sync = createSync({
    api,
    path: PATH,
    base: { ...BASE },
    getText: () => env.text,
    applyExternal: (text) => { calls.applied.push(text) },
    onState: (state) => { states.push({ ...state }) },
    timers: clock.timers,
    debounceMs: options.debounceMs ?? 1000,
    maxWaitMs: options.maxWaitMs ?? 5000,
  })
  return { sync, clock, calls, env, states }
}

test('saves once after the debounce with the base version', async () => {
  const { sync, clock, calls } = setup()
  sync.localChange()
  assert.equal(sync.state.status, 'pending')
  clock.advance(999)
  assert.equal(calls.write.length, 0)
  clock.advance(1)
  await settle()
  assert.equal(calls.write.length, 1)
  assert.deepEqual(calls.write[0], { path: PATH, content: 'hello', baseVersion: 'v0', force: false })
  assert.equal(sync.state.status, 'saved')
})

test('continuous typing still saves at the max wait', async () => {
  const { sync, clock, calls } = setup()
  // Une frappe toutes les 500 ms pendant 6 s : le debounce de 1 s ne se déclenche jamais seul.
  for (let t = 500; t <= 6000; t += 500) {
    sync.localChange()
    clock.advance(500)
    await settle()
    // La frappe de t-500 démarre la rafale à t=0 ; l'écriture tombe à t=5000 pile.
    assert.equal(calls.write.length, t < 5000 ? 0 : 1, `write count at t=${t}`)
  }
})

test('a change during an in-flight write triggers a second write', async () => {
  const { sync, clock, calls, env } = setup()
  const gate = deferred<WriteOutput>()
  env.writeResults.push(gate.promise)
  sync.localChange()
  clock.advance(1000)
  await settle()
  assert.equal(calls.write.length, 1)
  assert.equal(sync.state.status, 'saving')
  env.text = 'hello world'
  sync.localChange()
  clock.advance(5000)
  await settle()
  assert.equal(calls.write.length, 1, 'never two writes in flight at once')
  gate.resolve(saved('v1'))
  await settle()
  clock.advance(1000)
  await settle()
  assert.equal(calls.write.length, 2)
  assert.deepEqual(calls.write[1], { path: PATH, content: 'hello world', baseVersion: 'v1', force: false })
  assert.equal(sync.state.status, 'saved')
})

test('write conflict suspends autosave until a choice', async () => {
  const { sync, clock, calls, env } = setup()
  env.writeResults.push({ status: 'conflict', content: 'disk text', version: 'v-disk', mtimeMs: 9, size: 9 })
  sync.localChange()
  clock.advance(1000)
  await settle()
  assert.deepEqual(sync.state.conflict, { diskContent: 'disk text', diskVersion: 'v-disk' })
  sync.localChange()
  sync.localChange()
  clock.advance(10_000)
  await settle()
  assert.equal(calls.write.length, 1)
  assert.equal(clock.pending(), 0)
})

test('keepMine forces the write and clears the conflict', async () => {
  const { sync, clock, calls, env } = setup()
  env.writeResults.push({ status: 'conflict', content: 'disk text', version: 'v-disk', mtimeMs: 9, size: 9 })
  sync.localChange()
  clock.advance(1000)
  await settle()
  await sync.keepMine()
  assert.equal(calls.write.length, 2)
  assert.deepEqual(calls.write[1], { path: PATH, content: 'hello', baseVersion: 'v0', force: true })
  assert.equal(sync.state.conflict, null)
  assert.equal(sync.state.status, 'saved')
})

test('reload applies the disk text and drops local changes', async () => {
  const { sync, clock, calls, env } = setup()
  env.writeResults.push({ status: 'conflict', content: 'disk text', version: 'v-disk', mtimeMs: 9, size: 9 })
  sync.localChange()
  clock.advance(1000)
  await settle()
  sync.reload()
  assert.deepEqual(calls.applied, ['disk text'])
  assert.equal(sync.state.conflict, null)
  assert.equal(sync.state.status, 'saved')
  // Plus rien à enregistrer : un flush ne doit pas écrire.
  await sync.flush()
  assert.equal(calls.write.length, 1)
})

test('after reload the next poll matches the version and only refreshes the stat', async () => {
  const { sync, clock, calls, env } = setup()
  env.writeResults.push({ status: 'conflict', content: 'disk text', version: 'v-disk', mtimeMs: 9, size: 9 })
  sync.localChange()
  clock.advance(1000)
  await settle()
  sync.reload()
  env.statResult = statOk(9, 9)
  env.readResult = readOk('disk text', 'v-disk', 9, 9)
  await sync.poll()
  assert.equal(calls.read.length, 1)
  assert.deepEqual(calls.applied, ['disk text'], 'no second applyExternal')
  await sync.poll()
  assert.equal(calls.read.length, 1, 'stat now matches the base')
})

test('poll with an unchanged stat does not read', async () => {
  const { sync, calls } = setup()
  await sync.poll()
  assert.equal(calls.stat.length, 1)
  assert.equal(calls.read.length, 0)
  assert.equal(calls.applied.length, 0)
})

test('poll with the same content updates the base stat only', async () => {
  const { sync, calls, env } = setup()
  env.statResult = statOk(5555, 99)
  env.readResult = readOk('hello', 'v0', 5555, 99)
  await sync.poll()
  assert.equal(calls.read.length, 1)
  assert.equal(calls.applied.length, 0)
  await sync.poll()
  assert.equal(calls.read.length, 1, 'base stat updated, no second read')
})

test('poll applies an external change when clean', async () => {
  const { sync, clock, calls, env } = setup()
  env.statResult = statOk(5555, 99)
  env.readResult = readOk('changed outside', 'v-new', 5555, 99)
  await sync.poll()
  assert.deepEqual(calls.applied, ['changed outside'])
  assert.equal(sync.state.conflict, null)
  // La nouvelle base sert à la sauvegarde suivante.
  sync.localChange()
  clock.advance(1000)
  await settle()
  assert.equal(calls.write[0].baseVersion, 'v-new')
})

test('poll during unsaved changes raises a conflict', async () => {
  const { sync, calls, env } = setup()
  sync.localChange()
  env.statResult = statOk(5555, 99)
  env.readResult = readOk('changed outside', 'v-new', 5555, 99)
  await sync.poll()
  assert.deepEqual(sync.state.conflict, { diskContent: 'changed outside', diskVersion: 'v-new' })
  assert.equal(calls.applied.length, 0)
})

test('poll is skipped while a write is in flight', async () => {
  const { sync, clock, calls, env } = setup()
  const gate = deferred<WriteOutput>()
  env.writeResults.push(gate.promise)
  sync.localChange()
  clock.advance(1000)
  await settle()
  await sync.poll()
  assert.equal(calls.stat.length, 0)
  gate.resolve(saved('v1'))
  await settle()
})

test('a missing file never empties the editor', async () => {
  const { sync, calls, env } = setup()
  env.statResult = statOk(0, 0, false)
  await sync.poll()
  assert.equal(sync.state.missing, true)
  assert.equal(calls.applied.length, 0)
  assert.equal(calls.read.length, 0)
})

test('over the cap nothing is written until the text shrinks', async () => {
  const { sync, clock, calls, env } = setup({ text: 'x'.repeat(50_001) })
  sync.localChange()
  clock.advance(1000)
  await settle()
  assert.equal(calls.write.length, 0)
  assert.deepEqual(sync.state.full, { bytes: 50_001 })
  assert.equal(sync.state.status, 'pending')
  env.text = 'short'
  sync.localChange()
  clock.advance(1000)
  await settle()
  assert.equal(calls.write.length, 1)
  assert.equal(calls.write[0].content, 'short')
  assert.equal(sync.state.full, null)
  assert.equal(sync.state.status, 'saved')
})

test('a write error is kept as pending and retried by flush', async () => {
  const { sync, clock, calls, env } = setup()
  env.writeResults.push({ status: 'error', code: 'io_error', message: 'disk full' })
  sync.localChange()
  clock.advance(1000)
  await settle()
  assert.equal(sync.state.status, 'error')
  assert.equal(sync.state.error?.code, 'io_error')
  await sync.flush()
  assert.equal(calls.write.length, 2)
  assert.equal(sync.state.status, 'saved')
  assert.equal(sync.state.error, null)
})

test('flush saves immediately and cancels the wait', async () => {
  const { sync, clock, calls } = setup()
  sync.localChange()
  await sync.flush()
  assert.equal(calls.write.length, 1)
  assert.equal(clock.pending(), 0)
})

test('flush does nothing without changes or during a conflict', async () => {
  const { sync, clock, calls, env } = setup()
  await sync.flush()
  assert.equal(calls.write.length, 0)
  env.writeResults.push({ status: 'conflict', content: 'd', version: 'v-d', mtimeMs: 1, size: 1 })
  sync.localChange()
  clock.advance(1000)
  await settle()
  await sync.flush()
  assert.equal(calls.write.length, 1)
})

test('dispose cancels the pending timer and makes later calls no-ops', async () => {
  const { sync, clock, calls } = setup()
  sync.localChange()
  sync.dispose()
  assert.equal(clock.pending(), 0)
  clock.advance(10_000)
  sync.localChange()
  await sync.flush()
  await sync.poll()
  assert.equal(calls.write.length, 0)
  assert.equal(calls.stat.length, 0)
})

test('onState is called on each state change', async () => {
  const { sync, clock, states } = setup()
  sync.localChange()
  clock.advance(1000)
  await settle()
  assert.deepEqual(states.map((s) => s.status), ['pending', 'saving', 'saved'])
})
