import { assert, test } from 'orca/testing'
import { describeFooter, formatBytes, fullBannerText, switchBlockMessage } from './chrome'
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
  assert.equal(describeFooter({ ...idle, missing: true }, true).label, 'File was deleted: editing recreates it (choose Keep mine if asked)')
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

test('each switch block has its own explanation', () => {
  assert.equal(switchBlockMessage('error'), "Can't switch files: unsaved changes could not be saved")
  assert.notEqual(switchBlockMessage('conflict'), switchBlockMessage('full'))
})

test('footer never says Editing while saving is paused', () => {
  const conflict = { diskContent: 'agent', diskVersion: 'v1' }
  const paused = describeFooter({ ...idle, status: 'pending', conflict }, true)
  assert.equal(paused.label, 'Not saved: resolve the banner above')
  assert.equal(paused.dot, 'error')
  assert.equal(describeFooter({ ...idle, status: 'pending', full: { bytes: 60_000 } }, true).label, 'Not saved: delete some text to resume saving')
  // Pendant « Keep mine », l'enregistrement est en cours : le pied le dit.
  assert.equal(describeFooter({ ...idle, status: 'saving', conflict }, true).label, 'Saving…')
})
