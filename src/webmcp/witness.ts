/**
 * Témoin d'appels.
 *
 * Sert uniquement à voir, à l'œil nu, qu'un agent a appelé un outil : le banc
 * d'essai affiche le compteur en direct. Aucune logique métier n'en dépend, et
 * rien ici n'est persisté — un rechargement remet à zéro, ce qui est
 * exactement ce qu'on veut avant un test.
 */

type Call = { tool: string; at: number; refused: boolean }

let calls: Call[] = []
const listeners = new Set<() => void>()

export function recordCall(tool: string, refused: boolean): void {
  calls = [...calls, { tool, at: Date.now(), refused }]
  for (const listener of listeners) listener()
}

export function getCalls(): readonly Call[] {
  return calls
}

export function onCall(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function resetCalls(): void {
  calls = []
  for (const listener of listeners) listener()
}
