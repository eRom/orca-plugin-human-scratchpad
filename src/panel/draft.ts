// Brouillon de secours : tant que l'enregistrement est suspendu (conflit, fichier plein, échec d'écriture),
// le texte non enregistré est gardé dans `orca.storage` (clé `draft`). Orca détruit le cadre sans événement
// de sortie quand le panneau change d'onglet : sans cela, tout ce qui a été tapé depuis la suspension serait perdu.

import type { JsonValue, StorageApi } from 'orca/host'
import { DRAFT_DEBOUNCE_MS, DRAFT_MAX_JSON_BYTES, utf8Bytes } from '../shared/limits'
import type { SyncState, Timers } from './sync'

const STORAGE_KEY = 'draft'

export type Draft = { path: string; text: string; baseVersion: string }

/** Vrai quand des frappes non enregistrées ne peuvent plus partir sur le disque sans une décision ou une correction. */
export function isSavingPaused(state: SyncState, dirty: boolean): boolean {
  return dirty && (state.conflict !== null || state.full !== null || state.status === 'error')
}

/** Relit une valeur du stockage : tout ce qui n'a pas la forme d'un brouillon est ignoré. */
export function parseDraft(value: unknown): Draft | null {
  if (typeof value !== 'object' || value === null) return null
  const { path, text, baseVersion } = value as Record<string, unknown>
  if (typeof path !== 'string' || typeof text !== 'string' || typeof baseVersion !== 'string') return null
  return { path, text, baseVersion }
}

export type MountDecision =
  /** Le disque fait foi. `clearDraft` : un brouillon de ce fichier existe mais n'apporte rien, on l'efface. */
  | { kind: 'disk'; clearDraft: boolean }
  /** Le brouillon passe dans l'éditeur ; la synchronisation repart de `baseVersion` et le chemin habituel
   * enregistre (disque inchangé), relève le conflit (disque modifié) ou le bandeau « plein ». */
  | { kind: 'resume'; text: string; baseVersion: string }

/**
 * État au montage selon le brouillon stocké et le contenu du disque. Un brouillon d'un autre fichier est
 * laissé de côté sans être effacé : il reste valable si l'on revient à ce fichier.
 */
export function decideMount(draft: Draft | null, path: string, disk: { content: string }): MountDecision {
  if (draft === null || draft.path !== path) return { kind: 'disk', clearDraft: false }
  if (draft.text === disk.content) return { kind: 'disk', clearDraft: true }
  return { kind: 'resume', text: draft.text, baseVersion: draft.baseVersion }
}

export type DraftKeeper = {
  /** Brouillon stocké, ou `null`. Une valeur illisible ou une panne du stockage donnent `null`. */
  load(): Promise<Draft | null>
  /** Programme l'écriture (au plus une toutes les `delayMs`) ; l'instantané est pris à l'échéance. */
  hold(snapshot: () => Draft | null): void
  /** Écrit tout de suite ce qui attend (fenêtre masquée, changement de fichier). */
  flush(): Promise<void>
  /** Efface le brouillon : le texte est désormais sur le disque. */
  release(): Promise<void>
  /** Signale qu'un brouillon a été relu : `release` devra l'effacer. */
  adopt(): void
}

export function createDraftKeeper(storage: Pick<StorageApi, 'get' | 'set' | 'delete'>, timers: Timers, delayMs = DRAFT_DEBOUNCE_MS): DraftKeeper {
  let timer: unknown = null
  let waiting = false
  let snapshot: (() => Draft | null) | null = null
  // Vrai si le stockage contient peut-être un brouillon : évite un `delete` à chaque enregistrement réussi.
  let present = false
  // Les écritures s'enchaînent : un `release` ne double jamais un `set` plus ancien.
  let chain: Promise<void> = Promise.resolve()

  function enqueue(task: () => Promise<void>): void {
    chain = chain.then(task).catch((error) => console.warn('scratchpad: draft storage failed', error))
  }

  function write(): void {
    const draft = snapshot?.() ?? null
    snapshot = null
    if (draft === null) return
    const value: JsonValue = { path: draft.path, text: draft.text, baseVersion: draft.baseVersion }
    if (utf8Bytes(JSON.stringify(value)) > DRAFT_MAX_JSON_BYTES) {
      // Trop gros pour le stockage d'Orca : on n'enregistre pas de version tronquée, et on retire l'ancienne,
      // qui ressusciterait un texte périmé.
      console.warn('scratchpad: draft too large to keep')
      if (present) {
        present = false
        enqueue(() => storage.delete(STORAGE_KEY))
      }
      return
    }
    present = true
    enqueue(() => storage.set(STORAGE_KEY, value))
  }

  function cancelTimer(): void {
    if (waiting) timers.clear(timer)
    waiting = false
    timer = null
  }

  return {
    async load() {
      try {
        return parseDraft(await storage.get(STORAGE_KEY))
      } catch {
        return null
      }
    },

    hold(next) {
      snapshot = next
      if (waiting) return
      waiting = true
      timer = timers.set(() => {
        waiting = false
        timer = null
        write()
      }, delayMs)
    },

    flush() {
      if (waiting) {
        cancelTimer()
        write()
      }
      return chain
    },

    release() {
      cancelTimer()
      snapshot = null
      if (present) {
        present = false
        enqueue(() => storage.delete(STORAGE_KEY))
      }
      return chain
    },

    adopt() {
      present = true
    },
  }
}

/**
 * Règle de vie du brouillon, appelée à chaque changement d'état et à chaque frappe : le texte est sur le disque
 * (`saved`) et le brouillon disparaît ; l'enregistrement est suspendu et le brouillon suit le texte.
 */
export function trackDraft(keeper: DraftKeeper, state: SyncState, dirty: boolean, snapshot: () => Draft | null): void {
  if (state.status === 'saved') void keeper.release()
  else if (isSavingPaused(state, dirty)) keeper.hold(snapshot)
}
