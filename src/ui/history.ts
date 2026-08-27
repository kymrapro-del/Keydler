import type { AuditEntry } from '../domain/types'

export type HistoryLine = {
  at: number
  who: 'You' | 'Agent' | 'System'
  what: string
  detail: string | null
  refused: boolean
  repeated: number
}

const BY_HUMAN: Record<string, string> = {
  create_task: 'created the task',
  add_constraint: 'added a rule',
  reject_approach: 'ruled out an approach',
  add_decision: 'recorded a decision',
  log_step: 'recorded a step',
  complete_task: 'closed the task',
  reopen_task: 'reopened the task',
  set_next: 'changed the next action',
  verify_evidence: 'approved evidence',
  deactivate_constraint: 'lifted a rule',
  reactivate_constraint: 'restored a rule',
  accept_constraint: 'accepted a proposed rule',
  decline_constraint: 'declined a proposed rule',
  accept_rejection: 'accepted a proposed rejection',
  decline_rejection: 'declined a proposed rejection',
  rename_task: 'renamed the task',
  edit_constraint: 'reworded a rule',
  edit_rejection: 'reworded a ruled-out approach',
}

const BY_AGENT: Record<string, string> = {
  log_step: 'recorded a step',
  add_decision: 'recorded a decision',
  add_constraint: 'proposed a rule',
  reject_approach: 'proposed ruling out an approach',
  complete_task: 'closed the task',
}

export function refusalReason(detail: string): string {
  const lower = detail.toLowerCase()
  if (lower.includes('stale') || lower.includes('another page')) {
    return 'the task had changed since it was read'
  }
  if (lower.includes('cancelled')) return 'the call was cancelled before it wrote'
  if (lower.includes('mutation-id-collision')) {
    return 'the same write id was reused for different work'
  }
  if (lower.includes('mutation-id-reused')) return 'the same write id was reused for another tool'
  if (lower.includes('already-completed') || lower.includes('already completed')) {
    return 'the task was already closed'
  }
  if (lower.includes('invalid input') || lower.includes(':')) return detail
  return detail
}

export function describeEntry(entry: AuditEntry): HistoryLine {
  const repeated = entry.repeated ?? 1

  if (entry.operation === 'audit_trimmed') {
    return {
      at: entry.at,
      who: 'System',
      what: 'dropped older history to keep this log bounded',
      detail: entry.detail,
      refused: false,
      repeated: 1,
    }
  }

  const who = entry.actor === 'human' ? 'You' : 'Agent'
  const table = entry.actor === 'human' ? BY_HUMAN : BY_AGENT
  const verb = table[entry.operation] ?? `ran ${entry.operation}`

  if (entry.outcome === 'refused') {
    return {
      at: entry.at,
      who,
      what: `tried to ${verb} — refused`,
      detail: refusalReason(entry.detail),
      refused: true,
      repeated,
    }
  }

  return {
    at: entry.at,
    who,
    what: verb,
    detail: entry.detail || null,
    refused: false,
    repeated,
  }
}

/**
 * Les lignes les plus récentes d'abord.
 */
export function describeHistory(audit: readonly AuditEntry[]): HistoryLine[] {
  return [...audit].reverse().map(describeEntry)
}
