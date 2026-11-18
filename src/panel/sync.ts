// Contrôleur de synchronisation pur : décide quand enregistrer, recharger ou lever un conflit.
// Aucune dépendance à CodeMirror ni au DOM : l'API fichier et les minuteurs sont injectés.

import type { FileError, ReadOutput, StatOutput, WriteInput, WriteOutput } from '../protocol'
import { SCRATCHPAD_MAX_BYTES, utf8Bytes } from '../shared/limits'

export type FileApi = {
  stat(path: string): Promise<StatOutput>
  read(path: string): Promise<ReadOutput>
  write(input: WriteInput): Promise<WriteOutput>
}

export type Timers = { now(): number; set(fn: () => void, ms: number): unknown; clear(handle: unknown): void }

export type SyncState = {
  status: 'saved' | 'pending' | 'saving' | 'error'
  conflict: { diskContent: string; diskVersion: string } | null
  full: { bytes: number } | null
  missing: boolean
  error: FileError | null
}

export type SyncOptions = {
  api: FileApi
  path: string
  base: { version: string; mtimeMs: number; size: number }
  getText(): string
  /** L'éditeur applique le texte sans rappeler `localChange`. */
  applyExternal(text: string): void
  onState(state: SyncState): void
  timers: Timers
  debounceMs: number
  maxWaitMs: number
}

export type Sync = {
  localChange(): void
  flush(): Promise<void>
  poll(): Promise<void>
  keepMine(): Promise<void>
  reload(): void
  dispose(): void
  readonly state: SyncState
  /** Version du disque dont le texte local est issu : c'est elle qu'un brouillon doit retenir. */
  readonly baseVersion: string
}

