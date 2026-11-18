import { homedir } from 'node:os'
import type { OrcaWorkerApi } from 'orca/worker'
import type { FileError, ResolveOutput } from './protocol'
import { readFile, statFile, writeFile } from './worker/file-store'
import { resolveScratchpadPath, toDisplayPath } from './worker/paths'

type Validated = { ok: true; path: string; isDefault: boolean } | { ok: false; error: FileError }

/** Valide le chemin reçu du panneau : absolu, `.md`, jamais vide. */
function validatePath(path: unknown): Validated {
  const invalid = (message: string): Validated => ({ ok: false, error: { status: 'error', code: 'invalid_path', message } })
  if (typeof path !== 'string' || path.trim() === '') return invalid('The scratchpad file path is missing.')
  const resolved = resolveScratchpadPath(path, homedir())
  if (!resolved.ok) return invalid(resolved.message)
  return { ok: true, path: resolved.path, isDefault: resolved.isDefault }
}

export default async function activate(orca: OrcaWorkerApi): Promise<void> {
  orca.panels.handle('scratchpad.resolve', async (): Promise<ResolveOutput> => {
    const home = homedir()
    const resolved = resolveScratchpadPath(await orca.settings.get('filePath'), home)
    if (!resolved.ok) return { status: 'error', code: 'invalid_path', message: resolved.message }
    return { status: 'ok', path: resolved.path, displayPath: toDisplayPath(resolved.path, home), isDefault: resolved.isDefault }
  })

  orca.panels.handle('scratchpad.stat', (input) => {
    const target = validatePath(input?.path)
    return target.ok ? statFile(target.path) : target.error
  })

  orca.panels.handle('scratchpad.read', (input) => {
    const target = validatePath(input?.path)
    return target.ok ? readFile(target.path, target.isDefault) : target.error
  })

  // Pas de `signal` ici et des appels `fs` synchrones : une écriture commencée va à son terme.
  orca.panels.handle('scratchpad.write', (input) => {
    const target = validatePath(input?.path)
    return target.ok ? writeFile({ ...input, path: target.path }, target.isDefault) : target.error
  })
}
