import { assert, test } from 'orca/testing'
import type { JsonValue, StorageApi } from 'orca/host'
import type { ReadOutput, WriteInput, WriteOutput } from '../protocol'
import { DRAFT_MAX_JSON_BYTES, SCRATCHPAD_MAX_BYTES } from '../shared/limits'
import { createDraftKeeper, decideMount, isSavingPaused, parseDraft, trackDraft, type Draft } from './draft'
import { createSync, type FileApi, type SyncState, type Timers } from './sync'

const idle: SyncState = { status: 'saved', conflict: null, full: null, missing: false, error: null }
const conflict = { diskContent: 'agent', diskVersion: 'v1' }
const failed = { status: 'error', code: 'io_error', message: 'disk on fire' } as const

/** Stockage en mémoire qui compte les écritures et les suppressions. */
function fakeStorage(initial: Record<string, JsonValue> = {}) {
  const data = new Map<string, JsonValue>(Object.entries(initial))
  const stats = { sets: 0, deletes: 0 }
  const storage: Pick<StorageApi, 'get' | 'set' | 'delete'> = {
    get: async (key) => data.get(key) ?? null,
    set: async (key, value) => {
      stats.sets++
      data.set(key, value)
    },
    delete: async (key) => {
      stats.deletes++
      data.delete(key)
    },
  }
  return { storage, data, stats }
}

/** Faux minuteurs à horloge contrôlée. */
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

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

// --- Décision au montage -------------------------------------------------------------------------

test('no draft, or a draft of another file, leaves the disk in charge without clearing anything', () => {
  assert.deepEqual(decideMount(null, '/a.md', { content: 'disk' }), { kind: 'disk', clearDraft: false })
  const other: Draft = { path: '/b.md', text: 'mine', baseVersion: 'v0' }
  assert.deepEqual(decideMount(other, '/a.md', { content: 'disk' }), { kind: 'disk', clearDraft: false })
})

test('a draft identical to the disk content is cleared and ignored', () => {
  const draft: Draft = { path: '/a.md', text: 'same', baseVersion: 'v0' }
  assert.deepEqual(decideMount(draft, '/a.md', { content: 'same' }), { kind: 'disk', clearDraft: true })
})

test('a draft that differs from the disk is resumed with its base version', () => {
  const draft: Draft = { path: '/a.md', text: 'mine', baseVersion: 'v0' }
  assert.deepEqual(decideMount(draft, '/a.md', { content: 'disk' }), { kind: 'resume', text: 'mine', baseVersion: 'v0' })
})

test('parseDraft rejects anything that is not a complete draft', () => {
  assert.equal(parseDraft(null), null)
  assert.equal(parseDraft('text'), null)
  assert.equal(parseDraft({ path: '/a.md', text: 'x' }), null)
  assert.equal(parseDraft({ path: '/a.md', text: 1, baseVersion: 'v' }), null)
  assert.deepEqual(parseDraft({ path: '/a.md', text: 'x', baseVersion: 'v', extra: true }), { path: '/a.md', text: 'x', baseVersion: 'v' })
})

test('saving is paused only for unsaved text in a conflict, over the cap, or after a failed write', () => {
  assert.equal(isSavingPaused(idle, true), false)
  assert.equal(isSavingPaused({ ...idle, status: 'pending' }, true), false)
  assert.equal(isSavingPaused({ ...idle, status: 'pending', conflict }, true), true)
  assert.equal(isSavingPaused({ ...idle, status: 'pending', full: { bytes: 60_000 } }, true), true)
  assert.equal(isSavingPaused({ ...idle, status: 'error', error: failed }, true), true)
  // Une erreur sur un texte propre (un poll en échec) n'a rien à protéger.
  assert.equal(isSavingPaused({ ...idle, status: 'error', error: failed }, false), false)
  assert.equal(isSavingPaused({ ...idle, status: 'pending', conflict }, false), false)
})

// --- Gardien du brouillon ------------------------------------------------------------------------

