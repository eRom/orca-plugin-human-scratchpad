// Interface autour de l'éditeur : en-tête, bandeaux, pied et état d'erreur bloquante.
// La structure HTML est dans `panel/index.html` ; ce module ne fait que la piloter.

import { SCRATCHPAD_MAX_BYTES } from '../shared/limits'
import type { BlockingErrorStyle, SwitchBlock } from './switch-guard'
import type { SyncState } from './sync'

export type FooterDot = 'saved' | 'pending' | 'saving' | 'error' | 'missing'
export type FooterInfo = { dot: FooterDot; label: string; retry: boolean }

/** Taille lisible en unités décimales, arrondie vers le haut : 50 001 octets ne s'affiche jamais « 50 KB ». */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`
  return `${Math.ceil(bytes / 100) / 10} KB`
}

export function fullBannerText(bytes: number): string {
  return `Scratchpad full (${formatBytes(bytes)} / ${formatBytes(SCRATCHPAD_MAX_BYTES)}): delete some text to resume saving`
}

/** Libellé et pastille du pied. Priorité : erreur, puis fichier absent au repos, puis état d'enregistrement. */
export function describeFooter(state: SyncState, isDefault: boolean): FooterInfo {
  if (state.status === 'error' && state.error) return { dot: 'error', label: state.error.message, retry: true }
  if (state.missing && state.status === 'saved') {
    const label = isDefault ? 'File was deleted, typing will recreate it' : 'File not found'
    return { dot: 'missing', label, retry: false }
  }
  switch (state.status) {
    case 'pending':
      return { dot: 'pending', label: 'Editing…', retry: false }
    case 'saving':
      return { dot: 'saving', label: 'Saving…', retry: false }
    case 'error':
      return { dot: 'error', label: 'Something went wrong', retry: true }
    default:
      return { dot: 'saved', label: 'Saved', retry: false }
  }
}

/** Texte du bandeau qui explique pourquoi le changement de fichier attend. */
export function switchBlockMessage(block: SwitchBlock): string {
  switch (block) {
    case 'conflict':
      return 'File setting changed: resolve the conflict above to open the new file'
    case 'full':
      return 'File setting changed: delete some text to open the new file'
    case 'error':
      return "Can't switch files: unsaved changes could not be saved"
  }
}

export type ChromeHandlers = { onKeepMine(): void; onReload(): void; onRetry(): void; onBlockingRetry(): void }

export type Chrome = {
  /** Conteneur où l'éditeur se monte. */
  editorHost: HTMLElement
  setPath(displayPath: string): void
  render(state: SyncState, info: { isDefault: boolean }): void
  setSize(bytes: number): void
  /** Bandeau « plein » : affiché tant que le texte dépasse le plafond, y compris à l'ouverture d'un fichier déjà trop gros. */
  setFull(bytes: number | null): void
  /** Un changement de fichier attend : le bandeau en dit la raison (`null` le retire). */
  setSwitchPending(block: SwitchBlock | null): void
  /** Affiche l'éditeur (sort de l'état d'erreur bloquante). */
  showEditor(): void
  /** Remplace tout le panneau, sous l'en-tête, par le message, avec l'indication des réglages ou un bouton Retry. */
  showBlockingError(message: string, style: BlockingErrorStyle): void
  /** Lève le masquage du démarrage. */
  reveal(): void
}

function byId<T extends HTMLElement>(doc: Document, id: string): T {
  const element = doc.getElementById(id)
  if (!element) throw new Error(`panel markup is missing #${id}`)
  return element as T
}

export function createChrome(doc: Document, handlers: ChromeHandlers): Chrome {
  const app = byId(doc, 'app')
  const pathLabel = byId(doc, 'path')
  const conflictBanner = byId(doc, 'conflict-banner')
  const fullBanner = byId(doc, 'full-banner')
  const fullText = byId(doc, 'full-text')
  const switchBanner = byId(doc, 'switch-banner')
  const switchText = byId(doc, 'switch-text')
  const blockingHint = byId(doc, 'blocking-hint')
  const blockingRetry = byId(doc, 'blocking-retry')
  const blockingMessage = byId(doc, 'blocking-message')
  const dot = byId(doc, 'status-dot')
  const statusLabel = byId(doc, 'status-label')
  const retryButton = byId(doc, 'retry')
  const sizeLabel = byId(doc, 'size')

  byId(doc, 'keep-mine').addEventListener('click', () => handlers.onKeepMine())
  byId(doc, 'reload').addEventListener('click', () => handlers.onReload())
  retryButton.addEventListener('click', () => handlers.onRetry())
  blockingRetry.addEventListener('click', () => handlers.onBlockingRetry())

  return {
    editorHost: byId(doc, 'editor'),

    setPath(displayPath) {
      pathLabel.textContent = displayPath
      pathLabel.title = displayPath
    },

    render(state, { isDefault }) {
      conflictBanner.hidden = state.conflict === null
      const footer = describeFooter(state, isDefault)
      dot.dataset.state = footer.dot
      statusLabel.textContent = footer.label
      statusLabel.title = footer.label
      retryButton.hidden = !footer.retry
    },

    setSize(bytes) {
      sizeLabel.textContent = formatBytes(bytes)
    },

    setFull(bytes) {
      fullBanner.hidden = bytes === null
      if (bytes !== null) fullText.textContent = fullBannerText(bytes)
    },

    setSwitchPending(block) {
      switchBanner.hidden = block === null
      if (block !== null) switchText.textContent = switchBlockMessage(block)
    },

    showEditor() {
      app.dataset.mode = 'editor'
    },

    showBlockingError(message, style) {
      blockingMessage.textContent = message
      blockingHint.hidden = !style.hint
      blockingRetry.hidden = !style.retry
      app.dataset.mode = 'error'
      switchBanner.hidden = true
    },

    reveal() {
      doc.body.classList.remove('booting')
    },
  }
}
