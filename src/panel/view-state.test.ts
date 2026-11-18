import { assert, test } from 'orca/testing'
import type { JsonValue, StorageApi } from 'orca/host'
import { createViewStateStore } from './view-state'

/** Stockage en mémoire qui compte les écritures. */
function fakeStorage(initial: Record<string, JsonValue> = {}) {
  const data = new Map<string, JsonValue>(Object.entries(initial))
  const stats = { sets: 0 }
  const storage: StorageApi = {
    get: async (key) => data.get(key) ?? null,
    set: async (key, value) => {
      stats.sets++
      data.set(key, value)
    },
    delete: async (key) => {
      data.delete(key)
    },
    keys: async () => [...data.keys()],
    onDidChange: () => ({ dispose() {} }),
  }
  return { storage, data, stats }
}

const wait = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

test('save debounces a burst into a single write', async () => {
  const { storage, data, stats } = fakeStorage()
  const store = createViewStateStore(storage, 10)
  store.save('/a.md', { anchor: 1, head: 1, scrollTop: 0 })
  store.save('/a.md', { anchor: 2, head: 4, scrollTop: 30 })
  assert.equal(stats.sets, 0)
  await wait(60)
  assert.equal(stats.sets, 1)
  assert.deepEqual(data.get('viewState'), { '/a.md': { anchor: 2, head: 4, scrollTop: 30 } })
})

test('load returns what save stored, per path', async () => {
  const { storage } = fakeStorage()
  const store = createViewStateStore(storage, 1000)
  store.save('/a.md', { anchor: 3, head: 3, scrollTop: 10 })
  store.save('/b.md', { anchor: 0, head: 5, scrollTop: 0 })
  await store.flush()
  assert.deepEqual(await store.load('/a.md'), { anchor: 3, head: 3, scrollTop: 10 })
  assert.deepEqual(await store.load('/b.md'), { anchor: 0, head: 5, scrollTop: 0 })
  assert.equal(await store.load('/c.md'), null)
})

test('topPos round-trips and an invalid one is dropped', async () => {
  const { storage } = fakeStorage({ viewState: { '/bad.md': { anchor: 1, head: 1, scrollTop: 5, topPos: 'x' } } })
  const store = createViewStateStore(storage, 1000)
  store.save('/a.md', { anchor: 3, head: 3, scrollTop: 10, topPos: 120, topOffset: 14.5 })
  await store.flush()
  assert.deepEqual(await store.load('/a.md'), { anchor: 3, head: 3, scrollTop: 10, topPos: 120, topOffset: 14.5 })
  assert.deepEqual(await store.load('/bad.md'), { anchor: 1, head: 1, scrollTop: 5 })
})

test('a write keeps the entries of other paths', async () => {
  const { storage, data } = fakeStorage({ viewState: { '/old.md': { anchor: 9, head: 9, scrollTop: 1 } } })
  const store = createViewStateStore(storage, 1000)
  store.save('/new.md', { anchor: 1, head: 1, scrollTop: 2 })
  await store.flush()
  assert.deepEqual(Object.keys(data.get('viewState') as object).sort(), ['/new.md', '/old.md'])
})

test('malformed stored values read as no state', async () => {
  const { storage } = fakeStorage({ viewState: { '/a.md': { anchor: 'x', head: 1, scrollTop: 0 }, '/b.md': 42 } })
  const store = createViewStateStore(storage)
  assert.equal(await store.load('/a.md'), null)
  assert.equal(await store.load('/b.md'), null)
})

test('a storage failure never breaks saving or loading', async () => {
  const storage: StorageApi = {
    get: async () => {
      throw new Error('boom')
    },
    set: async () => {
      throw new Error('boom')
    },
    delete: async () => {},
    keys: async () => [],
    onDidChange: () => ({ dispose() {} }),
  }
  const store = createViewStateStore(storage, 1000)
  store.save('/a.md', { anchor: 1, head: 1, scrollTop: 0 })
  await store.flush()
  assert.equal(await store.load('/a.md'), null)
})
