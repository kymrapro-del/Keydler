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

/**
 * Le pendant humain de `resume_task` : ce que la page sait et que personne
 * n'a encore tranché, dans l'ordre où cela coûte de ne pas le voir. Une
 * demande d'autorisation bloque un agent en ce moment même ; une étape
 * affirmée sans preuve attendra.
 */
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
