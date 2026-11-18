import { assert, test } from 'orca/testing'
import { decodeDisk, encodeDisk, versionOf } from './codec'

const enc = (s: string) => new TextEncoder().encode(s)

test('LF text round-trips unchanged', () => {
  const d = decodeDisk(enc('a\nb\n')); assert.ok(d.ok)
  assert.deepEqual(d, { ok: true, text: 'a\nb\n', format: { eol: '\n', bom: false } })
  assert.deepEqual(encodeDisk('a\nb\n', d.format), enc('a\nb\n'))
})
test('CRLF is normalised to LF and restored on encode', () => {
  const d = decodeDisk(enc('a\r\nb\r\n')); assert.ok(d.ok)
  assert.equal(d.text, 'a\nb\n'); assert.equal(d.format.eol, '\r\n')
  assert.deepEqual(encodeDisk('a\nb\nc', d.format), enc('a\r\nb\r\nc'))
})
test('UTF-8 BOM is stripped and kept on encode', () => {
  const d = decodeDisk(new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69])); assert.ok(d.ok)
  assert.equal(d.text, 'hi'); assert.equal(d.format.bom, true)
  assert.deepEqual(encodeDisk('hi', d.format), new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69]))
})
test('invalid UTF-8 is refused', () => {
  assert.deepEqual(decodeDisk(new Uint8Array([0x63, 0x61, 0x66, 0xe9])), { ok: false }) // « café » en Latin-1
})
test('version is the sha256 of the disk bytes', () => {
  assert.equal(versionOf(enc('')), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  assert.notEqual(versionOf(enc('a\n')), versionOf(enc('a\r\n')))
})