export function createSync(options: SyncOptions): Sync {
  const { api, path, getText, applyExternal, onState, timers, debounceMs, maxWaitMs } = options
  let base = { ...options.base }
  let state: SyncState = { status: 'saved', conflict: null, full: null, missing: false, error: null }

  // Modifications locales : `changes` compte les frappes, `cleanAt` est la valeur déjà sur le disque.
  let changes = 0
  let cleanAt = 0
  // Incrémenté à chaque changement de base : un poll en cours dont la base a bougé abandonne son résultat.
  let baseEpoch = 0
  let timer: { handle: unknown } | null = null
  let burstStart: number | null = null
  let inFlight: Promise<void> | null = null
  // Nombre de flush démarrés et non terminés : ils vont au bout de leur enregistrement même après dispose().
  let flushing = 0
  let disposed = false

  const isDirty = (): boolean => changes !== cleanAt

  function setState(patch: Partial<SyncState>): void {
    const next = { ...state, ...patch }
    if (JSON.stringify(next) === JSON.stringify(state)) return
    state = next
    onState(state)
  }

  function cancelTimer(): void {
    if (timer) {
      timers.clear(timer.handle)
      timer = null
    }
  }

  /** Programme un enregistrement : debounce, borné par l'attente maximale depuis le début de la rafale. */
  function schedule(): void {
    cancelTimer()
    if (disposed) return
    const now = timers.now()
    if (burstStart === null) burstStart = now
    const delay = Math.max(0, Math.min(debounceMs, maxWaitMs - (now - burstStart)))
    const entry: { handle: unknown } = { handle: null }
    entry.handle = timers.set(() => {
      timer = null
      void save()
    }, delay)
    timer = entry
  }

  function raiseConflict(diskContent: string, diskVersion: string): void {
    cancelTimer()
    setState({ conflict: { diskContent, diskVersion }, status: 'pending' })
  }

  function startWrite(content: string, force: boolean): Promise<void> {
    // Le texte et le compteur sont lus dans le même bloc synchrone : ils désignent la même version.
    const sentAt = changes
    burstStart = null
    setState({ status: 'saving', full: null })
    let run!: Promise<void>
    run = (async () => {
      let result: WriteOutput
      try {
        // L'enveloppe async convertit une levée synchrone de l'API en rejet.
        result = await (async () => api.write({ path, content, baseVersion: base.version, force }))()
      } catch (error) {
        result = { status: 'error', code: 'io_error', message: error instanceof Error ? error.message : String(error) }
      }
      // Ce point est toujours atteint après un await : `run` est déjà affecté.
      if (inFlight === run) inFlight = null
      if (!disposed || flushing > 0) onWriteResult(result, sentAt)
    })()
    inFlight = run
    return run
  }

  function onWriteResult(result: WriteOutput, sentAt: number): void {
    if (result.status === 'saved') {
      base = { version: result.version, mtimeMs: result.mtimeMs, size: result.size }
      baseEpoch++
      cleanAt = sentAt
      const stillDirty = isDirty()
      setState({ status: stillDirty ? 'pending' : 'saved', conflict: null, full: null, missing: false, error: null })
      if (stillDirty) schedule()
    } else if (result.status === 'conflict') {
      // La date et la taille du disque sont connues : le prochain poll ne relit pas pour rien.
      base = { ...base, mtimeMs: result.mtimeMs, size: result.size }
      baseEpoch++
      raiseConflict(result.content, result.version)
    } else {
      // La modification reste à enregistrer (cleanAt inchangé) : flush ou la frappe suivante réessaie.
      setState({ status: 'error', error: result })
    }
  }

  /** Enregistre si besoin, sauf conflit ou écriture déjà en vol. */
  async function save(): Promise<void> {
    if ((disposed && flushing === 0) || inFlight || state.conflict) return
    cancelTimer()
    if (!isDirty()) return
    const content = getText()
    const bytes = utf8Bytes(content)
    if (bytes > SCRATCHPAD_MAX_BYTES) {
      // Remise à zéro de la rafale : au-dessus du plafond, on ne mesure pas 50 Ko à chaque frappe.
      burstStart = null
      setState({ full: { bytes }, status: 'pending' })
      return
    }
    await startWrite(content, false)
  }

  /** Retour à un état propre après une lecture ou un poll réussi. */
  function settleIfClean(): void {
    if (!isDirty() && state.status === 'error') setState({ status: 'saved', error: null })
  }

  const sync: Sync = {
    get state() {
      return state
    },

    get baseVersion() {
      return base.version
    },

    localChange() {
      if (disposed) return
      changes++
      // Déjà « pending » : rien ne change, et on évite de sérialiser l'état (un conflit y porte tout le texte du disque).
      if (state.status !== 'pending') setState({ status: 'pending' })
      if (state.conflict) return
      if (inFlight) {
        // L'enregistrement suivant est programmé à la fin du vol ; la rafale démarre maintenant.
        if (burstStart === null) burstStart = timers.now()
        return
      }
      schedule()
    },

    async flush() {
      if (disposed) return
      flushing++
      try {
        cancelTimer()
        while (inFlight) await inFlight
        await save()
      } finally {
        flushing--
      }
    },

    async poll() {
      if (disposed || inFlight) return
      // Une écriture en erreur n'a pas de minuteur de reprise : le poll la retente (sans conflit, sous le plafond).
      if (state.status === 'error' && isDirty() && !state.conflict) {
        await save()
        return
      }
      const epoch = baseEpoch
      const stat = await api.stat(path)
      if (disposed || inFlight || epoch !== baseEpoch) return
      if (stat.status === 'error') {
        setState({ status: 'error', error: stat })
        return
      }
      if (!stat.exists) {
        // Jamais d'applyExternal ici : un fichier absent ne doit pas vider l'éditeur.
        setState({ missing: true })
        return
      }
      setState({ missing: false })
      if (stat.mtimeMs === base.mtimeMs && stat.size === base.size) {
        settleIfClean()
        return
      }
      const read = await api.read(path)
      if (disposed || inFlight || epoch !== baseEpoch) return
      if (read.status === 'error') {
        setState({ status: 'error', error: read })
        return
      }
      base = { ...base, mtimeMs: read.mtimeMs, size: read.size }
      if (read.version === base.version) {
        settleIfClean()
        return
      }
      if (isDirty()) {
        raiseConflict(read.content, read.version)
        return
      }
      base = { version: read.version, mtimeMs: read.mtimeMs, size: read.size }
      baseEpoch++
      applyExternal(read.content)
      settleIfClean()
    },

    async keepMine() {
      if (disposed || inFlight || !state.conflict) return
      const content = getText()
      const bytes = utf8Bytes(content)
      if (bytes > SCRATCHPAD_MAX_BYTES) {
        setState({ full: { bytes } })
        return
      }
      await startWrite(content, true)
    },

    reload() {
      if (disposed || inFlight || !state.conflict) return
      const { diskContent, diskVersion } = state.conflict
      cancelTimer()
      burstStart = null
      // Date et taille inconnues : le prochain poll relit, retrouve la même version et les met à jour.
      base = { version: diskVersion, mtimeMs: -1, size: -1 }
      baseEpoch++
      applyExternal(diskContent)
      // Après applyExternal : un écho de l'éditeur ne doit pas laisser de modification en attente.
      cleanAt = changes
      setState({ conflict: null, status: 'saved', full: null, error: null })
    },

    dispose() {
      disposed = true
      cancelTimer()
    },
  }
  return sync
}
