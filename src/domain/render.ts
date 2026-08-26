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
  /**
   * Facteur appliqué aux longueurs de coupe, de 1 à 0,4.
   *
   * Sous pression de budget, une contrainte ou un rejet est RACCOURCI, jamais
   * retiré : un agent doit savoir qu'une approche est condamnée même s'il n'en
   * lit pas le motif entier. Retirer la ligne reviendrait à lever l'interdit.
   */
  clipScale?: number
}

const CLIP_FLOOR = 0.4

export function renderTaskState(state: TaskState, options: RenderOptions = {}): string {
  const recentSteps = options.recentSteps ?? 5
  const recentDecisions = options.recentDecisions ?? 3
  const clipScale = options.clipScale ?? 1
  const c = (max: number) => Math.max(24, Math.round(max * clipScale))

  const counts = evidenceCounts(state)
  const proven = state.steps.length - counts.claimed
  const active = activeConstraints(state)

  const lines: string[] = []

  lines.push(`TASK        ${clip(state.title, c(120))}`)
  lines.push(`VERSION     ${state.version}`)
  lines.push(`STATUS      ${state.status}`)
  lines.push(`PROGRESS    ${state.steps.length} steps logged · ${proven} backed by evidence`)
  if (state.status === 'completed' && state.summary) {
    lines.push(`SUMMARY     ${clip(state.summary, c(300))}`)
  } else {
    lines.push(
      `NEXT        ${state.next ? clip(state.next, c(200)) : '(not set — decide and log it)'}`,
    )
  }

  // Contraintes : jamais tronquées.
  lines.push('')
  lines.push(`CONSTRAINTS (${active.length} active)`)
  if (active.length === 0) {
    lines.push('  (none)')
  } else {
    for (const constraint of active) {
      lines.push(`  [${constraint.source}] ${clip(constraint.rule, c(160))}`)
    }
  }

  // Rejets : jamais tronqués. C'est la mémoire qui empêche de refaire.
  if (state.rejected.length > 0) {
    lines.push('')
    lines.push('REJECTED — do not retry')
    for (const r of state.rejected) {
      lines.push(`  ${clip(r.approach, c(90))} — ${clip(r.reason, c(110))}`)
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
      lines.push(`  ${CONFIDENCE_TAG[s.confidence]} ${clip(s.action, c(80))} — ${clip(s.result, c(90))}`)
    }
  }

  lines.push('')
  if (state.status === 'active') {
    lines.push('WRITE PROTOCOL')
    lines.push(`  Every write must carry based_on_version: ${state.version}`)
    lines.push('  A refused write means the human changed this state. Call resume_task again.')
  } else {
    // Sans cette ligne, un agent qui reprend une tâche close tente une écriture
    // et découvre le refus par l'échec. Autant le lui dire tout de suite.
    lines.push('TASK CLOSED')
    lines.push('  This task is complete. Writes are refused — do not log further work.')
    lines.push('  If work remains, ask the human to reopen it.')
  }

  const text = lines.join('\n')

  if (estimateTokens(text) <= TOKEN_BUDGET) return text

  // Dégradation progressive, dans cet ordre : on sacrifie d'abord le nombre
  // d'éléments facultatifs — étapes récentes, décisions — puis, seulement une
  // fois ceux-ci au plancher, la longueur de chaque ligne.
  if (recentSteps > 2 || recentDecisions > 1) {
    return renderTaskState(state, {
      recentSteps: Math.max(2, recentSteps - 2),
      recentDecisions: Math.max(1, recentDecisions - 1),
      clipScale,
    })
  }

  if (clipScale > CLIP_FLOOR) {
    return renderTaskState(state, {
      recentSteps,
      recentDecisions,
      clipScale: Math.max(CLIP_FLOOR, clipScale - 0.2),
    })
  }

  // Plancher atteint : le cahier porte plus de contraintes et de rejets que le
  // budget n'en peut contenir. On rend quand même tout, car en retirer une
  // reviendrait à lever un interdit sans le dire.
  return text
}

/** Rendu affiché quand aucun cahier n'existe encore sur cet appareil. */
export function renderNoTask(): string {
  return [
    'NO ACTIVE TASK',
    '',
    'This device holds no watch log yet, so there is nothing to resume.',
    'Every other tool on this page will refuse until one exists.',
    'Ask the human to open a task in the dashboard, then call resume_task again.',
  ].join('\n')
}
