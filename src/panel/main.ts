// Point d'entrée du panneau : branche l'éditeur, la synchronisation et l'interface.

import { POLL_INTERVAL_MS, SAVE_DEBOUNCE_MS, SAVE_MAX_WAIT_MS, SCRATCHPAD_MAX_BYTES, utf8Bytes } from '../shared/limits'
import type { ReadOutput, ResolveOutput } from '../protocol'
import { createChrome } from './chrome'
import { createEditor, type ScratchpadEditor, type ViewState } from './editor'
import { frameFileApi } from './file-api'
import { createSync, type Sync, type SyncState, type Timers } from './sync'
import { flushViewState, loadViewState, saveViewState } from './view-state'

type ResolvedFile = Extract<ResolveOutput, { status: 'ok' }>
type FileRead = Extract<ReadOutput, { status: 'ok' }>
type Session = { path: string; isDefault: boolean; sync: Sync }

const VIEW_SAMPLE_MS = 200
const EMPTY_VIEW: ViewState = { anchor: 0, head: 0, scrollTop: 0 }

const api = frameFileApi(orca)
const timers: Timers = {
  now: () => Date.now(),
  set: (fn, ms) => window.setTimeout(fn, ms),
  clear: (handle) => window.clearTimeout(handle as number),
}

let editor: ScratchpadEditor | null = null
let session: Session | null = null
// Changement de fichier : un seul à la fois, et un réglage modifié pendant l'un déclenche un second passage.
let switching = false
let switchAgain = false
// Le changement est suspendu tant qu'un conflit ou un dépassement de taille n'est pas réglé.
let switchBlocked = false

/** Lance une tâche asynchrone sans jamais laisser un rejet non traité remonter. */
function run(task: () => Promise<unknown> | unknown): void {
  void (async () => task())().catch((error) => console.error('scratchpad: unexpected error', error))
}

const chrome = createChrome(document, {
  onKeepMine: () => run(() => session?.sync.keepMine()),
  onReload: () => run(() => session?.sync.reload()),
  onRetry: () =>
    run(async () => {
      // Réessaie l'écriture en attente, puis relit l'état du disque si l'erreur venait d'un poll.
      await session?.sync.flush()
      await session?.sync.poll()
    }),
})

// La taille affichée suit le texte, y compris après une frappe ou un ajout externe.
let sizeFrame = 0
function refreshSize(): void {
  if (sizeFrame || !editor) return
  sizeFrame = window.requestAnimationFrame(() => {
    sizeFrame = 0
    if (!editor) return
    const bytes = utf8Bytes(editor.getText())
    chrome.setSize(bytes)
    chrome.setFull(bytes > SCRATCHPAD_MAX_BYTES ? bytes : null)
  })
}

function showBlockingError(message: string, displayPath = ''): void {
  chrome.setPath(displayPath)
  chrome.showBlockingError(message)
}

/** Deux images d'attente : l'éditeur a eu sa mesure, le défilement restauré tient. */
function nextFrames(): Promise<void> {
  return new Promise((done) => {
    // Repli : une page masquée ne déclenche pas requestAnimationFrame, et rien n'est visible de toute façon.
    const fallback = window.setTimeout(done, 200)
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => {
        window.clearTimeout(fallback)
        done()
      }),
    )
  })
}

function mountSession(resolved: ResolvedFile, read: FileRead): void {
  const current: Session = {
    path: resolved.path,
    isDefault: resolved.isDefault,
    sync: createSync({
      api,
      path: resolved.path,
      base: { version: read.version, mtimeMs: read.mtimeMs, size: read.size },
      getText: () => editor?.getText() ?? '',
      applyExternal: (text) => {
        editor?.applyExternal(text)
        refreshSize()
      },
      // Une synchronisation détruite peut encore signaler une écriture en vol : on l'ignore.
      onState: (state) => {
        if (session !== current) return
        chrome.render(state, { isDefault: current.isDefault })
        if (switchBlocked && canSwitch(state)) run(switchFile)
      },
      timers,
      debounceMs: SAVE_DEBOUNCE_MS,
      maxWaitMs: SAVE_MAX_WAIT_MS,
    }),
  }
  session = current
  chrome.setPath(resolved.displayPath)
  chrome.showEditor()
  chrome.render(current.sync.state, { isDefault: current.isDefault })
  refreshSize()
}

const canSwitch = (state: SyncState): boolean => state.conflict === null && state.full === null

