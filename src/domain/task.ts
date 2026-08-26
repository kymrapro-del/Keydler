import { StaleStateError, ValidationError } from './errors'
import {
  optionalText,
  requireEvidenceContent,
  requireEvidenceKind,
  requireText,
  requireVersion,
} from './validate'
import { MACHINE_EVIDENCE_KINDS, MAX_AUDIT_ENTRIES } from './types'
import type {
  Actor,
  AuditEntry,
  Confidence,
  Constraint,
  Decision,
  Evidence,
  Rejection,
  Step,
  TaskState,
} from './types'

/**
 * Mutations pures du cahier de quart (TAL-65, TAL-70, TAL-71).
 *
 * Trois invariants tiennent tout le produit :
 *
 * 1. Toute mutation appliquée incrémente `version`, sans exception.
 * 2. Toute écriture d'agent porte le `basedOnVersion` sur lequel il croit
 *    travailler ; une divergence est refusée, jamais fusionnée.
 * 3. Une écriture humaine est autoritaire : elle ne porte pas de version et
 *    n'est jamais refusée. C'est précisément ce qui périme celle de l'agent.
 *
 * Le journal d'audit est append-only et n'incrémente pas `version` : il décrit
 * ce qui est arrivé au cahier, il n'en fait pas partie.
 */

export type MutationContext = {
  now?: number
  newId?: () => string
}

function resolve(ctx: MutationContext | undefined): { now: number; newId: () => string } {
  return {
    now: ctx?.now ?? Date.now(),
    newId: ctx?.newId ?? defaultNewId,
  }
}

let fallbackCounter = 0

function defaultNewId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  fallbackCounter += 1
  return `id-${Date.now().toString(36)}-${fallbackCounter.toString(36)}`
}

/** Identifiant de tâche court, lisible et sûr dans une URL (TAL-68). */
export function newTaskId(ctx?: MutationContext): string {
  return resolve(ctx).newId().replace(/-/g, '').slice(0, 12)
}

