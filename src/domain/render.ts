import { activeConstraints, evidenceCounts } from './task'
import type { Confidence, TaskState } from './types'

/**
 * Restitution compacte de l'état canonique.
 *
 * Texte structuré, jamais du JSON verbeux : moins de tokens, et les modèles le
 * lisent mieux. Sections en capitales, une information par ligne. La cible est
 * de rester sous 400 tokens même sur un cahier chargé — au-delà, l'agent
 * survole au lieu de lire.
 *
 * Ce qui n'est jamais tronqué : les contraintes actives et les approches
 * rejetées. Ce sont elles qui imposent quelque chose ; tronquer une contrainte
 * reviendrait à la supprimer. Le reste cède la place en premier.
 */

export const TOKEN_BUDGET = 400

const CONFIDENCE_TAG: Record<Confidence, string> = {
  machine_verified: '[machine] ',
  human_verified: '[human]   ',
  evidence: '[evidence]',
  claimed: '[claimed] ',
}

/** Approximation usuelle : ~4 caractères par token. Suffisant pour calibrer. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function clip(value: string, max: number): string {
  const flat = value.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`
}

export type RenderOptions = {
  /** Nombre d'étapes récentes détaillées. */
  recentSteps?: number
  /** Nombre de décisions rappelées. */
  recentDecisions?: number
}

export function renderTaskState(state: TaskState, options: RenderOptions = {}): string {
  const recentSteps = options.recentSteps ?? 5
  const recentDecisions = options.recentDecisions ?? 3

  const counts = evidenceCounts(state)
  const proven = state.steps.length - counts.claimed
  const active = activeConstraints(state)

  const lines: string[] = []

  lines.push(`TASK        ${clip(state.title, 120)}`)
  lines.push(`VERSION     ${state.version}`)
  lines.push(`STATUS      ${state.status}`)
  lines.push(`PROGRESS    ${state.steps.length} steps logged · ${proven} backed by evidence`)
  if (state.status === 'completed' && state.summary) {
    lines.push(`SUMMARY     ${clip(state.summary, 300)}`)
  } else {
    lines.push(
      `NEXT        ${state.next ? clip(state.next, 200) : '(not set — decide and log it)'}`,
    )
  }

  // Contraintes : jamais tronquées.
  lines.push('')
  lines.push(`CONSTRAINTS (${active.length} active)`)
  if (active.length === 0) {
    lines.push('  (none)')
  } else {
    for (const c of active) {
      lines.push(`  [${c.source}] ${clip(c.rule, 160)}`)
    }
  }

  // Rejets : jamais tronqués. C'est la mémoire qui empêche de refaire.
  if (state.rejected.length > 0) {
    lines.push('')
    lines.push('REJECTED — do not retry')
    for (const r of state.rejected) {
      lines.push(`  ${clip(r.approach, 90)} — ${clip(r.reason, 110)}`)
    }
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
      lines.push(`  ${clip(d.choice, 90)} — ${clip(d.rationale, 110)}`)
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
      lines.push(`  ${CONFIDENCE_TAG[s.confidence]} ${clip(s.action, 80)} — ${clip(s.result, 90)}`)
    }
  }

  if (state.status === 'active') {
    lines.push('')
    lines.push('WRITE PROTOCOL')
    lines.push(`  Every write must carry based_on_version: ${state.version}`)
    lines.push('  A refused write means the human changed this state. Call resume_task again.')
  }

  const text = lines.join('\n')

  // Dégradation progressive : on resserre les sections optionnelles plutôt que
  // de rendre un pavé que l'agent ne lira pas en entier.
  if (estimateTokens(text) > TOKEN_BUDGET && (recentSteps > 2 || recentDecisions > 1)) {
    return renderTaskState(state, {
      recentSteps: Math.max(2, recentSteps - 2),
      recentDecisions: Math.max(1, recentDecisions - 1),
    })
  }

  return text
}

/** Rendu affiché quand aucun cahier n'existe encore sur cet appareil. */
export function renderNoTask(): string {
  return [
    'NO ACTIVE TASK',
    '',
    'This device holds no watch log yet.',
    'Ask the human to open the dashboard and start a task, or call',
    'log_step once a task exists.',
  ].join('\n')
}