// Lire le défilement force une mise en page : on échantillonne l'état de vue au plus une fois par fenêtre
// de 200 ms, au lieu de le faire à chaque frappe (la mise en page d'un long document est coûteuse).
let viewSampleTimer = 0
function scheduleViewSample(): void {
  if (viewSampleTimer) return
  viewSampleTimer = window.setTimeout(() => {
    viewSampleTimer = 0
    if (session && editor) saveViewState(session.path, editor.getViewState())
  }, VIEW_SAMPLE_MS)
}

function createPanelEditor(doc: string): ScratchpadEditor {
  return createEditor(chrome.editorHost, {
    doc,
    extensions: [],
    onLocalChange: () => {
      session?.sync.localChange()
      refreshSize()
    },
    onViewChange: scheduleViewSample,
  })
}

async function start(): Promise<void> {
  const resolved = await api.resolve()
  if (resolved.status === 'error') return showBlockingError(resolved.message)
  const read = await api.read(resolved.path)
  if (read.status === 'error') return showBlockingError(read.message, resolved.displayPath)
  const viewState = (await loadViewState(resolved.path)) ?? EMPTY_VIEW

  // Éditeur créé avec le contenu déjà chargé et l'état de vue restauré, avant tout rendu visible.
  editor = createPanelEditor(read.content)
  editor.restoreViewState(viewState)
  mountSession(resolved, read)
  await nextFrames()
}

/** Bascule sur le fichier désigné par le réglage `filePath`, sans jamais perdre ni écraser de texte. */
async function switchOnce(): Promise<void> {
  const resolved = await api.resolve()
  if (resolved.status === 'ok' && session && resolved.path === session.path) {
    // Même fichier (par exemple réglage vidé puis défaut explicite) : rien à faire.
    switchBlocked = false
    chrome.setSwitchPending(false)
    chrome.setPath(resolved.displayPath)
    return
  }

  // Tout l'asynchrone du nouveau fichier se fait avant le vidage de l'ancien : entre le vidage et
  // l'échange, plus aucun await, donc aucune frappe ne peut tomber dans le vide.
  const read = resolved.status === 'ok' ? await api.read(resolved.path) : null
  const viewState = resolved.status === 'ok' && read?.status === 'ok' ? ((await loadViewState(resolved.path)) ?? EMPTY_VIEW) : EMPTY_VIEW

  if (session) {
    // Enregistre d'abord le fichier courant, sans force : un conflit se tranche avant de partir.
    await session.sync.flush()
    if (!canSwitch(session.sync.state)) {
      switchBlocked = true
      chrome.setSwitchPending(true)
      return
    }
  }
  switchBlocked = false
  chrome.setSwitchPending(false)

  const closing = session
  if (closing && editor) saveViewState(closing.path, editor.getViewState())
  session = null
  closing?.sync.dispose()
  void flushViewState()

  if (resolved.status === 'error') return showBlockingError(resolved.message)
  if (read?.status === 'error') return showBlockingError(read.message, resolved.displayPath)
  if (read === null) return
  if (editor) editor.replaceAll(read.content)
  else editor = createPanelEditor(read.content)
  editor.restoreViewState(viewState)
  mountSession(resolved, read)
}

async function switchFile(): Promise<void> {
  if (switching) {
    switchAgain = true
    return
  }
  switching = true
  try {
    do {
      switchAgain = false
      await switchOnce()
    } while (switchAgain)
  } finally {
    switching = false
  }
}

// Interrogation du disque : seulement quand le panneau est visible, et tout de suite à son retour.
window.setInterval(() => {
  if (!document.hidden) run(() => session?.sync.poll())
}, POLL_INTERVAL_MS)
document.addEventListener('visibilitychange', () => {
  run(() => (document.hidden ? session?.sync.flush() : session?.sync.poll()))
})
window.addEventListener('focus', () => run(() => session?.sync.poll()))
// Le démontage par changement de panneau ne déclenche aucun de ces événements (mesuré en tâche 3) :
// la sécurité des données repose sur le debounce court. Ils aident quand la fenêtre se masque.
window.addEventListener('blur', () => run(() => session?.sync.flush()))
window.addEventListener('pagehide', () => run(() => session?.sync.flush()))

orca.settings.onDidChange(({ key }) => {
  if (key === 'filePath') run(switchFile)
})

start()
  .catch((error) => showBlockingError(error instanceof Error ? error.message : String(error)))
  .finally(() => chrome.reveal())
