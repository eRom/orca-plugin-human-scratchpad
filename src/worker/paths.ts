import nodePath from 'node:path'
import { DEFAULT_FILE_NAME } from '../shared/limits'

// `PlatformPath` n'est pas exporté par @types/node : on dérive le type de l'API.
type PlatformPath = typeof nodePath

export type ResolvedPath = { ok: true; path: string; isDefault: boolean } | { ok: false; message: string }

/**
 * Résout le réglage `filePath` en chemin absolu. Vide ou blanc : fichier par défaut dans le dossier personnel.
 * `~` est développé, le chemin doit être absolu et finir par `.md` (casse ignorée).
 */
export function resolveScratchpadPath(setting: unknown, home: string, pathApi: PlatformPath = nodePath): ResolvedPath {
  const defaultPath = pathApi.join(home, DEFAULT_FILE_NAME)
  if (setting === undefined || setting === null) return { ok: true, path: defaultPath, isDefault: true }
  if (typeof setting !== 'string') return { ok: false, message: 'The scratchpad file path must be a string.' }

  const trimmed = setting.trim()
  if (trimmed === '') return { ok: true, path: defaultPath, isDefault: true }

  let expanded = trimmed
  if (trimmed === '~') expanded = home
  else if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) expanded = pathApi.join(home, trimmed.slice(2))

  if (!pathApi.isAbsolute(expanded)) {
    return { ok: false, message: 'The scratchpad file path must be absolute or start with ~.' }
  }
  const resolved = pathApi.normalize(expanded)
  if (!resolved.toLowerCase().endsWith('.md')) {
    return { ok: false, message: 'The scratchpad file must end with .md.' }
  }
  return { ok: true, path: resolved, isDefault: resolved === defaultPath }
}

/** Abrège le dossier personnel en `~` pour l'affichage. */
export function toDisplayPath(path: string, home: string, pathApi: PlatformPath = nodePath): string {
  if (path === home) return '~'
  if (path.startsWith(home + pathApi.sep)) return '~' + path.slice(home.length)
  return path
}