export function createTask(
  input: { title?: unknown; next?: unknown; id?: string },
  ctx?: MutationContext,
): TaskState {
  const { now, newId } = resolve(ctx)
  const title = input.title === undefined ? 'Untitled task' : requireText('title', input.title, 200)
  return {
    id: input.id ?? newTaskId(ctx),
    title,
    version: 1,
    next: optionalText('next', input.next, 400),
    status: 'active',
    summary: null,
    constraints: [],
    steps: [],
    decisions: [],
    rejected: [],
    audit: [
      {
        id: newId(),
        operation: 'create_task',
        actor: 'human',
        versionBefore: 0,
        versionAfter: 1,
        basedOnVersion: null,
        outcome: 'applied',
        detail: `Task created: ${title}`,
        at: now,
      },
    ],
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Vérifie la version revendiquée. `null` signifie « écriture autoritaire »
 * (humaine) et court-circuite le contrôle.
 */
function guardVersion(state: TaskState, basedOnVersion: number | null): void {
  if (basedOnVersion === null) return
  if (basedOnVersion !== state.version) {
    throw new StaleStateError(basedOnVersion, state.version)
  }
}

type AppliedMutation = {
  operation: string
  actor: Actor
  basedOnVersion: number | null
  detail: string
  patch: Partial<TaskState>
}

/**
 * Applique une mutation validée : incrémente la version, horodate et journalise.
 * Seul point du domaine autorisé à faire avancer `version`.
 */
function apply(state: TaskState, mutation: AppliedMutation, ctx?: MutationContext): TaskState {
  const { now, newId } = resolve(ctx)
  const versionAfter = state.version + 1
  const entry: AuditEntry = {
    id: newId(),
    operation: mutation.operation,
    actor: mutation.actor,
    versionBefore: state.version,
    versionAfter,
    basedOnVersion: mutation.basedOnVersion,
    outcome: 'applied',
    detail: mutation.detail,
    at: now,
  }
  return {
    ...state,
    ...mutation.patch,
    version: versionAfter,
    updatedAt: now,
    audit: appendAudit(state.audit, entry),
  }
}

/**
 * Journalise une écriture refusée sans toucher au contenu ni à la version.
 * Appelé par la couche appelante quand une mutation a levé une erreur : c'est
 * ce qui rend le refus visible à l'écran au lieu de le laisser dans la console.
 */
export function recordRefusal(
  state: TaskState,
  input: {
    operation: string
    actor: Actor
    basedOnVersion: number | null
    detail: string
  },
  ctx?: MutationContext,
): TaskState {
  const { now, newId } = resolve(ctx)
  const entry: AuditEntry = {
    id: newId(),
    operation: input.operation,
    actor: input.actor,
    versionBefore: state.version,
    versionAfter: state.version,
    basedOnVersion: input.basedOnVersion,
    outcome: 'refused',
    detail: input.detail,
    at: now,
  }
  return { ...state, updatedAt: now, audit: appendAudit(state.audit, entry) }
}

/**
 * Ajoute une entrée au journal.
 *
 * Deux protections, l'une contre le bruit, l'autre contre la croissance :
 * une tentative refusée à l'identique juste après la précédente est comptée et
 * non empilée — c'est le comportement d'un agent qui insiste sur une version
 * périmée ; et au-delà de la borne, le plus ancien est élagué en laissant une
 * entrée qui dit combien, pour qu'aucune disparition ne soit muette.
 */
function appendAudit(audit: AuditEntry[], entry: AuditEntry): AuditEntry[] {
  const last = audit[audit.length - 1]
  const identique =
    last !== undefined &&
    last.outcome === 'refused' &&
    entry.outcome === 'refused' &&
    last.operation === entry.operation &&
    last.actor === entry.actor &&
    last.basedOnVersion === entry.basedOnVersion &&
    last.versionBefore === entry.versionBefore

  const suivant = identique
    ? [...audit.slice(0, -1), { ...last, repeated: (last.repeated ?? 1) + 1, at: entry.at }]
    : [...audit, entry]

  if (suivant.length <= MAX_AUDIT_ENTRIES) return suivant

  const àÉlaguer = suivant.length - MAX_AUDIT_ENTRIES + 1
  const élagués = suivant.slice(0, àÉlaguer)
  const déjàÉlaguées = élagués.reduce(
    (n, e) =>
      n + (e.operation === 'audit_trimmed' ? Number(e.detail.match(/^(\d+)/)?.[1] ?? 0) : 0),
    0,
  )
  const compte = élagués.filter((e) => e.operation !== 'audit_trimmed').length + déjàÉlaguées

  const marque: AuditEntry = {
    id: `${entry.id}-trim`,
    operation: 'audit_trimmed',
    actor: entry.actor,
    versionBefore: élagués[0].versionBefore,
    versionAfter: élagués[élagués.length - 1].versionAfter,
    basedOnVersion: null,
    outcome: 'applied',
    detail: `${compte} earlier entries dropped to keep the log bounded`,
    at: entry.at,
  }

  return [marque, ...suivant.slice(àÉlaguer)]
}

function assertActive(state: TaskState, operation: string): void {
  if (state.status === 'completed') {
    throw new ValidationError(
      'status',
      `task "${state.title}" is already completed; ${operation} is no longer accepted. ` +
        'Retrying will not help — ask the human to reopen the task if work remains.',
      false,
    )
  }
}

/* -------------------------------------------------------------------------- */
/* Écritures d'agent — toutes soumises au contrôle de version                  */
/* -------------------------------------------------------------------------- */

export function logStep(
  state: TaskState,
  input: {
    action: unknown
    result: unknown
    evidence?: { kind?: unknown; content?: unknown } | null
    confidence?: unknown
    next?: unknown
    basedOnVersion: number | null
  },
  actor: Actor = 'agent',
  ctx?: MutationContext,
): TaskState {
  assertActive(state, 'log_step')
  guardVersion(state, input.basedOnVersion)
  const { now, newId } = resolve(ctx)

  const action = requireText('action', input.action)
  const result = requireText('result', input.result)
  const next = optionalText('next', input.next, 400)

  let evidence: Evidence | null = null
  if (input.evidence !== undefined && input.evidence !== null) {
    evidence = {
      kind: requireEvidenceKind('evidence.kind', input.evidence.kind),
      content: requireEvidenceContent('evidence.content', input.evidence.content),
      verifiedAt: null,
    }
  }

  // Le degré n'est jamais déclaré, il est DÉDUIT de ce que l'écriture apporte.
  // Aucune auto-attribution n'est donc possible : un agent qui voudrait se
  // dire vérifié doit joindre la sortie d'une machine, et « human_verified »
  // reste hors d'atteinte — seul un clic humain l'accorde.
  const confidence: Confidence =
    evidence === null
      ? 'claimed'
      : MACHINE_EVIDENCE_KINDS.includes(evidence.kind)
        ? 'machine_verified'
        : 'evidence'

  const step: Step = {
    id: newId(),
    action,
    result,
    evidence,
    confidence,
    basedOnVersion: input.basedOnVersion ?? state.version,
    source: actor,
    at: now,
  }

  return apply(
    state,
    {
      operation: 'log_step',
      actor,
      basedOnVersion: input.basedOnVersion,
      detail: action,
      patch: { steps: [...state.steps, step], next: next ?? state.next },
    },
    ctx,
  )
}

export function addDecision(
  state: TaskState,
  input: { choice: unknown; rationale: unknown; basedOnVersion: number | null },
  actor: Actor = 'agent',
  ctx?: MutationContext,
): TaskState {
  assertActive(state, 'add_decision')
  guardVersion(state, input.basedOnVersion)
  const { now, newId } = resolve(ctx)

  const decision: Decision = {
    id: newId(),
    choice: requireText('choice', input.choice),
    rationale: requireText('rationale', input.rationale),
    source: actor,
    addedAtVersion: state.version + 1,
    at: now,
  }

  return apply(
    state,
    {
      operation: 'add_decision',
      actor,
      basedOnVersion: input.basedOnVersion,
      detail: decision.choice,
      patch: { decisions: [...state.decisions, decision] },
    },
    ctx,
  )
}

export function rejectApproach(
  state: TaskState,
  input: { approach: unknown; reason: unknown; basedOnVersion: number | null },
  actor: Actor = 'agent',
  ctx?: MutationContext,
): TaskState {
  assertActive(state, 'reject_approach')
  guardVersion(state, input.basedOnVersion)
  const { now, newId } = resolve(ctx)

  const rejection: Rejection = {
    id: newId(),
    approach: requireText('approach', input.approach),
    reason: requireText('reason', input.reason),
    source: actor,
    addedAtVersion: state.version + 1,
    at: now,
  }

  return apply(
    state,
    {
      operation: 'reject_approach',
      actor,
      basedOnVersion: input.basedOnVersion,
      detail: rejection.approach,
      patch: { rejected: [...state.rejected, rejection] },
    },
    ctx,
  )
}

export function addConstraint(
  state: TaskState,
  input: { rule: unknown; basedOnVersion: number | null },
  actor: Actor = 'agent',
  ctx?: MutationContext,
): TaskState {
  assertActive(state, 'add_constraint')
  guardVersion(state, input.basedOnVersion)
  const { newId } = resolve(ctx)

  const constraint: Constraint = {
    id: newId(),
    rule: requireText('rule', input.rule),
    source: actor,
    addedAtVersion: state.version + 1,
    active: true,
  }

  return apply(
    state,
    {
      operation: 'add_constraint',
      actor,
      basedOnVersion: input.basedOnVersion,
      detail: constraint.rule,
      patch: { constraints: [...state.constraints, constraint] },
    },
    ctx,
  )
}

export function completeTask(
  state: TaskState,
  input: { summary: unknown; basedOnVersion: number | null },
  actor: Actor = 'agent',
  ctx?: MutationContext,
): TaskState {
  assertActive(state, 'complete_task')
  guardVersion(state, input.basedOnVersion)

  const summary = requireText('summary', input.summary, 4000)

  return apply(
    state,
    {
      operation: 'complete_task',
      actor,
      basedOnVersion: input.basedOnVersion,
      detail: summary.slice(0, 120),
      patch: { status: 'completed', summary, next: null },
    },
    ctx,
  )
}

/* -------------------------------------------------------------------------- */
/* Écritures humaines — autoritaires, jamais refusées (TAL-48)                 */
/* -------------------------------------------------------------------------- */

/**
 * Valide une preuve d'un clic. C'est le seul chemin vers `human_verified` :
 * aucun agent ne peut s'auto-attribuer ce degré.
 */
export function verifyEvidence(state: TaskState, stepId: string, ctx?: MutationContext): TaskState {
  const { now } = resolve(ctx)
  const step = state.steps.find((s) => s.id === stepId)
  if (!step) throw new ValidationError('stepId', `no step with id "${stepId}".`)
  if (!step.evidence) {
    throw new ValidationError('stepId', 'this step carries no evidence to verify.')
  }

  const steps = state.steps.map((s) =>
    s.id === stepId
      ? {
          ...s,
          confidence: 'human_verified' as const,
          evidence: { ...s.evidence!, verifiedAt: now },
        }
      : s,
  )

  return apply(
    state,
    {
      operation: 'verify_evidence',
      actor: 'human',
      basedOnVersion: null,
      detail: step.action,
      patch: { steps },
    },
    ctx,
  )
}

export function setConstraintActive(
  state: TaskState,
  constraintId: string,
  active: boolean,
  ctx?: MutationContext,
): TaskState {
  const constraint = state.constraints.find((c) => c.id === constraintId)
  if (!constraint)
    throw new ValidationError('constraintId', `no constraint with id "${constraintId}".`)

  const constraints = state.constraints.map((c) => (c.id === constraintId ? { ...c, active } : c))

  return apply(
    state,
    {
      operation: active ? 'reactivate_constraint' : 'deactivate_constraint',
      actor: 'human',
      basedOnVersion: null,
      detail: constraint.rule,
      patch: { constraints },
    },
    ctx,
  )
}

/**
 * Rouvre une tâche close. Humain seulement.
 *
 * Sans ce chemin, une clôture décidée par l'agent serait irréversible et
 * l'humain, censé être autoritaire, se retrouverait à subir la décision d'un
 * agent. Le résumé final est conservé : il devient une trace de ce qui avait
 * été conclu, pas un mensonge à effacer.
 */
export function reopenTask(state: TaskState, reason: unknown, ctx?: MutationContext): TaskState {
  if (state.status === 'active') {
    throw new ValidationError('status', 'this task is already active.', false)
  }
  const motif = requireText('reason', reason, 400)

  return apply(
    state,
    {
      operation: 'reopen_task',
      actor: 'human',
      basedOnVersion: null,
      detail: motif,
      patch: { status: 'active', next: motif },
    },
    ctx,
  )
}

export function setNext(state: TaskState, next: unknown, ctx?: MutationContext): TaskState {
  // Une tâche close n'a pas de suite : `complete_task` met `next` à null et la
  // restitution montre le résumé à sa place. Laisser poser une prochaine action
  // produirait un état que rien n'affiche et que personne ne reprendrait.
  assertActive(state, 'set_next')
  const value = optionalText('next', next, 400)
  return apply(
    state,
    {
      operation: 'set_next',
      actor: 'human',
      basedOnVersion: null,
      detail: value ?? '(cleared)',
      patch: { next: value },
    },
    ctx,
  )
}

export function renameTask(state: TaskState, title: unknown, ctx?: MutationContext): TaskState {
  const value = requireText('title', title, 200)
  return apply(
    state,
    {
      operation: 'rename_task',
      actor: 'human',
      basedOnVersion: null,
      detail: value,
      patch: { title: value },
    },
    ctx,
  )
}

/* -------------------------------------------------------------------------- */
/* Lectures dérivées                                                           */
/* -------------------------------------------------------------------------- */

export function activeConstraints(state: TaskState): Constraint[] {
  return state.constraints.filter((c) => c.active)
}

export type EvidenceCounts = Record<Confidence, number>

export function evidenceCounts(state: TaskState): EvidenceCounts {
  const counts: EvidenceCounts = {
    machine_verified: 0,
    human_verified: 0,
    evidence: 0,
    claimed: 0,
  }
  for (const step of state.steps) counts[step.confidence] += 1
  return counts
}

/** Nombre d'étapes appuyées par une preuve, quelle qu'en soit la force. */
export function provenStepCount(state: TaskState): number {
  return state.steps.filter((s) => s.confidence !== 'claimed').length
}

export { requireVersion }
