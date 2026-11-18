import { assert, test } from 'orca/testing'
import { blockingErrorStyle, flushBeforeSwitch, switchBlock } from './switch-guard'
import { createSync, type FileApi, type SyncState, type Timers } from './sync'

const idle: SyncState = { status: 'saved', conflict: null, full: null, missing: false, error: null }
const failed = { status: 'error', code: 'permission_denied', message: 'nope' } as const

test('a clean saved state never holds the switch back', () => {
  assert.equal(switchBlock(idle, false), null)
  assert.equal(switchBlock({ ...idle, status: 'pending' }, false), null)
})

test('a failed write with unsaved changes blocks the switch', () => {
  assert.equal(switchBlock({ ...idle, status: 'error', error: failed }, true), 'error')
})

test('an error on clean text (a failed poll) does not block', () => {
  assert.equal(switchBlock({ ...idle, status: 'error', error: failed }, false), null)
})

test('the switch proceeds once the failed write is saved', () => {
  assert.equal(switchBlock({ ...idle, status: 'error', error: failed }, true), 'error')
  assert.equal(switchBlock(idle, false), null)
})

test('conflict and full keep their own reason, ahead of an error', () => {
  const conflict = { diskContent: 'x', diskVersion: 'v' }
  assert.equal(switchBlock({ ...idle, conflict, status: 'error', error: failed }, true), 'conflict')
  assert.equal(switchBlock({ ...idle, full: { bytes: 60_000 }, status: 'pending' }, true), 'full')
})

test('blocking startup errors: path problems point to Settings, transient ones offer Retry', () => {
  for (const code of ['invalid_path', 'not_found', 'too_large'] as const) {
    assert.deepEqual(blockingErrorStyle(code), { hint: true, retry: false })
  }
  for (const code of ['io_error', 'permission_denied', undefined] as const) {
    assert.deepEqual(blockingErrorStyle(code), { hint: false, retry: true })
  }
})

// --- Changement de fichier : aucune frappe de l'enregistrement final ne doit se perdre ---------------

/** Panneau minimal : un éditeur, un disque qui garde l'historique des écritures, et une écriture retenue à la main. */
function setupSwitch(options: { holdFirstWrite: boolean }) {
  let text = 'v1'
  let cleanText = ''
  const writes: string[] = []
  let releaseFirst!: () => void
  const api: FileApi = {
    stat: async () => ({ status: 'ok', exists: true, mtimeMs: 1, size: 1 }),
    read: async () => ({ status: 'ok', content: '', version: 'x', mtimeMs: 1, size: 1 }),
    write: (input) => {
      writes.push(input.content)
      const result = { status: 'saved', version: `v${writes.length}`, mtimeMs: 2, size: 2 } as const
      if (options.holdFirstWrite && writes.length === 1) return new Promise((resolve) => { releaseFirst = () => resolve(result) })
      return Promise.resolve(result)
    },
  }
  const timers: Timers = { now: () => 0, set: () => 0, clear: () => {} }
  const sync = createSync({
    api,
    path: '/x.md',
    base: { version: 'v0', mtimeMs: 1, size: 1 },
    getText: () => text,
    applyExternal: () => {},
    onState: (state) => {
      if (state.status === 'saved') cleanText = text
    },
    timers,
    debounceMs: 300,
    maxWaitMs: 300,
  })
  return {
    sync,
    writes,
    isDirty: () => text !== cleanText,
    type(next: string) {
      text = next
      sync.localChange()
    },
    release: () => releaseFirst(),
    text: () => text,
  }
}

test('a keystroke typed during the final save is written before the switch goes ahead', async () => {
  const panel = setupSwitch({ holdFirstWrite: true })
  panel.sync.localChange()
  const switching = flushBeforeSwitch(panel.sync, panel.isDirty)
  await Promise.resolve()
  panel.type('v1 + late keystroke')
  panel.release()
  const block = await switching
  assert.equal(block, null)
  assert.deepEqual(panel.writes, ['v1', 'v1 + late keystroke'])
  assert.equal(panel.isDirty(), false)
})

test('with no keystroke during the save, the switch costs a single write', async () => {
  const panel = setupSwitch({ holdFirstWrite: false })
  panel.sync.localChange()
  assert.equal(await flushBeforeSwitch(panel.sync, panel.isDirty), null)
  assert.deepEqual(panel.writes, ['v1'])
})

test('a conflict still holds the switch back, with no further write attempt', async () => {
  const conflictApi: FileApi = {
    stat: async () => ({ status: 'ok', exists: true, mtimeMs: 1, size: 1 }),
    read: async () => ({ status: 'ok', content: '', version: 'x', mtimeMs: 1, size: 1 }),
    write: async () => ({ status: 'conflict', content: 'agent', version: 'v9', mtimeMs: 2, size: 5 }),
  }
  const timers: Timers = { now: () => 0, set: () => 0, clear: () => {} }
  const sync = createSync({ api: conflictApi, path: '/x.md', base: { version: 'v0', mtimeMs: 1, size: 1 }, getText: () => 'mine', applyExternal: () => {}, onState: () => {}, timers, debounceMs: 300, maxWaitMs: 300 })
  sync.localChange()
  assert.equal(await flushBeforeSwitch(sync, () => true), 'conflict')
})
