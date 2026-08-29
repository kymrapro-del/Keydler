import type { AuditEntry, TaskState } from './types'

export type Trail = {
  entries: AuditEntry[]
  mayBeIncomplete: boolean
}

/**
 * Tout ce que le journal retient d'UN élément, par le `targetId` ajouté pour l'annulation.
 * L'incomplétude voyage avec les entrées et non dans une fonction séparée : le journal
 * étant borné, une histoire ancienne s'appauvrit, et se taire là-dessus reviendrait à
 * affirmer qu'il ne s'est rien passé.
 */
export function historyOf(state: TaskState, targetId: string): Trail {
  const trimmed = state.audit.some((e) => e.operation === 'audit_trimmed')
  if (!targetId) return { entries: [], mayBeIncomplete: trimmed }

  return {
    entries: state.audit.filter((e) => e.targetId === targetId && e.outcome === 'applied'),
    // On ne sait pas ce qui a été écarté pour CET élément. Le marqueur
    // d'élagage compte des entrées, pas des cibles. D'où « peut être », et non
    // un nombre que l'on n'a pas.
    mayBeIncomplete: trimmed,
  }
}
