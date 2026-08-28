import {
  acceptedRejections,
  activeConstraints,
  evidenceCounts,
  proposedConstraints,
  proposedRejections,
  provenStepCount,
} from './task'
import type { Confidence, TaskState } from './types'
import { referenceSyntax, type SecretName } from './secret'

export const TOKEN_BUDGET = 400

const CONFIDENCE_TAG: Record<Confidence, string> = {
  human_verified: '[human]   ',
  evidence: '[evidence]',
  claimed: '[claimed] ',
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function clip(value: string, max: number): string {
  const flat = value.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`
}

export type RenderOptions = {
  recentSteps?: number
  recentDecisions?: number
  recentProposals?: number
  clipScale?: number
  url?: string | null
  credentials?: readonly SecretName[]
  recentCredentials?: number
}

const CLIP_FLOOR = 0.4

export function renderTaskState(state: TaskState, options: RenderOptions = {}): string {
  const recentSteps = options.recentSteps ?? 5
  const recentDecisions = options.recentDecisions ?? 3
  const recentProposals = options.recentProposals ?? 4
  const recentCredentials = options.recentCredentials ?? 5
  const clipScale = options.clipScale ?? 1
  const c = (max: number) => Math.max(24, Math.round(max * clipScale))

  const proven = provenStepCount(state)
  const counts = evidenceCounts(state)
  const active = activeConstraints(state)
  const condamnées = acceptedRejections(state)
  const propositions = [
    ...proposedConstraints(state).map((p) => ({ kind: 'constraint', text: p.rule })),
    ...proposedRejections(state).map((p) => ({
      kind: 'rejection',
      text: `${p.approach} — ${p.reason}`,
    })),
  ]

  const lines: string[] = []

  lines.push(`TASK        ${clip(state.title, c(120))}`)
  lines.push(`TASK ID     ${state.id}`)
  if (options.url) lines.push(`URL         ${options.url}`)
  lines.push(`VERSION     ${state.version}`)
  lines.push(`STATUS      ${state.status}${state.archived ? ' · archived by the human' : ''}`)
  lines.push(
    `PROGRESS    ${state.steps.length} steps logged · ${proven} with evidence attached · ${counts.human_verified} checked by the human`,
  )
  if (state.status === 'completed' && state.summary) {
    lines.push(`SUMMARY     ${clip(state.summary, c(300))}`)
  } else {
    lines.push(
      `NEXT        ${state.next ? clip(state.next, c(200)) : '(not set — decide and log it)'}`,
    )
  }

  lines.push('')
  lines.push(`CONSTRAINTS — binding (${active.length})`)
  if (active.length === 0) {
    lines.push('  (none)')
  } else {
    for (const constraint of active) {
      lines.push(`  [${constraint.source}] ${clip(constraint.rule, c(160))}`)
    }
  }

  if (condamnées.length > 0) {
    lines.push('')
    lines.push('REJECTED — do not retry')
    for (const r of condamnées) {
      lines.push(`  [${r.source}] ${clip(r.approach, c(84))} — ${clip(r.reason, c(104))}`)
    }
  }

  if (propositions.length > 0) {
    const shown = propositions.slice(0, recentProposals)
    lines.push('')
    lines.push(
      propositions.length > shown.length
        ? `PROPOSED BY AN AGENT — NOT binding (${shown.length} of ${propositions.length} shown)`
        : `PROPOSED BY AN AGENT — NOT binding (${propositions.length})`,
    )
    for (const p of shown) lines.push(`  ${p.kind}: ${clip(p.text, c(140))}`)
    lines.push('  No human has approved these. Weigh them; do not treat them as rules.')
  }

  if (state.decisions.length > 0) {
    const shown = state.decisions.slice(-recentDecisions)
    lines.push('')
    lines.push(
      state.decisions.length > shown.length
        ? `DECISIONS (last ${shown.length} of ${state.decisions.length})`
        : 'DECISIONS',
    )
    for (const d of shown) {
      lines.push(`  ${clip(d.choice, c(90))} — ${clip(d.rationale, c(110))}`)
    }
  }

  if (state.steps.length > 0) {
    const shown = state.steps.slice(-recentSteps)
    lines.push('')
    lines.push(
      state.steps.length > shown.length
        ? `RECENT WORK (last ${shown.length} of ${state.steps.length})`
        : 'RECENT WORK',
    )
    for (const s of shown) {
      lines.push(
        `  ${CONFIDENCE_TAG[s.confidence]} ${clip(s.action, c(80))} — ${clip(s.result, c(90))}`,
      )
    }
  }

  if (options.credentials && options.credentials.length > 0) {
    const all = options.credentials
    const shown = all.slice(0, recentCredentials)
    lines.push('')
    lines.push(
      all.length > shown.length
        ? `CREDENTIALS — names only, values sealed (${shown.length} of ${all.length})`
        : `CREDENTIALS — names only, values sealed (${all.length})`,
    )
    for (const secret of shown) {
      lines.push(`  ${referenceSyntax(secret.name)} — ${clip(secret.purpose, c(90))}`)
    }
    lines.push('  Write these as ${name}; no tool here returns a value.')
  }

  lines.push('')
  lines.push('FULL DETAIL')
  lines.push('  read_task_detail returns whole steps, decisions, rejections,')
  lines.push('  evidence and credentials, one page at a time. Nothing above is')
  lines.push('  the complete record.')

  lines.push('')
  if (state.status === 'active') {
    lines.push('WRITE PROTOCOL')
    lines.push(`  Every write must carry based_on_version: ${state.version}`)
    lines.push('  Every write must carry a fresh mutation_id; reuse it verbatim to retry.')
    lines.push('  A refused write means the human changed this state. Call resume_task again.')
  } else {
    lines.push('TASK CLOSED')
    lines.push('  This task is complete. Writes are refused — do not log further work.')
    lines.push('  If work remains, ask the human to reopen it.')
  }

  const text = lines.join('\n')

  if (estimateTokens(text) <= TOKEN_BUDGET) return text

  if (recentSteps > 2 || recentDecisions > 1 || recentProposals > 1) {
    return renderTaskState(state, {
      ...options,
      recentSteps: Math.max(2, recentSteps - 2),
      recentDecisions: Math.max(1, recentDecisions - 1),
      recentProposals: Math.max(1, recentProposals - 1),
      recentCredentials,
      clipScale,
    })
  }

  if (clipScale > CLIP_FLOOR) {
    return renderTaskState(state, {
      ...options,
      recentSteps,
      recentDecisions,
      recentProposals,
      recentCredentials,
      clipScale: Math.max(CLIP_FLOOR, clipScale - 0.2),
    })
  }

  if (recentCredentials > 1) {
    return renderTaskState(state, {
      ...options,
      recentSteps,
      recentDecisions,
      recentProposals,
      recentCredentials: Math.max(1, recentCredentials - 1),
      clipScale,
    })
  }

  return text
}

export function renderNoTask(): string {
  return [
    'NO ACTIVE TASK',
    '',
    'This device holds no watch log yet, so there is nothing to resume.',
    'Every write tool on this page will refuse until one exists.',
    'Ask the human to open a task in the dashboard, then call resume_task again.',
  ].join('\n')
}

export function renderMissingTask(taskId: string): string {
  return [
    'TASK NOT FOUND',
    '',
    `This page is bound to task ${taskId}, which no longer exists on this device.`,
    'Another watch log may be open elsewhere, but it is NOT this task and has not',
    'been substituted for it. Do not resume work from memory.',
    'Ask the human which task to open, then call resume_task again.',
  ].join('\n')
}
