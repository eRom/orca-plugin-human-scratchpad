// Limites et constantes partagées entre le worker et le panneau.

export const SCRATCHPAD_MAX_BYTES = 50_000
export const READ_MAX_BYTES = 900_000 // marge sous la réponse de 1 Mio
export const DEFAULT_FILE_NAME = 'orca-scratchpad.md'
export const SAVE_DEBOUNCE_MS = 300 // mesuré en tâche 3 : aucun événement de sortie n'arrive au démontage
export const SAVE_MAX_WAIT_MS = 5000
export const POLL_INTERVAL_MS = 2000

const encoder = new TextEncoder()

/** Taille en octets UTF-8 d'un texte. */
export function utf8Bytes(text: string): number {
  return encoder.encode(text).byteLength
}
