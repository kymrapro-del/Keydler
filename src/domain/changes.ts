import type { AuditEntry, TaskState } from './types'

export const MAX_CHANGES = 12

const BINDING_OPERATIONS = new Set([
  'add_constraint',
  'edit_constraint',
  'deactivate_constraint',
  'reactivate_constraint',
  'accept_constraint',
  'decline_constraint',
  'reject_approach',
  'edit_rejection',
  'accept_rejection',
  'decline_rejection',
  'answer_question',
  'ask_human',
  'set_next',
  'set_next_action',
  'complete_task',
  'reopen_task',
  'archive_task',
  'unarchive_task',
  'undo',
  'request_approval',
  'allow_action',
  'deny_action',
])

const BY_HUMAN: Record<string, string> = {
  create_task: 'created this task',
  add_constraint: 'added a binding rule',
  edit_constraint: 'reworded a rule',
  deactivate_constraint: 'lifted a rule — it no longer binds you',
  reactivate_constraint: 'restored a rule',
  accept_constraint: 'accepted a proposed rule — it now binds you',
  decline_constraint: 'declined a proposed rule',
  reject_approach: 'ruled out an approach',
  edit_rejection: 'reworded a ruled-out approach',
  accept_rejection: 'accepted a proposed rejection — do not retry it',
  decline_rejection: 'declined a proposed rejection',
  answer_question: 'answered a question you were blocked on',
  ask_human: 'left a question on this task',
  add_decision: 'recorded a decision',
  log_step: 'recorded a step they did themselves',
  attach_evidence: 'attached evidence to a step',
  verify_evidence: 'checked evidence and marked it verified',
  set_next: 'changed the next action',
  set_next_action: 'changed the next action',
  rename_task: 'renamed this task',
  complete_task: 'closed this task — writes are refused now',
  reopen_task: 'reopened this task',
  archive_task: 'archived this task',
  unarchive_task: 'brought this task back',
  undo: 'undid their own last decision',
  allow_action: 'ALLOWED an action you asked about',
  deny_action: 'DENIED an action you asked about — do not do it',
  request_approval: 'asked for permission to act',
}

const BY_AGENT: Record<string, string> = {
  add_constraint: 'proposed a rule — not binding until a human accepts it',
  reject_approach: 'proposed ruling out an approach — not binding yet',
  add_decision: 'recorded a decision',
  log_step: 'recorded a step',
  attach_evidence: 'attached evidence to a step',
  ask_human: 'left a question for the human',
  set_next_action: 'changed the next action',
  complete_task: 'closed this task',
  request_approval: 'asked the human for permission to act',
}

function phrase(entry: AuditEntry): string {
  const table = entry.actor === 'human' ? BY_HUMAN : BY_AGENT
  const who = entry.actor === 'human' ? 'The human' : 'Another agent'
  const verb = table[entry.operation] ?? `ran ${entry.operation}`
  return `${who} ${verb}`
}

function line(entry: AuditEntry): string {
  const detail = entry.detail.replace(/\s+/g, ' ').trim()
  const shown = detail.length > 160 ? `${detail.slice(0, 160)}…` : detail
  return shown
    ? `  v${entry.versionAfter}  ${phrase(entry)}: ${shown}`
    : `  v${entry.versionAfter}  ${phrase(entry)}`
}

function trimmedBefore(audit: readonly AuditEntry[]): AuditEntry | undefined {
  return audit.find((e) => e.operation === 'audit_trimmed')
}

export function renderChanges(state: TaskState, sinceVersion: number): string {
  const header = [
    `TASK ID     ${state.id}`,
    `VERSION     ${state.version}`,
    `SINCE       v${sinceVersion}`,
  ]

  if (sinceVersion > state.version) {
    return [
      'AHEAD OF THIS PAGE',
      ...header,
      '',
      `You asked for changes since v${sinceVersion}, but this page is at v${state.version}.`,
      'That version did not come from this task. Call resume_task and start from',
      'what it returns.',
    ].join('\n')
  }

  if (sinceVersion === state.version) {
    return [
      'NOTHING CHANGED',
      ...header,
      '',
      `This task is still at v${state.version}. Nothing has been written since you read it.`,
      'Your based_on_version is still good.',
    ].join('\n')
  }

  const applied = state.audit.filter(
    (e) =>
      e.outcome === 'applied' && e.operation !== 'audit_trimmed' && e.versionAfter > sinceVersion,
  )

  const trimmed = trimmedBefore(state.audit)
  const incomplete = trimmed !== undefined && trimmed.versionAfter >= sinceVersion

  const binding = applied.filter((e) => BINDING_OPERATIONS.has(e.operation))
  const rest = applied.filter((e) => !BINDING_OPERATIONS.has(e.operation))

  const lines: string[] = [
    `${applied.length} write${applied.length === 1 ? '' : 's'} since v${sinceVersion}`,
    ...header,
  ]

  if (incomplete) {
    lines.push('')
    lines.push('INCOMPLETE — this log is bounded and older entries were dropped.')
    lines.push('What follows is only what survived. Call resume_task for the whole')
    lines.push('current state rather than trusting this list to be exhaustive.')
  }

  const budget = (entries: AuditEntry[], title: string, note?: string) => {
    if (entries.length === 0) return
    const shown = entries.slice(-MAX_CHANGES)
    lines.push('')
    lines.push(
      entries.length > shown.length
        ? `${title} (last ${shown.length} of ${entries.length})`
        : title,
    )
    if (note) lines.push(note)
    for (const e of shown) lines.push(line(e))
    if (entries.length > shown.length) {
      lines.push(
        `  ${entries.length - shown.length} more, older — read them with read_task_detail on "audit".`,
      )
    }
  }

  budget(binding, 'CHANGES WHAT YOU MAY DO', '  Re-read these before continuing.')
  budget(rest, 'ALSO HAPPENED', '  Informational — it does not change what binds you.')

  lines.push('')
  lines.push(`Write with based_on_version: ${state.version}`)

  return lines.join('\n')
}
