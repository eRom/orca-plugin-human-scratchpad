// Éditeur de base : CodeMirror 6 en markdown brut, sans rendu.
// La colorisation (thème, décorations) arrive par `opts.extensions` ; les langages des blocs de code sont branchés ici.

import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { deleteMarkupBackward, insertNewlineContinueMarkup, markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { search, searchKeymap } from '@codemirror/search'
import { Annotation, EditorState, Prec, Transaction, type Extension } from '@codemirror/state'
import { drawSelection, EditorView, highlightActiveLine, keymap } from '@codemirror/view'
import type { FormatResult } from './format-commands'
import { codeLanguages } from './languages'
import { minimalChange } from './minimal-change'

/**
 * `scrollTop` est le défilement en pixels ; `topPos` est le début de la ligne affichée en haut de la vue.
 * Dans un long document, la hauteur des lignes non affichées n'est qu'estimée : les pixels d'une session ne
 * valent plus ceux de la suivante, alors que la ligne reste la bonne. `topPos` prime à la restauration ;
 * `topOffset` est la part de cette ligne déjà défilée au-dessus de la vue (un paragraphe replié en occupe plusieurs).
 */
export type ViewState = { anchor: number; head: number; scrollTop: number; topPos?: number; topOffset?: number }

export type ScratchpadEditor = {
  getText(): string
  /** Applique un texte venu du disque en un changement minimal, sans le signaler comme frappe locale. */
  applyExternal(text: string): void
  /** Changement de fichier : remplace le document et remet l'historique d'annulation à zéro. */
  replaceAll(text: string): void
  /** Résultat d'une commande de mise en forme : texte complet et nouvelle sélection (tâche 8). */
  applyFormatResult(r: FormatResult): void
  getViewState(): ViewState
  /** Restaure sélection et défilement, bornés au document. */
  restoreViewState(s: ViewState): void
  focus(): void
}

export type EditorOptions = {
  doc: string
  /** Thème de colorisation (scratchpadTheme) et tout ajout propre à l'appelant. */
  extensions: Extension[]
  /** Appelé seulement pour les transactions qui ne sont pas `external`. */
  onLocalChange(): void
  onViewChange(): void
}

// Marque les transactions issues du disque : elles ne comptent ni comme frappe ni dans l'historique.
const external = Annotation.define<boolean>()

// Habillage structurel et couleurs de base, uniquement à partir des variables `--orca-*`.
const baseTheme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--orca-foreground)',
    backgroundColor: 'var(--orca-background)',
    fontSize: '13px',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--orca-font-mono)', lineHeight: '1.6', overflow: 'auto' },
  '.cm-content': { padding: '10px 0', caretColor: 'var(--orca-foreground)' },
  '.cm-line': { padding: '0 12px' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--orca-foreground)' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--orca-muted) 45%, transparent)' },
  '.cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'color-mix(in srgb, var(--orca-primary) 28%, transparent)',
  },
  '.cm-panels': {
    backgroundColor: 'var(--orca-card)',
    color: 'var(--orca-card-foreground)',
    borderColor: 'var(--orca-border)',
    fontFamily: 'var(--orca-font-sans)',
  },
  '.cm-panels input, .cm-panels button': {
    fontFamily: 'var(--orca-font-sans)',
    color: 'var(--orca-foreground)',
    backgroundColor: 'var(--orca-secondary)',
    border: '1px solid var(--orca-border)',
    borderRadius: 'var(--orca-radius)',
  },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--orca-primary) 22%, transparent)' },
  '.cm-searchMatch-selected': { backgroundColor: 'color-mix(in srgb, var(--orca-primary) 45%, transparent)' },
})

function baseExtensions(): Extension[] {
  return [
    // Entrée continue les listes, Retour arrière retire le marqueur : prioritaires sur le clavier par défaut.
    Prec.high(keymap.of([
      { key: 'Enter', run: insertNewlineContinueMarkup },
      { key: 'Backspace', run: deleteMarkupBackward },
    ])),
    markdown({ base: markdownLanguage, codeLanguages, addKeymap: false }),
    history(),
    drawSelection(),
    EditorState.allowMultipleSelections.of(true),
    EditorView.lineWrapping,
    highlightActiveLine(),
    search({ top: true }),
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
    EditorView.contentAttributes.of({ 'aria-label': 'Scratchpad editor', spellcheck: 'false' }),
    baseTheme,
  ]
}

