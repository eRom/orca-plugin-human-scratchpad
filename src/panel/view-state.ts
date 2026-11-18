// Sélection et défilement par fichier, gardés dans `orca.storage` (clé unique `viewState`).
// L'écriture est différée : une rafale de déplacements ne produit qu'un enregistrement.

import type { JsonValue, StorageApi } from 'orca/host'
import type { ViewState } from './editor'

const STORAGE_KEY = 'viewState'
const WRITE_DEBOUNCE_MS = 500

export type ViewStateStore = {
  load(path: string): Promise<ViewState | null>
  save(path: string, state: ViewState): void
  /** Écrit tout de suite ce qui attend (changement de fichier). */
  flush(): Promise<void>
}

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

function parseViewState(value: unknown): ViewState | null {
  if (typeof value !== 'object' || value === null) return null
  const { anchor, head, scrollTop, topPos, topOffset } = value as Record<string, unknown>
  if (!isFiniteNumber(anchor) || !isFiniteNumber(head) || !isFiniteNumber(scrollTop)) return null
  // `topPos` est facultatif : une valeur absente ou invalide laisse la restauration se rabattre sur les pixels.
  if (!isFiniteNumber(topPos)) return { anchor, head, scrollTop }
  return isFiniteNumber(topOffset) ? { anchor, head, scrollTop, topPos, topOffset } : { anchor, head, scrollTop, topPos }
}

function asRecord(value: unknown): Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? { ...(value as Record<string, JsonValue>) } : {}
}

export function createViewStateStore(storage: StorageApi, debounceMs = WRITE_DEBOUNCE_MS): ViewStateStore {
  const pending = new Map<string, ViewState>()
  let timer: ReturnType<typeof setTimeout> | null = null
  // Les écritures s'enchaînent : lecture, fusion puis écriture ne se croisent jamais.
  let chain: Promise<void> = Promise.resolve()

  function write(): Promise<void> {
    const batch = [...pending]
    pending.clear()
    if (batch.length === 0) return chain
    chain = chain.then(async () => {
      try {
        const record = asRecord(await storage.get(STORAGE_KEY))
        for (const [path, state] of batch) record[path] = { ...state }
        await storage.set(STORAGE_KEY, record)
      } catch (error) {
        // Meilleur effort : perdre une position de curseur ne justifie pas de gêner l'édition.
        console.warn('scratchpad: could not save view state', error)
      }
    })
    return chain
  }

  return {
    async load(path) {
      try {
        const record = asRecord(await storage.get(STORAGE_KEY))
        return parseViewState(record[path])
      } catch {
        return null
      }
    },

    save(path, state) {
      pending.set(path, state)
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        void write()
      }, debounceMs)
    },

    flush() {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      return write()
    },
  }
}

// Instance partagée du panneau, créée au premier usage (l'objet `orca` n'existe que dans le cadre).
let shared: ViewStateStore | null = null
const store = (): ViewStateStore => (shared ??= createViewStateStore(orca.storage))

export const loadViewState = (path: string): Promise<ViewState | null> => store().load(path)
export const saveViewState = (path: string, state: ViewState): void => store().save(path, state)
export const flushViewState = (): Promise<void> => store().flush()
