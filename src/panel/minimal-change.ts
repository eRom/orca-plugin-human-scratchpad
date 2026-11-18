// Diff minimal entre deux textes : un seul remplacement, sans jamais couper une paire de substitution UTF-16.

export type TextChange = { from: number; to: number; insert: string }

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff
}

/**
 * Calcule le changement unique qui transforme `oldText` en `newText` :
 * préfixe commun, puis suffixe commun sans chevauchement, puis remplacement du milieu.
 * Renvoie `null` si les deux textes sont identiques.
 */
export function minimalChange(oldText: string, newText: string): TextChange | null {
  if (oldText === newText) return null
  const max = Math.min(oldText.length, newText.length)
  let prefix = 0
  while (prefix < max && oldText.charCodeAt(prefix) === newText.charCodeAt(prefix)) prefix++
  // Ne jamais couper une paire de substitution UTF-16.
  if (prefix > 0 && isHighSurrogate(oldText.charCodeAt(prefix - 1))) prefix--
  let suffix = 0
  const maxSuffix = max - prefix
  while (
    suffix < maxSuffix &&
    oldText.charCodeAt(oldText.length - 1 - suffix) === newText.charCodeAt(newText.length - 1 - suffix)
  ) suffix++
  if (suffix > 0 && isLowSurrogate(oldText.charCodeAt(oldText.length - suffix))) suffix--
  return { from: prefix, to: oldText.length - suffix, insert: newText.slice(prefix, newText.length - suffix) }
}
