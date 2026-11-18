// Fenêtre de perte au démontage, avec les constantes livrées : le panneau est détruit sans événement de sortie.
import { assert, test } from 'orca/testing'
import { SAVE_DEBOUNCE_MS, SAVE_MAX_WAIT_MS } from '../shared/limits'
import { createSync, type FileApi, type Timers } from './sync'

function harness(maxWaitMs: number) {
  let now = 0
  let seq = 0
  const queue: { id: number; at: number; fn: () => void }[] = []
  const timers: Timers = {
    now: () => now,
    set: (fn, ms) => {
      const id = ++seq
      queue.push({ id, at: now + ms, fn })
      return id
    },
    clear: (handle) => {
      const index = queue.findIndex((item) => item.id === handle)
      if (index >= 0) queue.splice(index, 1)
    },
  }
  const advanceTo = (target: number) => {
    for (;;) {
      const due = queue.filter((item) => item.at <= target).sort((a, b) => a.at - b.at)[0]
      if (!due) break
      queue.splice(queue.indexOf(due), 1)
      now = due.at
      due.fn()
    }
    now = target
  }
  let text = ''
  const writes: { at: number; content: string }[] = []
  const api: FileApi = {
    stat: async () => ({ status: 'ok', exists: true, mtimeMs: 1, size: 0 }),
    read: async () => ({ status: 'ok', content: '', version: 'v0', mtimeMs: 1, size: 0 }),
    write: async (input) => {
      writes.push({ at: now, content: input.content })
      return { status: 'saved', version: `v${writes.length}`, mtimeMs: 1 + writes.length, size: input.content.length }
    },
  }
  const sync = createSync({
    api,
    path: '/x.md',
    base: { version: 'v0', mtimeMs: 1, size: 0 },
    getText: () => text,
    applyExternal: () => {},
    onState: () => {},
    timers,
    debounceMs: SAVE_DEBOUNCE_MS,
    maxWaitMs,
  })
  return {
    sync,
    writes,
    type: (char: string) => {
      text += char
      sync.localChange()
    },
    advanceTo,
    text: () => text,
  }
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

/** Une touche toutes les 200 ms pendant 4 s, puis un démontage 200 ms après la dernière. */
async function typeThenUnmount(maxWaitMs: number) {
  const h = harness(maxWaitMs)
  const keyTimes: number[] = []
  for (let at = 0; at <= 4000; at += 200) {
    h.advanceTo(at)
    await settle()
    h.type('x')
    keyTimes.push(at)
  }
  h.advanceTo(4200)
  await settle()
  h.sync.dispose()
  const onDisk = h.writes.length ? h.writes[h.writes.length - 1].content.length : 0
  return { typed: h.text().length, onDisk, writes: h.writes, keyTimes }
}

test('shipped constants: continuous typing then unmount loses at most one key', async () => {
  const { typed, onDisk } = await typeThenUnmount(SAVE_MAX_WAIT_MS)
  assert.ok(typed - onDisk <= 1, `lost ${typed - onDisk} of ${typed} keys`)
})

test('shipped constants: during continuous typing every key is on disk within 300 ms of being typed', async () => {
  const { writes, keyTimes } = await typeThenUnmount(SAVE_MAX_WAIT_MS)
  // La touche n°i est écrite par la première écriture qui contient au moins i + 1 caractères.
  keyTimes.slice(0, -1).forEach((typedAt, index) => {
    const write = writes.find((candidate) => candidate.content.length >= index + 1)
    assert.ok(write, `key ${index} never written`)
    assert.ok(write.at - typedAt <= SAVE_MAX_WAIT_MS, `key ${index} waited ${write.at - typedAt} ms`)
  })
  assert.ok(writes.length >= 10, `only ${writes.length} writes`)
})

test('a long max wait leaves the whole burst in memory (why the constant is 300)', async () => {
  const { writes } = await typeThenUnmount(5000)
  assert.equal(writes.length, 0)
})