test('hold writes the latest snapshot once per delay, not once per keystroke', async () => {
  const { storage, data, stats } = fakeStorage()
  const clock = fakeTimers()
  const keeper = createDraftKeeper(storage, clock.timers, 300)
  let text = 'a'
  const snapshot = (): Draft => ({ path: '/a.md', text, baseVersion: 'v0' })
  keeper.hold(snapshot)
  text = 'ab'
  keeper.hold(snapshot)
  text = 'abc'
  keeper.hold(snapshot)
  assert.equal(stats.sets, 0)
  clock.advance(300)
  await settle()
  assert.equal(stats.sets, 1)
  assert.deepEqual(data.get('draft'), { path: '/a.md', text: 'abc', baseVersion: 'v0' })
  // Typing continues: a new write is due 300 ms later (a throttle, never starved by the typing).
  text = 'abcd'
  keeper.hold(snapshot)
  clock.advance(300)
  await settle()
  assert.deepEqual(data.get('draft'), { path: '/a.md', text: 'abcd', baseVersion: 'v0' })
})

test('flush writes the waiting draft immediately', async () => {
  const { storage, data } = fakeStorage()
  const keeper = createDraftKeeper(storage, fakeTimers().timers, 300)
  keeper.hold(() => ({ path: '/a.md', text: 'now', baseVersion: 'v0' }))
  await keeper.flush()
  assert.deepEqual(data.get('draft'), { path: '/a.md', text: 'now', baseVersion: 'v0' })
})

test('release removes a stored draft, and costs no storage call when there is none', async () => {
  const { storage, data, stats } = fakeStorage()
  const clock = fakeTimers()
  const keeper = createDraftKeeper(storage, clock.timers, 300)
  await keeper.release()
  assert.equal(stats.deletes, 0)
  keeper.hold(() => ({ path: '/a.md', text: 'x', baseVersion: 'v0' }))
  clock.advance(300)
  await keeper.release()
  assert.equal(data.has('draft'), false)
  assert.equal(stats.deletes, 1)
})

test('release cancels a draft write that is still waiting', async () => {
  const { storage, stats } = fakeStorage()
  const clock = fakeTimers()
  const keeper = createDraftKeeper(storage, clock.timers, 300)
  keeper.hold(() => ({ path: '/a.md', text: 'x', baseVersion: 'v0' }))
  await keeper.release()
  clock.advance(1000)
  await settle()
  assert.equal(stats.sets, 0)
})

test('a snapshot that returns null writes nothing', async () => {
  const { storage, stats } = fakeStorage()
  const keeper = createDraftKeeper(storage, fakeTimers().timers, 300)
  keeper.hold(() => null)
  await keeper.flush()
  assert.equal(stats.sets, 0)
})

test('a draft too large for Orca storage is never truncated, and the stale one is removed', async () => {
  const { storage, data } = fakeStorage()
  const keeper = createDraftKeeper(storage, fakeTimers().timers, 300)
  keeper.hold(() => ({ path: '/a.md', text: 'small', baseVersion: 'v0' }))
  await keeper.flush()
  assert.ok(data.has('draft'))
  const huge = 'x'.repeat(DRAFT_MAX_JSON_BYTES + 1)
  keeper.hold(() => ({ path: '/a.md', text: huge, baseVersion: 'v0' }))
  await keeper.flush()
  assert.equal(data.has('draft'), false)
})

test('a draft at the full-file size (a 50 KB file plus a paste) fits in storage', async () => {
  const { storage, data } = fakeStorage()
  const keeper = createDraftKeeper(storage, fakeTimers().timers, 300)
  const text = 'line of text\n'.repeat(Math.ceil((SCRATCHPAD_MAX_BYTES + 2_000) / 13))
  keeper.hold(() => ({ path: '/a.md', text, baseVersion: 'v0' }))
  await keeper.flush()
  assert.equal((data.get('draft') as Draft).text, text)
})

test('load returns the stored draft, and null for a missing or unreadable value', async () => {
  const stored = fakeStorage({ draft: { path: '/a.md', text: 'x', baseVersion: 'v0' } })
  assert.deepEqual(await createDraftKeeper(stored.storage, fakeTimers().timers).load(), { path: '/a.md', text: 'x', baseVersion: 'v0' })
  assert.equal(await createDraftKeeper(fakeStorage().storage, fakeTimers().timers).load(), null)
  const broken = fakeStorage({ draft: 'garbage' })
  assert.equal(await createDraftKeeper(broken.storage, fakeTimers().timers).load(), null)
  const throwing: Pick<StorageApi, 'get' | 'set' | 'delete'> = { get: async () => { throw new Error('gone') }, set: async () => {}, delete: async () => {} }
  assert.equal(await createDraftKeeper(throwing, fakeTimers().timers).load(), null)
})

