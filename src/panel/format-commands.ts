// Commandes de mise en forme markdown : fonctions pures, sans CodeMirror.
// La barre d'outils les applique à la sélection principale (tâche 8).

export type FormatCommand =
  | 'paragraph' | 'heading1' | 'heading2' | 'heading3'
  | 'bold' | 'italic' | 'strike'
  | 'bulletList' | 'orderedList' | 'taskList' | 'quote' | 'link'

export type FormatResult = { text: string; from: number; to: number }

type MarkerKind = 'heading' | 'task' | 'bullet' | 'ordered' | 'quote' | 'none'

// Une ligne découpée en indentation, marqueur reconnu et reste du texte.
type ParsedLine = { kind: MarkerKind; level: number; indent: string; marker: string }

const HEADING_RE = /^(#{1,6}) /
const TASK_RE = /^(\s*)[-*+] \[[ xX]\] /
const BULLET_RE = /^(\s*)[-*+] /
const ORDERED_RE = /^(\s*)\d+[.)] /
const QUOTE_RE = /^> ?/

function parseLine(line: string): ParsedLine {
  let m = HEADING_RE.exec(line)
  if (m) return { kind: 'heading', level: m[1].length, indent: '', marker: m[0] }
  m = TASK_RE.exec(line)
  if (m) return { kind: 'task', level: 0, indent: m[1], marker: m[0].slice(m[1].length) }
  m = BULLET_RE.exec(line)
  if (m) return { kind: 'bullet', level: 0, indent: m[1], marker: m[0].slice(m[1].length) }
  m = ORDERED_RE.exec(line)
  if (m) return { kind: 'ordered', level: 0, indent: m[1], marker: m[0].slice(m[1].length) }
  m = QUOTE_RE.exec(line)
  if (m) return { kind: 'quote', level: 0, indent: '', marker: m[0] }
  return { kind: 'none', level: 0, indent: '', marker: '' }
}

const isList = (kind: MarkerKind): boolean => kind === 'task' || kind === 'bullet' || kind === 'ordered'

const HEADING_LEVELS: Record<string, number> = { heading1: 1, heading2: 2, heading3: 3 }

// Famille de marqueurs qu'une commande de ligne remplace ou bascule.
function belongsToFamily(command: FormatCommand, kind: MarkerKind): boolean {
  switch (command) {
    case 'heading1':
    case 'heading2':
    case 'heading3':
      return kind === 'heading'
    case 'quote':
      return kind === 'quote'
    default:
      return isList(kind)
  }
}

// La commande est-elle déjà posée sur cette ligne (pour un titre, au même niveau) ?
function hasCommandMarker(command: FormatCommand, parsed: ParsedLine): boolean {
  switch (command) {
    case 'heading1':
    case 'heading2':
    case 'heading3':
      return parsed.kind === 'heading' && parsed.level === HEADING_LEVELS[command]
    case 'bulletList':
      return parsed.kind === 'bullet'
    case 'orderedList':
      return parsed.kind === 'ordered'
    case 'taskList':
      return parsed.kind === 'task'
    case 'quote':
      return parsed.kind === 'quote'
    default:
      return false
  }
}

function newMarker(command: FormatCommand, ordinal: number): string {
  switch (command) {
    case 'heading1': return '# '
    case 'heading2': return '## '
    case 'heading3': return '### '
    case 'bulletList': return '- '
    case 'orderedList': return `${ordinal}. `
    case 'taskList': return '- [ ] '
    case 'quote': return '> '
    default: return ''
  }
}

type LineEdit = { start: number; text: string; prefixBefore: number; prefixAfter: number }

