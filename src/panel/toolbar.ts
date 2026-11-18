// Barre d'outils markdown, au même visuel que celle de l'éditeur riche d'Orca.
// Les icônes sont des éléments SVG construits par lucide ; B, I et S sont des glyphes de texte, comme dans Orca.

import { Heading1, Heading2, Heading3, Link, List, ListOrdered, ListTodo, Pilcrow, Quote, createElement } from 'lucide'
import type { FormatCommand } from './format-commands'

type Icon = Parameters<typeof createElement>[0]
type ToolbarItem = { command: FormatCommand; label: string; icon?: Icon; glyph?: string }

const ICON_SIZE = 14
// Délai d'Orca avant l'infobulle (TooltipProvider, delayDuration).
const TOOLTIP_DELAY_MS = 600
const TOOLTIP_GAP = 4

// Quatre groupes, séparés par un trait vertical, dans l'ordre d'Orca.
const GROUPS: ToolbarItem[][] = [
  [
    { command: 'paragraph', label: 'Body text', icon: Pilcrow },
    { command: 'heading1', label: 'Heading 1', icon: Heading1 },
    { command: 'heading2', label: 'Heading 2', icon: Heading2 },
    { command: 'heading3', label: 'Heading 3', icon: Heading3 },
  ],
  [
    { command: 'bold', label: 'Bold', glyph: 'B' },
    { command: 'italic', label: 'Italic', glyph: 'I' },
    { command: 'strike', label: 'Strike', glyph: 'S' },
  ],
  [
    { command: 'bulletList', label: 'Bullet list', icon: List },
    { command: 'orderedList', label: 'Numbered list', icon: ListOrdered },
    { command: 'taskList', label: 'Checklist', icon: ListTodo },
  ],
  [
    { command: 'quote', label: 'Quote', icon: Quote },
    { command: 'link', label: 'Link', icon: Link },
  ],
]

/** Infobulle unique, positionnée en `fixed` sous le bouton et recadrée dans la fenêtre. */
function createTooltip(doc: Document): { show(button: HTMLElement): void; hide(): void } {
  const tip = doc.createElement('div')
  tip.className = 'toolbar-tooltip'
  tip.setAttribute('role', 'tooltip')
  tip.hidden = true
  const arrow = doc.createElement('span')
  arrow.className = 'toolbar-tooltip-arrow'
  const text = doc.createElement('span')
  tip.append(text, arrow)
  doc.body.append(tip)

  let timer = 0
  const hide = (): void => {
    window.clearTimeout(timer)
    tip.hidden = true
  }
  const place = (button: HTMLElement): void => {
    text.textContent = button.getAttribute('aria-label') ?? ''
    tip.hidden = false
    const rect = button.getBoundingClientRect()
    const width = tip.offsetWidth
    const margin = 4
    const center = rect.left + rect.width / 2
    const left = Math.min(Math.max(center - width / 2, margin), Math.max(margin, window.innerWidth - width - margin))
    tip.style.left = `${left}px`
    tip.style.top = `${rect.bottom + TOOLTIP_GAP}px`
    // La flèche reste sous le bouton même quand l'infobulle est décalée par le bord de la fenêtre.
    arrow.style.left = `${center - left}px`
  }
  return {
    show(button) {
      hide()
      timer = window.setTimeout(() => place(button), TOOLTIP_DELAY_MS)
    },
    hide,
  }
}

function createButton(doc: Document, item: ToolbarItem, tooltip: ReturnType<typeof createTooltip>, onCommand: (command: FormatCommand) => void): HTMLButtonElement {
  const button = doc.createElement('button')
  button.type = 'button'
  button.className = 'toolbar-button'
  button.setAttribute('aria-label', item.label)
  if (item.icon) button.append(createElement(item.icon, { width: ICON_SIZE, height: ICON_SIZE }))
  else button.textContent = item.glyph ?? ''
  // Garde la sélection et le focus dans l'éditeur : sans cela le clic les volerait.
  button.addEventListener('mousedown', (event) => {
    event.preventDefault()
    tooltip.hide()
  })
  button.addEventListener('click', () => onCommand(item.command))
  button.addEventListener('mouseenter', () => tooltip.show(button))
  button.addEventListener('mouseleave', tooltip.hide)
  // Au clavier seulement : un focus rendu après un clic souris ne doit pas faire surgir l'infobulle.
  button.addEventListener('focus', () => button.matches(':focus-visible') && tooltip.show(button))
  button.addEventListener('blur', tooltip.hide)
  return button
}

export function renderToolbar(parent: HTMLElement, onCommand: (command: FormatCommand) => void): void {
  const doc = parent.ownerDocument
  const tooltip = createTooltip(doc)
  const row = doc.createElement('div')
  row.className = 'toolbar'
  row.setAttribute('role', 'toolbar')
  row.setAttribute('aria-label', 'Markdown formatting')

  const groups = GROUPS.map((items, index) => {
    const group = doc.createElement('div')
    group.className = 'toolbar-group'
    if (index > 0) {
      const separator = doc.createElement('div')
      separator.className = 'toolbar-separator'
      group.append(separator)
    }
    for (const item of items) group.append(createButton(doc, item, tooltip, onCommand))
    return group
  })
  row.append(...groups)
  parent.replaceChildren(row)

  // Panneau étroit : un groupe passé à la ligne suivante perd son séparateur de tête (il serait orphelin).
  const markWrapped = (): void => {
    groups.forEach((group, index) => {
      if (index > 0) group.toggleAttribute('data-wrapped', group.offsetTop > groups[index - 1].offsetTop)
    })
  }
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(markWrapped).observe(row)
  markWrapped()
}