// --- Scénarios de bout en bout : démontage pendant la suspension, puis remontage ------------------

/** Un « disque » partagé entre deux montages du panneau, avec le contrôle de version du worker. */
function fakeDisk(initial: { content: string; version: string }) {
  const disk = { ...initial, writes: [] as WriteInput[] }
  const api: FileApi = {
    stat: async () => ({ status: 'ok', exists: true, mtimeMs: 1, size: disk.content.length }),
    read: async (): Promise<ReadOutput> => ({ status: 'ok', content: disk.content, version: disk.version, mtimeMs: 1, size: disk.content.length }),
    write: async (input): Promise<WriteOutput> => {
      disk.writes.push(input)
      if (!input.force && input.baseVersion !== disk.version) {
        return { status: 'conflict', content: disk.content, version: disk.version, mtimeMs: 2, size: disk.content.length }
      }
      disk.content = input.content
      disk.version = `v-${disk.writes.length}-saved`
      return { status: 'saved', version: disk.version, mtimeMs: 3, size: input.content.length }
    },
  }
  return { disk, api }
}

/** Monte un panneau comme `main.ts` : le brouillon relu décide du texte, de la base et de l'état. */
async function mountPanel(api: FileApi, disk: { content: string; version: string }, storage: Pick<StorageApi, 'get' | 'set' | 'delete'>) {
  const clock = fakeTimers()
  const keeper = createDraftKeeper(storage, clock.timers, 300)
  const read = await api.read('/a.md')
  if (read.status !== 'ok') throw new Error('read failed')
  const decision = decideMount(await keeper.load(), '/a.md', read)
  let text = decision.kind === 'resume' ? decision.text : read.content
  let cleanText = read.content
  const sync = createSync({
    api,
    path: '/a.md',
    base: decision.kind === 'resume' ? { version: decision.baseVersion, mtimeMs: -1, size: -1 } : { version: read.version, mtimeMs: read.mtimeMs, size: read.size },
    getText: () => text,
    applyExternal: (next) => {
      text = next
      cleanText = next
    },
    onState: (state) => {
      if (state.status === 'saved') cleanText = text
      trackDraft(keeper, state, text !== cleanText, () => ({ path: '/a.md', text, baseVersion: sync.baseVersion }))
    },
    timers: clock.timers,
    debounceMs: 300,
    maxWaitMs: 300,
  })
  if (decision.kind === 'disk' && decision.clearDraft) await keeper.discard()
  if (decision.kind === 'resume') {
    keeper.adopt()
    sync.localChange()
  }
  return {
    sync,
    keeper,
    clock,
    decision,
    text: () => text,
    type(next: string) {
      text = next
      sync.localChange()
      trackDraft(keeper, sync.state, true, () => ({ path: '/a.md', text, baseVersion: sync.baseVersion }))
    },
    /** Démontage sans événement de sortie : seul ce qui est déjà écrit survit. */
    unmount() {
      sync.dispose()
    },
    async idle() {
      clock.advance(300)
      await settle()
    },
  }
}

test('conflict then unmount: the typed text comes back as a conflict banner, with the agent text intact on disk', async () => {
  const { disk, api } = fakeDisk({ content: 'base', version: 'v0' })
  const { storage, data } = fakeStorage()
  const first = await mountPanel(api, disk, storage)
  // Un agent écrit sur le disque, puis l'utilisateur tape.
  disk.content = 'agent'
  disk.version = 'v1'
  first.type('base + mine')
  await first.idle()
  assert.ok(first.sync.state.conflict, 'conflict banner expected')
  first.type('base + mine + more typing in the banner')
  await first.idle()
  first.unmount()
  assert.deepEqual(data.get('draft'), { path: '/a.md', text: 'base + mine + more typing in the banner', baseVersion: 'v0' })

  const second = await mountPanel(api, disk, storage)
  assert.equal(second.decision.kind, 'resume')
  assert.equal(second.text(), 'base + mine + more typing in the banner')
  await second.idle()
  assert.ok(second.sync.state.conflict, 'the conflict banner comes back after the remount')
  assert.equal(second.sync.state.conflict?.diskContent, 'agent')
  assert.equal(disk.content, 'agent', 'nothing was written over the agent text')
  assert.equal(data.has('draft'), true, 'the draft stays until the user decides')

  // Keep mine : le texte part, le brouillon disparaît.
  await second.sync.keepMine()
  await settle()
  assert.equal(disk.content, 'base + mine + more typing in the banner')
  assert.equal(data.has('draft'), false)
})