function applyLineCommand(command: FormatCommand, doc: string, from: number, to: number): FormatResult {
  const lines = doc.split('\n')
  const starts: number[] = []
  let offset = 0
  for (const line of lines) {
    starts.push(offset)
    offset += line.length + 1
  }
  const lineOf = (pos: number): number => {
    let index = 0
    while (index + 1 < lines.length && starts[index + 1] <= pos) index++
    return index
  }
  const first = lineOf(from)
  const last = lineOf(to)

  // Plusieurs lignes touchées : les lignes vides sont ignorées. Une ligne seule est toujours traitée.
  const targeted = new Set<number>()
  for (let i = first; i <= last; i++) {
    if (first === last || lines[i].trim() !== '') targeted.add(i)
  }

  const parsed = lines.map(parseLine)
  const toggleOff = command !== 'paragraph'
    && [...targeted].every((i) => hasCommandMarker(command, parsed[i]))

  const edits: LineEdit[] = []
  let ordinal = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!targeted.has(i)) {
      edits.push({ start: starts[i], text: line, prefixBefore: 0, prefixAfter: 0 })
      continue
    }
    const p = parsed[i]
    let indent: string
    let oldMarker: string
    let replacement: string
    if (command === 'paragraph') {
      // Un seul marqueur retiré : titre, sinon citation, sinon liste.
      indent = p.indent
      oldMarker = p.marker
      replacement = ''
    } else {
      if (belongsToFamily(command, p.kind)) {
        indent = p.indent
        oldMarker = p.marker
      } else {
        // Pas de marqueur de la famille : on pose le nouveau en gardant l'indentation des listes.
        indent = isList(commandKind(command)) ? /^\s*/.exec(line)![0] : ''
        oldMarker = ''
      }
      ordinal++
      replacement = toggleOff ? '' : newMarker(command, ordinal)
    }
    const rest = line.slice(indent.length + oldMarker.length)
    edits.push({
      start: starts[i],
      text: indent + replacement + rest,
      prefixBefore: indent.length + oldMarker.length,
      prefixAfter: indent.length + replacement.length,
    })
  }

  // Début de chaque ligne dans le nouveau texte.
  const newStarts: number[] = []
  let cursor = 0
  for (const edit of edits) {
    newStarts.push(cursor)
    cursor += edit.text.length + 1
  }
  const mapPosition = (pos: number): number => {
    const i = lineOf(pos)
    const { prefixBefore: r, prefixAfter: a } = edits[i]
    const o = pos - starts[i]
    return o < r ? newStarts[i] + a : newStarts[i] + o - r + a
  }

  return {
    text: edits.map((edit) => edit.text).join('\n'),
    from: mapPosition(from),
    to: mapPosition(to),
  }
}

function commandKind(command: FormatCommand): MarkerKind {
  if (command === 'bulletList') return 'bullet'
  if (command === 'orderedList') return 'ordered'
  if (command === 'taskList') return 'task'
  return 'none'
}

const INLINE_MARKERS: Record<string, string> = { bold: '**', italic: '*', strike: '~~' }

function applyInlineCommand(marker: string, doc: string, from: number, to: number): FormatResult {
  const n = marker.length
  const selected = doc.slice(from, to)

  // Marqueurs juste à l'extérieur de la sélection : on les retire.
  if (from >= n && doc.slice(from - n, from) === marker && doc.slice(to, to + n) === marker) {
    return {
      text: doc.slice(0, from - n) + selected + doc.slice(to + n),
      from: from - n,
      to: to - n,
    }
  }
  // La sélection commence et finit par le marqueur : on les retire de l'intérieur.
  if (selected.length >= 2 * n && selected.startsWith(marker) && selected.endsWith(marker)) {
    const inner = selected.slice(n, selected.length - n)
    return {
      text: doc.slice(0, from) + inner + doc.slice(to),
      from,
      to: from + inner.length,
    }
  }
  // Sinon on entoure (sélection vide : paire insérée, curseur au milieu).
  return {
    text: doc.slice(0, from) + marker + selected + marker + doc.slice(to),
    from: from + n,
    to: to + n,
  }
}

function applyLink(doc: string, from: number, to: number): FormatResult {
  const selected = doc.slice(from, to)
  const text = `${doc.slice(0, from)}[${selected}](url)${doc.slice(to)}`
  if (selected === '') return { text, from: from + 1, to: from + 1 }
  const urlStart = from + 1 + selected.length + 2
  return { text, from: urlStart, to: urlStart + 3 }
}

export function applyFormat(command: FormatCommand, doc: string, from: number, to: number): FormatResult {
  switch (command) {
    case 'bold':
    case 'italic':
    case 'strike':
      return applyInlineCommand(INLINE_MARKERS[command], doc, from, to)
    case 'link':
      return applyLink(doc, from, to)
    default:
      return applyLineCommand(command, doc, from, to)
  }
}
