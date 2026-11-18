// Limites et constantes partagées entre le worker et le panneau.

export const SCRATCHPAD_MAX_BYTES = 50_000
export const READ_MAX_BYTES = 900_000 // marge sous la réponse de 1 Mio
export const DEFAULT_FILE_NAME = 'orca-scratchpad.md'
export const SAVE_DEBOUNCE_MS = 300 // mesuré en tâche 3 : aucun événement de sortie n'arrive au démontage
// Attente maximale = debounce : le minuteur devient un throttle, une écriture au moins toutes les 300 ms même en pleine frappe
// (mesuré en revue finale : avec 5 s, une rafale continue restait entièrement en mémoire jusqu'au démontage).
export const SAVE_MAX_WAIT_MS = 300
// Brouillon gardé dans orca.storage pendant que l'enregistrement est suspendu ; la valeur stockée est plafonnée à 256 Kio par Orca.
export const DRAFT_DEBOUNCE_MS = 300
export const DRAFT_MAX_JSON_BYTES = 250_000
export const POLL_INTERVAL_MS = 2000

const encoder = new TextEncoder()

/** Taille en octets UTF-8 d'un texte. */
export function utf8Bytes(text: string): number {
  return encoder.encode(text).byteLength
}
