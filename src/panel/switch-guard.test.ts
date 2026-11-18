import { assert, test } from 'orca/testing'
import { blockingErrorStyle, switchBlock } from './switch-guard'
import type { SyncState } from './sync'

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
