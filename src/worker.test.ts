import { assert, mockHost, mountWorker, test } from 'orca/testing'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as main from './worker'

const sha256 = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex')
const BOM = Buffer.from([0xef, 0xbb, 0xbf])

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'scratchpad-'))
}

/** Monte le worker avec le réglage `filePath` donné. */
function mount(filePath: string) {
  return mountWorker(main, { host: mockHost({ settings: { filePath } }) })
}

/** Exécute `fn` avec HOME pointé sur un dossier temporaire, puis restaure HOME. */
async function withHome<T>(home: string, fn: () => Promise<T>): Promise<T> {
  const previous = process.env.HOME
  process.env.HOME = home
  try {
    return await fn()
  } finally {
    if (previous === undefined) delete process.env.HOME
    else process.env.HOME = previous
  }
}

test('resolve returns the default path under HOME when the setting is empty', async () => {
  const home = makeTmp()
  await withHome(home, async () => {
    const worker = await mount('')
    const out = await worker.request('scratchpad.resolve', {})
    assert.deepEqual(out, { status: 'ok', path: join(home, 'orca-scratchpad.md'), displayPath: '~/orca-scratchpad.md', isDefault: true })
    assert.equal(existsSync(join(home, 'orca-scratchpad.md')), false)
  })
})

test('resolve reports invalid_path for a non-md setting', async () => {
  const home = makeTmp()
  await withHome(home, async () => {
    const worker = await mount('/tmp/notes.txt')
    const out = await worker.request('scratchpad.resolve', {})
    assert.equal(out.status, 'error')
    assert.equal((out as { code: string }).code, 'invalid_path')
  })
})

test('read creates the missing default file empty', async () => {
  const home = makeTmp()
  await withHome(home, async () => {
    const worker = await mount('')
    const file = join(home, 'orca-scratchpad.md')
    const out = await worker.request('scratchpad.read', { path: file })
    assert.equal(out.status, 'ok')
    if (out.status !== 'ok') return
    assert.equal(out.content, '')
    assert.equal(out.version, sha256(''))
    assert.equal(out.size, 0)
    assert.equal(existsSync(file), true)
    assert.equal(statSync(file).size, 0)
  })
})

test('read of a missing custom file is not_found and creates nothing', async () => {
  const home = makeTmp()
  await withHome(home, async () => {
    const worker = await mount('')
    const file = join(home, 'custom.md')
    const out = await worker.request('scratchpad.read', { path: file })
    assert.equal(out.status, 'error')
    assert.equal((out as { code: string }).code, 'not_found')
    assert.equal(existsSync(file), false)
  })
})

test('read of a directory named x.md is invalid_path', async () => {
  const home = makeTmp()
  await withHome(home, async () => {
    const worker = await mount('')
    const dir = join(home, 'x.md')
    mkdirSync(dir)
    const out = await worker.request('scratchpad.read', { path: dir })
    assert.equal(out.status, 'error')
    assert.equal((out as { code: string }).code, 'invalid_path')
    assert.equal(statSync(dir).isDirectory(), true)
  })
})

test('read rejects a relative or non-md path as invalid_path', async () => {
  const home = makeTmp()
  await withHome(home, async () => {
    const worker = await mount('')
    for (const path of ['relative.md', join(home, 'a.txt'), '']) {
      const out = await worker.request('scratchpad.read', { path })
      assert.equal(out.status, 'error')
      assert.equal((out as { code: string }).code, 'invalid_path')
    }
  })
})

test('read of a Latin-1 file is io_error and leaves it untouched', async () => {
  const home = makeTmp()
  await withHome(home, async () => {
    const worker = await mount('')
    const file = join(home, 'latin.md')
    const bytes = Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a])
    writeFileSync(file, bytes)
    const out = await worker.request('scratchpad.read', { path: file })
    assert.equal(out.status, 'error')
    if (out.status !== 'error') return
    assert.equal(out.code, 'io_error')
    assert.match(out.message, /UTF-8/)
    assert.deepEqual(readFileSync(file), bytes)
  })
})

test('read over the read cap is too_large', async () => {
  const home = makeTmp()
  await withHome(home, async () => {
    const worker = await mount('')
    const file = join(home, 'big.md')
    writeFileSync(file, 'a'.repeat(900_001))
    const out = await worker.request('scratchpad.read', { path: file })
    assert.equal(out.status, 'error')
    assert.equal((out as { code: string }).code, 'too_large')
  })
})

test('read returns the decoded content, version and stat of an existing file', async () => {
  const home = makeTmp()
  await withHome(home, async () => {
    const worker = await mount('')
    const file = join(home, 'a.md')
    const bytes = Buffer.concat([BOM, Buffer.from('a\r\nb')])
    writeFileSync(file, bytes)
    const out = await worker.request('scratchpad.read', { path: file })
    assert.equal(out.status, 'ok')
    if (out.status !== 'ok') return
    assert.equal(out.content, 'a\nb')
    assert.equal(out.version, sha256(bytes))
    assert.equal(out.size, bytes.length)
    assert.equal(out.mtimeMs, statSync(file).mtimeMs)
  })
})

test('write with the current version saves and returns the new version', async () => {
  const home = makeTmp()
  await withHome(home, async () => {
    const worker = await mount('')
    const file = join(home, 'a.md')
    writeFileSync(file, 'old')
    const out = await worker.request('scratchpad.write', { path: file, content: 'new text', baseVersion: sha256('old'), force: false })
    assert.equal(out.status, 'saved')
    if (out.status !== 'saved') return
    assert.equal(readFileSync(file, 'utf8'), 'new text')
    assert.equal(out.version, sha256(readFileSync(file)))
    assert.equal(out.size, 8)
    assert.equal(out.mtimeMs, statSync(file).mtimeMs)
  })
})

