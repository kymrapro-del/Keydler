/**
 * Témoin d'appels.
 *
 * Sert uniquement à voir, à l'œil nu, qu'un agent a appelé un outil : le banc
 * affiche le compteur en direct. Aucune logique métier n'en dépend, et rien
 * n'est persisté — un rechargement remet à zéro, ce qui est exactement ce qu'on
 * veut avant un essai.
 *
 * Les compteurs sont tenus à part des appels retenus. La page n'en montre qu'une
 * poignée : conserver les autres ne servirait qu'à recopier un tableau de plus
 * en plus grand à chaque appel, pour un coût quadratique et une mémoire sans
 * borne. C'est le défaut déjà corrigé sur le journal d'audit ; il n'y a pas de
 * raison de le laisser vivre ici.
 */

export type Call = { tool: string; at: number; refused: boolean }

/** Nombre d'appels retenus. Au-delà, seuls les compteurs avancent. */
const MAX_RETENUS = 20

let total = 0
let refusés = 0
let recents: Call[] = []
const listeners = new Set<() => void>()

export function recordCall(tool: string, refused: boolean): void {
  total += 1
  if (refused) refusés += 1

  recents.push({ tool, at: Date.now(), refused })
  if (recents.length > MAX_RETENUS) recents = recents.slice(-MAX_RETENUS)

  for (const listener of listeners) listener()
}

export type WitnessState = {
  /** Tous les appels depuis la dernière remise à zéro, retenus ou non. */
  total: number
  refused: number
  /** Les plus récents, du plus ancien au plus récent. */
  recents: readonly Call[]
}

export function getWitness(): WitnessState {
  // Une copie, pas le tableau vivant : `recordCall` le mute en place, si bien
  // qu'un appelant qui retenait l'objet rendu voyait `recents` grandir sous lui
  // pendant que `total` — copié — restait figé, puis l'inverse une fois la
  // borne atteinte. Les deux magasins voisins rendent des instantanés stables.
  return { total, refused: refusés, recents: [...recents] }
}

export function onCall(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function resetCalls(): void {
  total = 0
  refusés = 0
  recents = []
  for (const listener of listeners) listener()
}
