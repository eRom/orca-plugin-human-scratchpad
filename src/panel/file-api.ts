// API fichier du panneau : enveloppe `orca.plugin.request` avec les noms `scratchpad.*`.
// Une requête qui échoue (worker arrêté, délai dépassé) devient une `FileError` : le panneau
// ne traite ainsi qu'une seule forme d'erreur, celle du protocole.

import type { OrcaFrameApi } from 'orca/frame'
import type { FileError, ResolveOutput } from '../protocol'
import type { FileApi } from './sync'

export type PanelFileApi = FileApi & { resolve(): Promise<ResolveOutput> }

async function guarded<T>(run: () => Promise<T>): Promise<T | FileError> {
  try {
    return await run()
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { status: 'error', code: 'io_error', message: `Could not reach the scratchpad worker (${detail}).` }
  }
}

export function frameFileApi(orca: Pick<OrcaFrameApi, 'plugin'>): PanelFileApi {
  return {
    resolve: () => guarded(() => orca.plugin.request('scratchpad.resolve', {})),
    stat: (path) => guarded(() => orca.plugin.request('scratchpad.stat', { path })),
    read: (path) => guarded(() => orca.plugin.request('scratchpad.read', { path })),
    write: (input) => guarded(() => orca.plugin.request('scratchpad.write', input)),
  }
}
