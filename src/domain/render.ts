import {
  acceptedRejections,
  activeConstraints,
  answeredQuestions,
  decidedApprovals,
  disputedSteps,
  pendingApprovals,
  evidenceCounts,
  openQuestions,
  proposedConstraints,
  proposedRejections,
  provenStepCount,
} from './task'
import type { Confidence, TaskState } from './types'
import { referenceSyntax, type SecretName } from './secret'
import { sinceThen } from './elapsed'

/**
 * Chrome recommande 1,5 k caractères par sortie d'outil, soit 375 tokens à quatre caractères
 * par token — la mesure d'`estimateTokens`. Descendre de 400 à 375 a été essayé puis retiré :
 * une restitution ordinaire passait de 1506 à 1489 caractères, dix-sept de gagnés, contre un
 * nom d'identifiant perdu à l'écran sur un cahier chargé.
 */
export const TOKEN_BUDGET = 400

const CONFIDENCE_TAG: Record<Confidence, string> = {
  human_verified: '[human]   ',
  evidence: '[evidence]',
  claimed: '[claimed] ',
  disputed: '[DISPUTED]',
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
  recentQuestions?: number
  recentAnswers?: number
  recentApprovals?: number
  recentDisputes?: number
  recentConstraints?: number
  recentRejections?: number
}

const CLIP_FLOOR = 0.4

/**
 * Rien ne bornait les règles ni les approches écartées : dix règles suffisaient à dépasser
 * le budget (487 tokens), deux mille le portaient à 37 800 — 94 fois l'annoncé — et
 * l'échelle de dégradation ne coupait que l'histoire. On les coupe donc en dernier, jamais
 * sous ce plancher et jamais sans le dire : l'agent doit savoir qu'il lui en manque.
 */
const MIN_BINDING_SHOWN = 12

