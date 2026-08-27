import type { AuditEntry, TaskState } from './types'

/**
 * Tout ce que le journal retient d'UN élément. Rendu possible par `targetId`,
 * qui avait été ajouté pour l'annulation : la même donnée sert ici à répondre
 * « qu'est-il arrivé à cette règle ? », question qu'aucune carte ne posait.
 */
export function historyOf(state: TaskState, targetId: string): AuditEntry[] {
  if (!targetId) return []
  return state.audit.filter((e) => e.targetId === targetId && e.outcome === 'applied')
}
