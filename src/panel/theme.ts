// Thème de l'éditeur : markdown et code colorés uniquement par des variables CSS.
// `--orca-*` pour la chrome (fournies par Orca), `--sp-syntax-*` pour la syntaxe (définies dans panel/style.css,
// une fois par schéma sous `light` / `dark`) : le changement de thème est instantané, sans recréer l'éditeur.

import { HighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language'
import type { Extension, Range } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'

const syntax = (name: string): string => `var(--sp-syntax-${name})`
const muted = 'var(--orca-muted-foreground)'

const highlightStyle = HighlightStyle.define([
  // Markdown : titres gradués, signes atténués.
  { tag: t.heading1, fontWeight: '700', fontSize: '1.25em' },
  { tag: t.heading2, fontWeight: '700', fontSize: '1.15em' },
  { tag: t.heading3, fontWeight: '700', fontSize: '1.05em' },
  { tag: [t.heading4, t.heading5, t.heading6, t.heading], fontWeight: '700' },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: muted },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: syntax('link'), textDecoration: 'underline' },
  { tag: t.url, color: syntax('link') },
  { tag: t.quote, color: muted, fontStyle: 'italic' },
  { tag: t.labelName, color: muted },

  // Code : huit teintes (mots-clés, chaînes, nombres, commentaires, fonctions, types, propriétés, opérateurs).
  {
    tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword, t.operatorKeyword, t.modifier, t.self, t.tagName],
    color: syntax('keyword'),
  },
  { tag: [t.string, t.special(t.string), t.character, t.regexp, t.attributeValue], color: syntax('string') },
  { tag: [t.number, t.integer, t.float, t.bool, t.null, t.atom, t.unit, t.color, t.escape], color: syntax('number') },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: syntax('comment'), fontStyle: 'italic' },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.function(t.variableName)), t.standard(t.variableName), t.macroName],
    color: syntax('function'),
  },
  { tag: [t.typeName, t.className, t.namespace, t.definition(t.typeName), t.annotation], color: syntax('type') },
  { tag: [t.propertyName, t.definition(t.propertyName), t.attributeName, t.special(t.variableName)], color: syntax('property') },
  {
    tag: [t.operator, t.compareOperator, t.arithmeticOperator, t.logicOperator, t.bitwiseOperator, t.updateOperator, t.derefOperator, t.typeOperator, t.definitionOperator, t.controlOperator],
    color: syntax('operator'),
  },
  { tag: [t.punctuation, t.separator, t.bracket, t.angleBracket], color: muted },
  { tag: t.invalid, color: 'var(--orca-destructive)' },
])

const inlineCode = Decoration.mark({ class: 'cm-sp-inline-code' })
const doneTask = Decoration.mark({ class: 'cm-sp-task-done' })
const ruleLine = Decoration.line({ class: 'cm-sp-rule' })
const fenceLine = Decoration.line({ class: 'cm-sp-fence' })

// Ce que les tags de syntaxe ne peuvent pas dire : un filet sous `---`, un fond pour le code en ligne et
// les blocs clôturés, l'atténuation d'une tâche cochée. Les nœuds viennent de l'arbre markdown.
function markdownDecorations(view: EditorView): DecorationSet {
  const { doc } = view.state
  const found: Range<Decoration>[] = []
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        switch (node.name) {
          case 'HorizontalRule':
            found.push(ruleLine.range(doc.lineAt(node.from).from))
            break
          case 'InlineCode':
            found.push(inlineCode.range(node.from, node.to))
            break
          case 'FencedCode':
            for (let n = doc.lineAt(node.from).number, last = doc.lineAt(node.to).number; n <= last; n++) {
              found.push(fenceLine.range(doc.line(n).from))
            }
            break
          case 'Task': {
            const marker = node.node.getChild('TaskMarker')
            if (marker && /^\[[xX]\]$/.test(doc.sliceString(marker.from, marker.to))) found.push(doneTask.range(node.from, node.to))
            break
          }
        }
      },
    })
  }
  // `sort` : deux visibleRanges voisines peuvent toucher le même nœud, l'ordre n'est donc pas garanti.
  return Decoration.set(found, true)
}

const decorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = markdownDecorations(view)
    }
    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
        this.decorations = markdownDecorations(update.view)
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

const editorTheme = EditorView.theme({
  '.cm-sp-rule': { borderBottom: '1px solid var(--orca-border)' },
  '.cm-sp-fence': { backgroundColor: 'color-mix(in srgb, var(--orca-muted) 55%, transparent)' },
  '.cm-sp-fence.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--orca-muted) 85%, transparent)' },
  '.cm-sp-inline-code': {
    backgroundColor: 'var(--orca-muted)',
    borderRadius: 'var(--orca-radius)',
    padding: '1px 0.25em',
    boxDecorationBreak: 'clone',
  },
  // Les spans de coloration à l'intérieur ont leur propre couleur : on force l'atténuation jusqu'au bout.
  '.cm-sp-task-done, .cm-sp-task-done *': { color: `${muted} !important` },
})

export const scratchpadTheme: Extension[] = [editorTheme, syntaxHighlighting(highlightStyle), decorations]
