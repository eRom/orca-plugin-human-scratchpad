// Langages des blocs de code markdown, chargés statiquement : tout est empaqueté en un seul `.js`,
// un panneau ne résolvant aucun import dynamique ou nu.

import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { python } from '@codemirror/lang-python'
import { rust } from '@codemirror/lang-rust'
import { yaml } from '@codemirror/lang-yaml'
import { LanguageDescription, LanguageSupport, StreamLanguage } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { shell } from '@codemirror/legacy-modes/mode/shell'

// Le mode shell nomme « def » les variables (affectation et $VAR) : on les range avec les variables spéciales,
// pour qu'elles ressortent sans teinter les déclarations des autres langages. « quote » ($(…), accents graves) devient une chaîne.
const shellSupport = new LanguageSupport(StreamLanguage.define({ ...shell, tokenTable: { def: tags.special(tags.variableName), quote: tags.special(tags.string) } }))

export const codeLanguages: LanguageDescription[] = [
  LanguageDescription.of({ name: 'TypeScript', alias: ['ts', 'typescript'], support: javascript({ typescript: true }) }),
  LanguageDescription.of({ name: 'TSX', alias: ['tsx'], support: javascript({ typescript: true, jsx: true }) }),
  LanguageDescription.of({ name: 'JavaScript', alias: ['js', 'javascript', 'mjs', 'cjs'], support: javascript() }),
  LanguageDescription.of({ name: 'JSX', alias: ['jsx'], support: javascript({ jsx: true }) }),
  LanguageDescription.of({ name: 'JSON', alias: ['json', 'jsonc'], support: json() }),
  LanguageDescription.of({ name: 'Shell', alias: ['bash', 'sh', 'shell', 'zsh'], support: shellSupport }),
  LanguageDescription.of({ name: 'Python', alias: ['py', 'python'], support: python() }),
  LanguageDescription.of({ name: 'Rust', alias: ['rs', 'rust'], support: rust() }),
  LanguageDescription.of({ name: 'CSS', alias: ['css'], support: css() }),
  LanguageDescription.of({ name: 'HTML', alias: ['html', 'htm'], support: html() }),
  LanguageDescription.of({ name: 'YAML', alias: ['yaml', 'yml'], support: yaml() }),
]
