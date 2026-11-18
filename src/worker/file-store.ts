import { chmodSync, existsSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import type { Stats } from 'node:fs'
import { dirname } from 'node:path'
import type { FileError, ReadOutput, StatOutput, WriteInput, WriteOutput } from '../protocol'
import { READ_MAX_BYTES, SCRATCHPAD_MAX_BYTES, utf8Bytes } from '../shared/limits'
import { decodeDisk, EMPTY_FORMAT, encodeDisk, versionOf } from './codec'
import type { DiskFormat } from './codec'

// Accès disque synchrone du scratchpad : une écriture commencée va toujours à son terme.

function fail(code: FileError['code'], message: string): FileError {
  return { status: 'error', code, message }
}

/** Traduit une erreur du système de fichiers en réponse protocolaire lisible. */
function toFileError(error: unknown): FileError {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  if (code === 'EACCES' || code === 'EPERM') return fail('permission_denied', 'Permission denied on the scratchpad file.')
  if (code === 'ENOENT') return fail('not_found', 'The scratchpad file or its folder does not exist.')
  if (code === 'EISDIR') return fail('invalid_path', 'The scratchpad path points to a folder, not a file.')
  const detail = code ?? (error instanceof Error ? error.message : String(error))
  return fail('io_error', `Could not access the scratchpad file (${detail}).`)
}

function isErrno(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === code
}

const notUtf8 = (): FileError => fail('io_error', 'File is not valid UTF-8')
const tooLarge = (): FileError => fail('too_large', `The scratchpad file is too large (limit ${READ_MAX_BYTES} bytes).`)

/** Etat disque d'un fichier existant, ou erreur. */
type DiskState = { bytes: Uint8Array; text: string; format: DiskFormat; stats: Stats }

function loadDisk(path: string): DiskState | FileError {
  try {
    const stats = statSync(path)
    if (stats.isDirectory()) return toFileError({ code: 'EISDIR' })
    if (stats.size > READ_MAX_BYTES) return tooLarge()
    const bytes = readFileSync(path)
    if (bytes.byteLength > READ_MAX_BYTES) return tooLarge()
    const decoded = decodeDisk(bytes)
    if (!decoded.ok) return notUtf8()
    return { bytes, text: decoded.text, format: decoded.format, stats }
  } catch (error) {
    return toFileError(error)
  }
}

const isFileError = (value: DiskState | FileError): value is FileError => 'status' in value

export function statFile(path: string): StatOutput {
  try {
    const stats = statSync(path)
    if (stats.isDirectory()) return toFileError({ code: 'EISDIR' })
    return { status: 'ok', exists: true, mtimeMs: stats.mtimeMs, size: stats.size }
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return { status: 'ok', exists: false, mtimeMs: 0, size: 0 }
    return toFileError(error)
  }
}

export function readFile(path: string, isDefault: boolean): ReadOutput {
  if (isDefault && !existsSync(path)) {
    try {
      writeFileSync(path, '', { flag: 'wx' })
    } catch (error) {
      // Un EEXIST concurrent est sans conséquence : le fichier existe, on le relit.
      if (!isErrno(error, 'EEXIST')) return toFileError(error)
    }
  }
  const disk = loadDisk(path)
  if (isFileError(disk)) return disk
  return { status: 'ok', content: disk.text, version: versionOf(disk.bytes), mtimeMs: disk.stats.mtimeMs, size: disk.stats.size }
}

export function writeFile(input: WriteInput, isDefault: boolean): WriteOutput {
  const { path, content, baseVersion, force } = input
  if (utf8Bytes(content) > SCRATCHPAD_MAX_BYTES) {
    return fail('too_large', `The scratchpad is limited to ${SCRATCHPAD_MAX_BYTES} bytes.`)
  }

  // Un fichier absent compte comme vide, mais seulement pour le fichier par défaut.
  let diskBytes: Uint8Array = new Uint8Array(0)
  let format: DiskFormat = EMPTY_FORMAT
  let diskText = ''
  let existingMode: number | undefined
  if (existsSync(path)) {
    const disk = loadDisk(path)
    if (isFileError(disk)) return disk
    diskBytes = disk.bytes
    format = disk.format
    diskText = disk.text
    existingMode = disk.stats.mode & 0o777
  } else if (!isDefault) {
    return toFileError({ code: 'ENOENT' })
  }

  const diskVersion = versionOf(diskBytes)
  if (!force && diskVersion !== baseVersion) {
    const stats = statFile(path)
    if (stats.status === 'error') return stats
    return { status: 'conflict', content: diskText, version: diskVersion, mtimeMs: stats.mtimeMs, size: stats.size }
  }

  const bytes = encodeDisk(content, format)
  let target = path
  try {
    target = realpathSync(path)
  } catch {
    // Cible absente : on écrit directement à son emplacement.
  }
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`
  try {
    writeFileSync(tmp, bytes, { flag: 'wx' })
    if (existingMode !== undefined) chmodSync(tmp, existingMode)
    renameSync(tmp, target)
  } catch (error) {
    try {
      unlinkSync(tmp)
    } catch {
      // Le temporaire n'a peut-être jamais été créé.
    }
    return toFileError(error)
  }
  const stats = statFile(target)
  if (stats.status === 'error') return stats
  return { status: 'saved', version: versionOf(bytes), mtimeMs: stats.mtimeMs, size: stats.size }
}
