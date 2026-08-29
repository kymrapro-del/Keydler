import type { AuditEntry, TaskState } from './types'

export type Trail = {
  entries: AuditEntry[]
  mayBeIncomplete: boolean
}

/**
 * Everything the audit log keeps about one item, through the `targetId` added
 * for undo. Incompleteness travels with the entries and not in a separate
 * function: the log being bounded, an old history thins out, and staying silent
 * about that would amount to claiming nothing happened.
 */
export function historyOf(state: TaskState, targetId: string): Trail {
  const trimmed = state.audit.some((e) => e.operation === 'audit_trimmed')
  if (!targetId) return { entries: [], mayBeIncomplete: trimmed }

  return {
    entries: state.audit.filter((e) => e.targetId === targetId && e.outcome === 'applied'),
    // What was dropped for this item is unknown: the trimming marker counts
    // entries, not targets. Hence "may be" rather than a number.
    mayBeIncomplete: trimmed,
  }
}
