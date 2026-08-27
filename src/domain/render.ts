import {
  acceptedRejections,
  activeConstraints,
  evidenceCounts,
  proposedConstraints,
  proposedRejections,
  provenStepCount,
} from './task'
import type { Confidence, TaskState } from './types'

/**
 * Restitution compacte de l'état canonique.
 *
 * Texte structuré, jamais du JSON verbeux : moins de tokens, et les modèles le
 * lisent mieux. Sections en capitales, une information par ligne. La cible est
 * de rester sous 400 tokens même sur un cahier chargé — au-delà, l'agent
 * survole au lieu de lire. Ce qui ne tient pas ici n'est pas perdu : il se
 * demande, ciblé ou paginé, par `read_task_detail`.
 *
 * Ce qui n'est jamais tronqué : les contraintes en vigueur et les approches
 * condamnées. Ce sont elles qui imposent quelque chose ; tronquer une
 * contrainte reviendrait à la supprimer. Le reste cède la place en premier.
 *
 * Ce qui n'est jamais confondu : ce qu'un humain a endossé et ce qu'un agent a
 * proposé. Les deux se lisent, dans deux sections séparées, et la seconde dit
 * en toutes lettres qu'elle n'impose rien.
 */

export const TOKEN_BUDGET = 400

const CONFIDENCE_TAG: Record<Confidence, string> = {
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
  /** Nombre de propositions d'agent détaillées. Le total est toujours dit. */
  recentProposals?: number
  /**
   * Facteur appliqué aux longueurs de coupe, de 1 à 0,4.
   *
   * Sous pression de budget, une contrainte ou un rejet est RACCOURCI, jamais
   * retiré : un agent doit savoir qu'une approche est condamnée même s'il n'en
   * lit pas le motif entier. Retirer la ligne reviendrait à lever l'interdit.
   */
  clipScale?: number
  /**
   * L'adresse à laquelle ce cahier est lié. Rendue telle quelle : c'est ce qui
   * permet à un agent de constater qu'il regarde bien la tâche qu'il croit.
   */
  url?: string | null
}

const CLIP_FLOOR = 0.4

export function renderTaskState(state: TaskState, options: RenderOptions = {}): string {
  const recentSteps = options.recentSteps ?? 5
  const recentDecisions = options.recentDecisions ?? 3
  const recentProposals = options.recentProposals ?? 4
  const clipScale = options.clipScale ?? 1
  const c = (max: number) => Math.max(24, Math.round(max * clipScale))

  // Une seule définition de « travail prouvé » : le domaine la porte, le rendu
  // ne la refait pas. Elle existait ici en double, écrite autrement.
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
  // L'identifiant AVANT tout le reste du contenu. Un agent qui reprend doit
  // pouvoir constater qu'on lui rend le cahier qu'il croit, et non celui qu'un
  // autre onglet a touché en dernier.
  lines.push(`TASK ID     ${state.id}`)
  if (options.url) lines.push(`URL         ${options.url}`)
  lines.push(`VERSION     ${state.version}`)
  lines.push(`STATUS      ${state.status}`)
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

  // Contraintes en vigueur : jamais tronquées.
  lines.push('')
  lines.push(`CONSTRAINTS — binding (${active.length})`)
  if (active.length === 0) {
    lines.push('  (none)')
  } else {
    for (const constraint of active) {
      lines.push(`  [${constraint.source}] ${clip(constraint.rule, c(160))}`)
    }
  }

  // Rejets endossés : jamais tronqués. C'est la mémoire qui empêche de refaire.
  if (condamnées.length > 0) {
    lines.push('')
    lines.push('REJECTED — do not retry')
    for (const r of condamnées) {
      // La source est rendue, comme pour les contraintes. Sans elle, un veto
      // humain et une conjecture d'agent se lisent à l'identique.
      lines.push(`  [${r.source}] ${clip(r.approach, c(84))} — ${clip(r.reason, c(104))}`)
    }
  }

  // Propositions d'agent : lisibles, explicitement non opposables.
  //
  // Les laisser dans les sections ci-dessus était la faille la plus grave du
  // cahier : un agent y écrivait un interdit, et toutes les conversations
  // suivantes le lisaient comme une règle de la maison. Un agent qui condamne
  // à tort la bonne approche empoisonnait ainsi la tâche sans que personne ne
  // puisse s'en apercevoir.
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

  // Ce résumé est délibérément incomplet. Le dire, et dire par où obtenir le
  // reste, coûte deux lignes et évite qu'un agent conclue de son silence que
  // rien d'autre n'existe.
  lines.push('')
  lines.push('FULL DETAIL')
  lines.push('  read_task_detail returns whole steps, decisions, rejections and')
  lines.push('  evidence, one page at a time. Nothing above is the complete record.')

  lines.push('')
  if (state.status === 'active') {
    lines.push('WRITE PROTOCOL')
    lines.push(`  Every write must carry based_on_version: ${state.version}`)
    lines.push('  Every write must carry a fresh mutation_id; reuse it verbatim to retry.')
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
  // d'éléments facultatifs — étapes récentes, décisions, propositions — puis,
  // seulement une fois ceux-ci au plancher, la longueur de chaque ligne.
  if (recentSteps > 2 || recentDecisions > 1 || recentProposals > 1) {
    return renderTaskState(state, {
      ...options,
      recentSteps: Math.max(2, recentSteps - 2),
      recentDecisions: Math.max(1, recentDecisions - 1),
      recentProposals: Math.max(1, recentProposals - 1),
      clipScale,
    })
  }

  if (clipScale > CLIP_FLOOR) {
    return renderTaskState(state, {
      ...options,
      recentSteps,
      recentDecisions,
      recentProposals,
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
    'Every write tool on this page will refuse until one exists.',
    'Ask the human to open a task in the dashboard, then call resume_task again.',
  ].join('\n')
}

/**
 * Rendu affiché quand la page est liée à un cahier introuvable.
 *
 * Distinct de « aucun cahier » : ici, une tâche est nommée par l'adresse et
 * c'est ELLE qui manque. Rendre le dernier cahier touché à la place serait la
 * pire des réponses — l'agent reprendrait un travail qui n'est pas le sien
 * sans qu'aucune ligne ne le signale.
 */
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