test('conflict then unmount then Reload: the draft is cleared and the disk text is shown', async () => {
  const { disk, api } = fakeDisk({ content: 'base', version: 'v0' })
  const { storage, data } = fakeStorage()
  const first = await mountPanel(api, disk, storage)
  disk.content = 'agent'
  disk.version = 'v1'
  first.type('mine')
  await first.idle()
  // Le brouillon part au plus 300 ms après l'entrée dans la suspension.
  await first.idle()
  first.unmount()
  const second = await mountPanel(api, disk, storage)
  await second.idle()
  second.sync.reload()
  await settle()
  assert.equal(second.text(), 'agent')
  assert.equal(data.has('draft'), false)
})

test('over the cap then unmount: the text comes back with the full state, still unsaved', async () => {
  const { disk, api } = fakeDisk({ content: 'x'.repeat(49_000), version: 'v0' })
  const { storage, data } = fakeStorage()
  const first = await mountPanel(api, disk, storage)
  const pasted = 'x'.repeat(49_000) + 'y'.repeat(2_000)
  first.type(pasted)
  await first.idle()
  assert.ok(first.sync.state.full, 'full state expected')
  first.type(pasted + 'LOST?')
  await first.idle()
  first.unmount()
  assert.equal((data.get('draft') as Draft).text, pasted + 'LOST?')

  const second = await mountPanel(api, disk, storage)
  assert.equal(second.text(), pasted + 'LOST?')
  await second.idle()
  assert.ok(second.sync.state.full, 'the full state comes back after the remount')
  assert.equal(disk.content, 'x'.repeat(49_000), 'the file on disk is untouched')
})

test('write error then unmount: the draft resumes and saves normally once the disk accepts it', async () => {
  const { disk, api } = fakeDisk({ content: 'base', version: 'v0' })
  const flaky: FileApi = { ...api, write: async () => ({ status: 'error', code: 'io_error', message: 'disk on fire' }) }
  const { storage, data } = fakeStorage()
  const first = await mountPanel(flaky, disk, storage)
  first.type('base + mine')
  await first.idle()
  assert.equal(first.sync.state.status, 'error')
  await first.idle()
  first.unmount()
  assert.equal((data.get('draft') as Draft).text, 'base + mine')

  // Disque inchangé : la base du brouillon est la version courante, l'enregistrement passe sans bandeau.
  const second = await mountPanel(api, disk, storage)
  assert.equal(second.text(), 'base + mine')
  await second.idle()
  assert.equal(second.sync.state.status, 'saved')
  assert.equal(second.sync.state.conflict, null)
  assert.equal(disk.content, 'base + mine')
  assert.equal(data.has('draft'), false)
})

test('a draft equal to the disk is discarded at mount', async () => {
  const { disk, api } = fakeDisk({ content: 'same', version: 'v0' })
  const { storage, data } = fakeStorage({ draft: { path: '/a.md', text: 'same', baseVersion: 'v-old' } })
  const panel = await mountPanel(api, disk, storage)
  assert.deepEqual(panel.decision, { kind: 'disk', clearDraft: true })
  assert.equal(panel.text(), 'same')
  assert.equal(data.has('draft'), false, 'the stale draft is removed from storage at mount')

  // Sans cela, un changement ultérieur du disque ressusciterait ce texte périmé en bandeau « Changed elsewhere ».
  disk.content = 'agent'
  disk.version = 'v1'
  const next = await mountPanel(api, disk, storage)
  assert.deepEqual(next.decision, { kind: 'disk', clearDraft: false })
  assert.equal(next.text(), 'agent')
})

test('a normal save leaves no draft behind and never touches storage', async () => {
  const { disk, api } = fakeDisk({ content: 'base', version: 'v0' })
  const { storage, stats } = fakeStorage()
  const panel = await mountPanel(api, disk, storage)
  panel.type('base + note')
  await panel.idle()
  assert.equal(disk.content, 'base + note')
  assert.equal(stats.sets, 0)
  assert.equal(stats.deletes, 0)
})
