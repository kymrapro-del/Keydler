import { openQuestions, pendingApprovals, proposedConstraints, proposedRejections } from './task'
import type { TaskState } from './types'

export type NeedKind = 'approval' | 'question' | 'proposal' | 'evidence' | 'claimed'

export type Need = {
  kind: NeedKind
  count: number
  label: string
  anchor: string
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

// The human counterpart of `resume_task`: what nobody has settled yet, in the
// order in which not seeing it costs. An approval blocks an agent right now, a
// step claimed without evidence can wait.

/**
 * A picker badge cannot be read if it lists everything: name what costs the
 * most to miss, and count the rest.
 */
export function summariseNeeds(needs: readonly Need[]): string | null {
  if (needs.length === 0) return null
  const [first, ...rest] = needs
  const others = rest.reduce((n, need) => n + need.count, 0)
  return others === 0 ? first.label : `${first.label} +${others} more`
}

export function needsYou(state: TaskState): Need[] {
  if (state.status !== 'active') return []

  const approvals = pendingApprovals(state).length
  const questions = openQuestions(state).length
  const proposals = proposedConstraints(state).length + proposedRejections(state).length
  const evidence = state.steps.filter(
    (s) => s.evidence !== null && s.confidence === 'evidence',
  ).length
  const claimed = state.steps.filter((s) => s.confidence === 'claimed').length

  const needs: Need[] = []

  if (approvals > 0) {
    needs.push({
      kind: 'approval',
      count: approvals,
      label: `${plural(approvals, 'agent is', 'agents are')} blocked on your decision`,
      anchor: '#permission-title',
    })
  }
  if (questions > 0) {
    needs.push({
      kind: 'question',
      count: questions,
      label: `${plural(questions, 'question', 'questions')} waiting on you`,
      anchor: '#waiting-title',
    })
  }
  if (proposals > 0) {
    needs.push({
      kind: 'proposal',
      count: proposals,
      label: `${plural(proposals, 'proposal', 'proposals')} to accept or decline`,
      anchor: '#proposals-title',
    })
  }
  if (evidence > 0) {
    needs.push({
      kind: 'evidence',
      count: evidence,
      label: `${plural(evidence, 'piece', 'pieces')} of evidence to read`,
      anchor: '#evidence-title',
    })
  }
  if (claimed > 0) {
    needs.push({
      kind: 'claimed',
      count: claimed,
      label: `${plural(claimed, 'step', 'steps')} claimed with no evidence at all`,
      anchor: '#work-title',
    })
  }

  return needs
}
