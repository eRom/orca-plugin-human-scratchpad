// Garde du changement de fichier : décide si l'on peut quitter le fichier courant sans perdre de texte.

import type { FileErrorCode } from '../protocol'
import type { Sync, SyncState } from './sync'

export type SwitchBlock = 'conflict' | 'full' | 'error'

/**
 * Raison pour laquelle le changement de fichier doit attendre, ou `null` s'il peut avoir lieu.
 * `dirty` : le texte de l'éditeur diffère de ce qui est sur le disque. Une erreur sur un texte propre
 * (un simple poll en échec) ne retient rien ; sur un texte non enregistré, partir le perdrait.
 */
export function switchBlock(state: SyncState, dirty: boolean): SwitchBlock | null {
  if (state.conflict) return 'conflict'
  if (state.full) return 'full'
  if (state.status === 'error' && dirty) return 'error'
  return null
}

export type BlockingErrorStyle = { hint: boolean; retry: boolean }

/**
 * Présentation d'une erreur bloquante au démarrage : un chemin à corriger renvoie vers les réglages,
 * une panne passagère (droits, disque, worker) propose de réessayer.
 */
export function blockingErrorStyle(code: FileErrorCode | undefined): BlockingErrorStyle {
  if (code === 'invalid_path' || code === 'not_found' || code === 'too_large') return { hint: true, retry: false }
  return { hint: false, retry: true }
}

/** Plafond de tours : une frappe continue ne doit pas retenir le changement de fichier indéfiniment. */
const MAX_FLUSH_ROUNDS = 20

/**
 * Enregistre le fichier courant avant de le quitter. Une frappe arrivée pendant l'écriture laisse l'éditeur
 * en avance sur le disque : on enregistre de nouveau, et on ne rend la main qu'une fois le texte écrit égal
 * au texte courant. Renvoie la raison de retenir le changement, ou `null` s'il peut avoir lieu.
 */
export async function flushBeforeSwitch(sync: Pick<Sync, 'flush' | 'state'>, isDirty: () => boolean): Promise<SwitchBlock | null> {
  for (let round = 0; round < MAX_FLUSH_ROUNDS; round++) {
    await sync.flush()
    const block = switchBlock(sync.state, isDirty())
    if (block !== null) return block
    if (!isDirty()) return null
  }
  // Jamais atteint avec un humain : le texte bouge encore après 20 enregistrements. On retient le changement.
  return 'error'
}