export function renderTaskState(state: TaskState, options: RenderOptions = {}): string {
  const recentSteps = options.recentSteps ?? 5
  const recentDecisions = options.recentDecisions ?? 3
  const recentProposals = options.recentProposals ?? 4
  const recentCredentials = options.recentCredentials ?? 5
  const recentQuestions = options.recentQuestions ?? 5
  const recentAnswers = options.recentAnswers ?? 3
  const recentApprovals = options.recentApprovals ?? 3
  const recentDisputes = options.recentDisputes ?? 3
  const recentConstraints = options.recentConstraints ?? Number.POSITIVE_INFINITY
  const recentRejections = options.recentRejections ?? Number.POSITIVE_INFINITY
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
  if (state.goal) {
    lines.push(`DONE WHEN   ${clip(state.goal, c(220))}`)
  }

  const attente = pendingApprovals(state)
  if (attente.length > 0) {
    const shown = attente.slice(0, recentApprovals)
    lines.push('')
    lines.push(
      attente.length > shown.length
        ? `AWAITING YOUR APPROVAL — the agent is blocked (${shown.length} of ${attente.length})`
        : `AWAITING YOUR APPROVAL — the agent is blocked (${attente.length})`,
    )
    for (const a of shown) {
      lines.push(`  ${clip(a.action, c(150))}`)
      lines.push(`     why: ${clip(a.why, c(130))}`)
    }
  }

  const tranchées = decidedApprovals(state)
  if (tranchées.length > 0 && recentApprovals > 0) {
    const shown = tranchées.slice(-recentApprovals)
    lines.push('')
    lines.push(
      tranchées.length > shown.length
        ? `DECIDED BY THE HUMAN (last ${shown.length} of ${tranchées.length})`
        : 'DECIDED BY THE HUMAN',
    )
    for (const a of shown) {
      lines.push(`  ${a.decision === 'allowed' ? 'ALLOWED' : 'DENIED'}: ${clip(a.action, c(140))}`)
    }
  }

  const contestées = disputedSteps(state)
  if (contestées.length > 0) {
    const shown = contestées.slice(-recentDisputes)
    lines.push('')
    lines.push(
      contestées.length > shown.length
        ? `DISPUTED BY THE HUMAN — treat as wrong (${shown.length} of ${contestées.length})`
        : `DISPUTED BY THE HUMAN — treat as wrong (${contestées.length})`,
    )
    for (const s of shown) {
      lines.push(`  ${clip(s.action, c(120))}`)
      lines.push(`     they say: ${clip(s.dispute?.reason ?? '', c(140))}`)
    }
  }

  const ouvertes = openQuestions(state)
  if (ouvertes.length > 0) {
    const shown = ouvertes.slice(0, recentQuestions)
    lines.push('')
    lines.push(
      ouvertes.length > shown.length
        ? `WAITING ON THE HUMAN — blocked until answered (${shown.length} of ${ouvertes.length})`
        : `WAITING ON THE HUMAN — blocked until answered (${ouvertes.length})`,
    )
    for (const q of shown) {
      lines.push(`  Q: ${clip(q.question, c(150))}`)
      lines.push(`     why: ${clip(q.why, c(130))}`)
    }
  }

  const répondues = answeredQuestions(state)
  if (répondues.length > 0 && recentAnswers > 0) {
    const shown = répondues.slice(-recentAnswers)
    lines.push('')
    lines.push(
      répondues.length > shown.length
        ? `ANSWERED BY THE HUMAN (last ${shown.length} of ${répondues.length})`
        : 'ANSWERED BY THE HUMAN',
    )
    for (const q of shown) {
      lines.push(`  Q: ${clip(q.question, c(120))}`)
      lines.push(`  A: ${clip(q.answer ?? '', c(150))}`)
    }
  }

  // Un cahier resté longtemps sans écriture est un cahier dont les hypothèses
  // ont pu vieillir. On ne le dit que si c'est vrai, et jamais à la minute.
  const dormant = sinceThen(state.updatedAt)
  if (dormant !== null && Date.now() - state.updatedAt >= 24 * 60 * 60 * 1000) {
    lines.push(`LAST WRITE  ${dormant} — check that what is below still holds`)
  }

  const rules = active.slice(0, recentConstraints)
  const rulesHidden = active.length - rules.length

  lines.push('')
  lines.push(`CONSTRAINTS — binding (${active.length})`)
  if (active.length === 0) {
    lines.push('  (none)')
  } else {
    for (const constraint of rules) {
      lines.push(`  [${constraint.source}] ${clip(constraint.rule, c(160))}`)
    }
    if (rulesHidden > 0) {
      lines.push(`  ${rulesHidden} more not shown here — THEY ARE STILL BINDING.`)
      lines.push('  Read them with read_task_detail on constraints before you act.')
    }
  }

  if (condamnées.length > 0) {
    const shown = condamnées.slice(0, recentRejections)
    const hidden = condamnées.length - shown.length
    lines.push('')
    lines.push(
      hidden > 0
        ? `REJECTED — do not retry (${shown.length} of ${condamnées.length} shown)`
        : 'REJECTED — do not retry',
    )
    for (const r of shown) {
      lines.push(`  [${r.source}] ${clip(r.approach, c(84))} — ${clip(r.reason, c(104))}`)
    }
    if (hidden > 0) {
      lines.push(`  ${hidden} more not shown here — they were ruled out too.`)
      lines.push('  Read them with read_task_detail on rejections before proposing an approach.')
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
  lines.push('  read_task_detail pages any section of this record in full; its schema')
  lines.push('  lists them. Nothing above is the complete record.')

  lines.push('')
  if (state.status === 'active') {
    lines.push('WRITE PROTOCOL')
    lines.push(`  Every write must carry based_on_version: ${state.version}`)
    lines.push('  Every write must carry a fresh mutation_id; reuse it verbatim to retry.')
    lines.push('  A refused write means this state moved: call what_changed, or resume_task.')
  } else {
    lines.push('TASK CLOSED')
    lines.push('  This task is complete. Writes are refused — do not log further work.')
    lines.push('  If work remains, ask the human to reopen it.')
  }

  const text = lines.join('\n')

  if (estimateTokens(text) <= TOKEN_BUDGET) return text

  if (
    recentSteps > 2 ||
    recentDecisions > 1 ||
    recentProposals > 1 ||
    recentAnswers > 1 ||
    recentApprovals > 1 ||
    recentDisputes > 1
  ) {
    return renderTaskState(state, {
      ...options,
      recentSteps: Math.max(2, recentSteps - 2),
      recentDecisions: Math.max(1, recentDecisions - 1),
      recentProposals: Math.max(1, recentProposals - 1),
      recentAnswers: Math.max(1, recentAnswers - 1),
      recentApprovals: Math.max(1, recentApprovals - 1),
      recentDisputes: Math.max(1, recentDisputes - 1),
      recentCredentials,
      recentQuestions,
      clipScale,
    })
  }

  if (clipScale > CLIP_FLOOR) {
    return renderTaskState(state, {
      ...options,
      recentSteps,
      recentDecisions,
      recentProposals,
      recentAnswers,
      recentApprovals,
      recentDisputes,
      recentCredentials,
      recentQuestions,
      clipScale: Math.max(CLIP_FLOOR, clipScale - 0.2),
    })
  }

  if (recentSteps > 1) {
    return renderTaskState(state, {
      ...options,
      recentSteps: 1,
      recentDecisions,
      recentProposals,
      recentAnswers,
      recentApprovals,
      recentDisputes,
      recentCredentials,
      recentQuestions,
      clipScale,
    })
  }

  if (recentCredentials > 1) {
    return renderTaskState(state, {
      ...options,
      recentSteps,
      recentDecisions,
      recentProposals,
      recentAnswers,
      recentApprovals,
      recentDisputes,
      recentQuestions,
      recentCredentials: Math.max(1, recentCredentials - 1),
      clipScale,
    })
  }

  // Dernier recours : ce qui est déjà tranché est de l'histoire, et se relit
  // page par page. Ce qui attend une décision, non.
  if (recentAnswers > 0 || recentApprovals > 0) {
    return renderTaskState(state, {
      ...options,
      recentSteps,
      recentDecisions,
      recentProposals,
      recentAnswers: 0,
      recentApprovals: 0,
      recentCredentials,
      recentQuestions,
      recentDisputes,
      clipScale,
    })
  }

  if (recentQuestions > 1) {
    return renderTaskState(state, {
      ...options,
      recentSteps,
      recentDecisions,
      recentProposals,
      recentAnswers,
      recentApprovals,
      recentDisputes,
      recentCredentials,
      recentQuestions: Math.max(1, recentQuestions - 1),
      clipScale,
    })
  }

  // Tout le reste est épuisé : ce qui engage cède en dernier, et par moitiés
  // plutôt que d'un coup, pour ne couper que ce qu'il faut couper. Le
  // plancher part de la longueur réelle, sinon la moitié de l'infini reste
  // l'infini et la descente ne finit jamais.
  const fitConstraints = Math.min(recentConstraints, active.length)
  const fitRejections = Math.min(recentRejections, condamnées.length)
  if (fitConstraints > MIN_BINDING_SHOWN || fitRejections > MIN_BINDING_SHOWN) {
    return renderTaskState(state, {
      ...options,
      recentSteps,
      recentDecisions,
      recentProposals,
      recentAnswers,
      recentApprovals,
      recentDisputes,
      recentCredentials,
      recentQuestions,
      recentConstraints: Math.max(MIN_BINDING_SHOWN, Math.floor(fitConstraints / 2)),
      recentRejections: Math.max(MIN_BINDING_SHOWN, Math.floor(fitRejections / 2)),
      clipScale,
    })
  }

  return text
}

export function renderNoTask(): string {
  return [
    'NO ACTIVE TASK',
    '',
    'This device holds no task yet, so there is nothing to resume.',
    'Every write tool on this page will refuse until one exists.',
    'Ask the human to open a task in the dashboard, then call resume_task again.',
  ].join('\n')
}

export function renderMissingTask(taskId: string): string {
  return [
    'TASK NOT FOUND',
    '',
    `This page is bound to task ${taskId}, which no longer exists on this device.`,
    'Another task may be open elsewhere, but it is NOT this one and has not',
    'been substituted for it. Do not resume work from memory.',
    'Ask the human which task to open, then call resume_task again.',
  ].join('\n')
}
