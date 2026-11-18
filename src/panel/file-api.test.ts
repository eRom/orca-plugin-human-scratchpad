import { assert, test } from 'orca/testing'
import { frameFileApi } from './file-api'

type Call = { name: string; input: unknown }

/** Faux pont de requêtes : enregistre les appels et répond ou échoue selon `behavior`. */
function fakeOrca(behavior: (name: string) => unknown) {
  const calls: Call[] = []
  const plugin = {
    request: async (name: string, input?: unknown) => {
      calls.push({ name, input })
      const result = behavior(name)
      if (result instanceof Error) throw result
      return result
    },
    on: () => ({ dispose() {} }),
  }
  return { orca: { plugin } as unknown as Parameters<typeof frameFileApi>[0], calls }
}

test('each call uses its scratchpad request name and input', async () => {
  const { orca, calls } = fakeOrca(() => ({ status: 'ok' }))
  const api = frameFileApi(orca)
  await api.resolve()
  await api.stat('/a.md')
  await api.read('/a.md')
  await api.write({ path: '/a.md', content: 'x', baseVersion: 'v', force: false })
  assert.deepEqual(calls, [
    { name: 'scratchpad.resolve', input: {} },
    { name: 'scratchpad.stat', input: { path: '/a.md' } },
    { name: 'scratchpad.read', input: { path: '/a.md' } },
    { name: 'scratchpad.write', input: { path: '/a.md', content: 'x', baseVersion: 'v', force: false } },
  ])
})

test('a rejected request becomes an io_error instead of throwing', async () => {
  const { orca } = fakeOrca(() => new Error('timeout'))
  const api = frameFileApi(orca)
  for (const result of [await api.resolve(), await api.stat('/a.md'), await api.read('/a.md')]) {
    assert.equal(result.status, 'error')
    assert.match((result as { message: string }).message, /timeout/)
  }
  const written = await api.write({ path: '/a.md', content: '', baseVersion: 'v', force: false })
  assert.equal(written.status, 'error')
})
