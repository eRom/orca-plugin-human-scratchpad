import { assert, test } from 'orca/testing'
import { describeFooter, formatBytes, fullBannerText } from './chrome'
import type { SyncState } from './sync'

const idle: SyncState = { status: 'saved', conflict: null, full: null, missing: false, error: null }

test('footer labels follow the save status', () => {
  assert.deepEqual(describeFooter(idle, true), { dot: 'saved', label: 'Saved', retry: false })
  assert.deepEqual(describeFooter({ ...idle, status: 'pending' }, true), { dot: 'pending', label: 'Editing…', retry: false })
  assert.deepEqual(describeFooter({ ...idle, status: 'saving' }, true), { dot: 'saving', label: 'Saving…', retry: false })
})

test('an error shows its message with a retry action', () => {
  const error = { status: 'error', code: 'io_error', message: 'disk on fire' } as const
  assert.deepEqual(describeFooter({ ...idle, status: 'error', error }, true), { dot: 'error', label: 'disk on fire', retry: true })
})

test('a missing file reads differently for the default and a custom path', () => {
  assert.equal(describeFooter({ ...idle, missing: true }, true).label, 'File was deleted, typing will recreate it')
  assert.equal(describeFooter({ ...idle, missing: true }, false).label, 'File not found')
})

test('typing on a missing file shows the editing status, not the missing one', () => {
  assert.equal(describeFooter({ ...idle, status: 'pending', missing: true }, true).label, 'Editing…')
})

test('formatBytes never rounds a size above the limit down to it', () => {
  assert.equal(formatBytes(512), '512 B')
  assert.equal(formatBytes(1000), '1 KB')
  assert.equal(formatBytes(5392), '5.4 KB')
  assert.equal(formatBytes(50_000), '50 KB')
  assert.notEqual(formatBytes(50_001), formatBytes(50_000))
})

test('the full banner states the size and the limit', () => {
  assert.equal(fullBannerText(52_000), 'Scratchpad full (52 KB / 50 KB): delete some text to resume saving')
})