const MAX_RESTORE_FRAMES = 12

const clamp = (value: number, max: number): number => Math.min(Math.max(Math.trunc(value) || 0, 0), max)

export function createEditor(parent: HTMLElement, opts: EditorOptions): ScratchpadEditor {
  const extensions: Extension[] = [
    ...baseExtensions(),
    ...opts.extensions,
    EditorView.updateListener.of((update) => {
      if (update.docChanged && !update.transactions.some((tr) => tr.annotation(external))) opts.onLocalChange()
      if (!restoring && (update.docChanged || update.selectionSet)) opts.onViewChange()
    }),
  ]
  // Pendant une restauration, les déplacements sont ceux de l'éditeur lui-même : on ne les enregistre pas.
  let restoring = false
  let restoreToken = 0
  const makeState = (doc: string): EditorState => EditorState.create({ doc, extensions })
  const view = new EditorView({ state: makeState(opts.doc), parent })
  view.scrollDOM.addEventListener('scroll', () => !restoring && opts.onViewChange(), { passive: true })

  const getText = (): string => view.state.doc.toString()

  return {
    getText,

    applyExternal(text) {
      const change = minimalChange(getText(), text)
      if (!change) return
      view.dispatch({
        changes: change,
        // Ni frappe locale ni entrée d'historique : ⌘Z n'annule jamais le texte d'un agent.
        annotations: [external.of(true), Transaction.addToHistory.of(false)],
      })
    },

    replaceAll(text) {
      // Un état neuf remet l'historique à zéro, comme le veut un changement de fichier.
      view.setState(makeState(text))
    },

    applyFormatResult(result) {
      const change = minimalChange(getText(), result.text)
      const max = result.text.length
      view.dispatch({
        changes: change ?? undefined,
        selection: { anchor: clamp(result.from, max), head: clamp(result.to, max) },
        scrollIntoView: true,
        userEvent: 'input.format',
      })
    },

    getViewState() {
      const { anchor, head } = view.state.selection.main
      const scrollTop = view.scrollDOM.scrollTop
      const height = scrollTop - view.documentPadding.top
      const block = view.lineBlockAtHeight(height)
      return { anchor, head, scrollTop, topPos: block.from, topOffset: Math.max(0, height - block.top) }
    },

    restoreViewState(state) {
      const max = view.state.doc.length
      const token = ++restoreToken
      restoring = true
      const selection = { anchor: clamp(state.anchor, max), head: clamp(state.head, max) }
      // Libère l'enregistrement quelques images plus tard : les événements de défilement déjà en file passent avant.
      const release = (): void => {
        let frames = 3
        const tick = (): void => {
          if (token !== restoreToken) return
          if (--frames > 0) requestAnimationFrame(tick)
          else restoring = false
        }
        requestAnimationFrame(tick)
      }

      if (state.topPos !== undefined) {
        // CodeMirror affine lui-même les hauteurs pendant la mesure et amène la ligne en haut.
        view.dispatch({
          selection,
          effects: EditorView.scrollIntoView(clamp(state.topPos, max), { y: 'start', yMargin: -Math.max(0, state.topOffset ?? 0) }),
        })
        release()
        return
      }

      view.dispatch({ selection })
      const scrollTop = Math.max(0, state.scrollTop || 0)
      // Sans ligne de référence : on repose le défilement à chaque image, jusqu'à ce qu'il tienne.
      let frames = 0
      const settle = (): void => {
        // Une restauration plus récente a pris le relais : celle-ci s'arrête sans rien défaire.
        if (token !== restoreToken) return
        view.scrollDOM.scrollTop = scrollTop
        if (Math.abs(view.scrollDOM.scrollTop - scrollTop) > 1 && frames++ < MAX_RESTORE_FRAMES) {
          requestAnimationFrame(settle)
          return
        }
        release()
      }
      view.requestMeasure({ read: () => null, write: settle })
    },

    focus() {
      view.focus()
    },
  }
}
