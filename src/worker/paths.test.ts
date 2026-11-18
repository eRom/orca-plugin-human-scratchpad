import { assert, test } from 'orca/testing'
import path from 'node:path'
import { resolveScratchpadPath, toDisplayPath } from './paths'

test('empty or blank setting resolves to the default file', () => {
  assert.deepEqual(resolveScratchpadPath('', '/home/u'), { ok: true, path: '/home/u/orca-scratchpad.md', isDefault: true })
  assert.deepEqual(resolveScratchpadPath('   ', '/home/u'), { ok: true, path: '/home/u/orca-scratchpad.md', isDefault: true })
  assert.deepEqual(resolveScratchpadPath(undefined, '/home/u'), { ok: true, path: '/home/u/orca-scratchpad.md', isDefault: true })
})
test('tilde expands and an explicit default path is still the default', () => {
  assert.deepEqual(resolveScratchpadPath('~/notes/a.md', '/home/u'), { ok: true, path: '/home/u/notes/a.md', isDefault: false })
  assert.deepEqual(resolveScratchpadPath('~/orca-scratchpad.md', '/home/u'), { ok: true, path: '/home/u/orca-scratchpad.md', isDefault: true })
})
test('extension check ignores case, relative and non-md paths are refused', () => {
  assert.equal(resolveScratchpadPath('/tmp/A.MD', '/home/u').ok, true)
  assert.equal(resolveScratchpadPath('notes.md', '/home/u').ok, false)
  assert.equal(resolveScratchpadPath('/tmp/notes.txt', '/home/u').ok, false)
  assert.equal(resolveScratchpadPath(42, '/home/u').ok, false)
})
test('windows paths resolve with win32 rules', () => {
  assert.deepEqual(resolveScratchpadPath('', 'C:\\Users\\u', path.win32), { ok: true, path: 'C:\\Users\\u\\orca-scratchpad.md', isDefault: true })
  assert.deepEqual(resolveScratchpadPath('~\\n\\a.md', 'C:\\Users\\u', path.win32), { ok: true, path: 'C:\\Users\\u\\n\\a.md', isDefault: false })
})
test('display path abbreviates the home folder', () => {
  assert.equal(toDisplayPath('/home/u/orca-scratchpad.md', '/home/u'), '~/orca-scratchpad.md')
  assert.equal(toDisplayPath('/tmp/a.md', '/home/u'), '/tmp/a.md')
  assert.equal(toDisplayPath('/home/user2/a.md', '/home/u'), '/home/user2/a.md')
})
