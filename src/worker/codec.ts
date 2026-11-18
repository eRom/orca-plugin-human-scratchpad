import { createHash } from 'node:crypto'

export type DiskFormat = { eol: '\n' | '\r\n'; bom: boolean }
export type Decoded = { ok: true; text: string; format: DiskFormat } | { ok: false }

export const EMPTY_FORMAT: DiskFormat = { eol: '\n', bom: false }

const BOM = [0xef, 0xbb, 0xbf]

/**
 * Décode les octets disque en UTF-8 strict : BOM retiré, fins de ligne normalisées en LF.
 * La fin de ligne mémorisée est celle du premier saut de ligne rencontré, LF par défaut.
 * Octets non UTF-8 : refusé (`ok: false`).
 */
export function decodeDisk(bytes: Uint8Array): Decoded {
  const bom = bytes.length >= 3 && BOM.every((byte, i) => bytes[i] === byte)
  let raw: string
  try {
    raw = new TextDecoder('utf-8', { fatal: true }).decode(bom ? bytes.subarray(3) : bytes)
  } catch {
    return { ok: false }
  }
  const firstBreak = raw.indexOf('\n')
  const eol = firstBreak > 0 && raw[firstBreak - 1] === '\r' ? '\r\n' : '\n'
  return { ok: true, text: raw.replace(/\r\n/g, '\n'), format: { eol, bom } }
}

/** Réencode un texte LF vers le format disque d'origine (fin de ligne et BOM). */
export function encodeDisk(text: string, format: DiskFormat): Uint8Array {
  const body = new TextEncoder().encode(format.eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text)
  if (!format.bom) return body
  const out = new Uint8Array(body.length + 3)
  out.set(BOM, 0)
  out.set(body, 3)
  return out
}

/** Version d'un fichier : sha256 hexadécimal des octets disque. */
export function versionOf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}
