// Limites et constantes partagées entre le worker et le panneau.

export const SCRATCHPAD_MAX_BYTES = 50_000
export const READ_MAX_BYTES = 900_000 // marge sous la réponse de 1 Mio
export const DEFAULT_FILE_NAME = 'orca-scratchpad.md'
export const SAVE_DEBOUNCE_MS = 1000 // la tâche 3 peut le ramener à 300
export const SAVE_MAX_WAIT_MS = 5000
export const POLL_INTERVAL_MS = 2000

const encoder = new TextEncoder()

/** Taille en octets UTF-8 d'un texte. */
export function utf8Bytes(text: string): number {
  return encoder.encode(text).byteLength
}