test('write with a stale version returns conflict with the disk content', async () => {
  const home = makeTmp()
  await withHome(home, async () => {
    const worker = await mount('')
    const file = join(home, 'a.md')
    writeFileSync(file, 'changed outside')
    const out = await worker.request('scratchpad.write', { path: file, content: 'mine', baseVersion: sha256('old'), force: false })
    assert.equal(out.status, 'conflict')
    if (out.status !== 'conflict') return
    assert.equal(out.content, 'changed outside')
    assert.equal(out.version, sha256('changed outside'))
    assert.equal(readFileSync(file, 'utf8'), 'changed outside')
  })
})

test('write with force overwrites a changed file', async () => {
  const home = makeTmp()
  await withHome(home, async () => {
    const worker = await mount('')
    const file = join(home, 'a.md')
    writeFileSync(file, 'changed outside')
    const out = await worker.request('scratchpad.write', { path: file, content: 'mine', baseVersion: sha256('old'), force: true })
    assert.equal(out.status, 'saved')
    assert.equal(readFileSync(file, 'utf8'), 'mine')
  })
})

test('write preserves CRLF and BOM of the existing file', async () => {
  const home = makeTmp()
  await withHome(home, async () => {
    const worker = await mount('')
    const file = join(home, 'a.md')
    const original = Buffer.concat([BOM, Buffer.from('x\r\ny')])
    writeFileSync(file, original)
    const out = await worker.request('scratchpad.write', { path: file, content: 'a\nb', baseVersion: sha256(original), force: false })
    assert.equal(out.status, 'saved')
    const expected = Buffer.concat([BOM, Buffer.from('a\r\nb')])
    assert.deepEqual(readFileSync(file), expected)
    if (out.status === 'saved') assert.equal(out.version, sha256(expected))
  })
})

test('write follows a symlink and keeps it a symlink', async () => {
  const home = makeTmp()
  await withHome(home, async () => {
    const worker = await mount('')
    const target = join(home, 'target.md')
    const link = join(home, 'link.md')
    writeFileSync(target, 'old')
    symlinkSync(target, link)
    const out = await worker.request('scratchpad.write', { path: link, content: 'via link', baseVersion: sha256('old'), force: false })
    assert.equal(out.status, 'saved')
    assert.equal(lstatSync(link).isSymbolicLink(), true)
    assert.equal(readFileSync(target, 'utf8'), 'via link')
  })
})

test('write over the size cap is too_large and writes nothing', async () => {
  const home = makeTmp()
  await withHome(home, async () => {
    const worker = await mount('')
    const file = join(home, 'a.md')
    writeFileSync(file, 'old')
    const out = await worker.request('scratchpad.write', { path: file, content: 'a'.repeat(50_001), baseVersion: sha256('old'), force: false })
    assert.equal(out.status, 'error')
    assert.equal((out as { code: string }).code, 'too_large')
    assert.equal(readFileSync(file, 'utf8'), 'old')
  })
})

test('write into a missing parent folder is not_found and creates nothing', async () => {
  const home = makeTmp()
  await withHome(home, async () => {
    const worker = await mount('')
    const parent = join(home, 'missing')
    const file = join(parent, 'a.md')
    const out = await worker.request('scratchpad.write', { path: file, content: 'x', baseVersion: sha256(''), force: true })
    assert.equal(out.status, 'error')
    assert.equal((out as { code: string }).code, 'not_found')
    assert.equal(existsSync(parent), false)
    assert.equal(existsSync(file), false)
  })
})

test('write to a missing custom file is not_found and creates nothing', async () => {
  const home = makeTmp()
  await withHome(home, async () => {
    const worker = await mount('')
    const file = join(home, 'custom.md')
    const out = await worker.request('scratchpad.write', { path: file, content: 'x', baseVersion: sha256(''), force: false })
    assert.equal(out.status, 'error')
    assert.equal((out as { code: string }).code, 'not_found')
    assert.equal(existsSync(file), false)
  })
})

test('write recreates the deleted default file', async () => {
  const home = makeTmp()
  await withHome(home, async () => {
    const worker = await mount('')
    const file = join(home, 'orca-scratchpad.md')
    assert.equal(existsSync(file), false)
    const out = await worker.request('scratchpad.write', { path: file, content: 'back', baseVersion: sha256(''), force: false })
    assert.equal(out.status, 'saved')
    assert.equal(readFileSync(file, 'utf8'), 'back')
  })
})

test('write leaves no temporary file behind', async () => {
  const home = makeTmp()
  await withHome(home, async () => {
    const worker = await mount('')
    const file = join(home, 'a.md')
    writeFileSync(file, 'old')
    await worker.request('scratchpad.write', { path: file, content: 'new', baseVersion: sha256('old'), force: false })
    assert.deepEqual(readdirSync(home), ['a.md'])
  })
})

test('stat of a missing file reports exists false', async () => {
  const home = makeTmp()
  await withHome(home, async () => {
    const worker = await mount('')
    const file = join(home, 'nope.md')
    const out = await worker.request('scratchpad.stat', { path: file })
    assert.deepEqual(out, { status: 'ok', exists: false, mtimeMs: 0, size: 0 })
    assert.equal(existsSync(file), false)
  })
})

test('stat of an existing file reports its size and mtime', async () => {
  const home = makeTmp()
  await withHome(home, async () => {
    const worker = await mount('')
    const file = join(home, 'a.md')
    writeFileSync(file, 'hello')
    const out = await worker.request('scratchpad.stat', { path: file })
    assert.deepEqual(out, { status: 'ok', exists: true, mtimeMs: statSync(file).mtimeMs, size: 5 })
  })
})
