import { StaleStateError, ValidationError } from './errors'
import {
  optionalText,
  requireEvidenceContent,
  requireEvidenceKind,
  requireText,
  requireVersion,
} from './validate'
import { MAX_AUDIT_ENTRIES, MAX_MUTATION_RECORDS } from './types'
import type {
  Actor,
  AuditEntry,
  Confidence,
  Constraint,
  Decision,
  Evidence,
  MutationRecord,
  Rejection,
  Standing,
  Step,
  TaskState,
} from './types'

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
    mutations: [],
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

export function recordMutation(state: TaskState, record: MutationRecord): TaskState {
  const mutations = [...state.mutations, record]
  return {
    ...state,
    mutations:
      mutations.length > MAX_MUTATION_RECORDS
        ? mutations.slice(mutations.length - MAX_MUTATION_RECORDS)
        : mutations,
  }
}

export function findMutation(state: TaskState, mutationId: string): MutationRecord | undefined {
  return state.mutations.find((m) => m.id === mutationId)
}

function assertActive(state: TaskState, operation: string): void {
  if (state.status === 'completed') {
    throw new ValidationError(
      'status',
      `task "${state.title}" is already completed; ${operation} is no longer accepted. ` +
        'Retrying will not help — ask the human to reopen the task if work remains.',
      { code: 'already-completed', retryable: false },
    )
  }
}

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
      verifiedAt: actor === 'human' ? now : null,
    }
  }

  const confidence: Confidence =
    evidence === null ? 'claimed' : actor === 'human' ? 'human_verified' : 'evidence'

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
    standing: actor === 'human' ? 'accepted' : 'proposed',
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
    standing: actor === 'human' ? 'accepted' : 'proposed',
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

export function verifyEvidence(
  state: TaskState,
  stepId: string,
  reviewedContent: string,
  ctx?: MutationContext,
): TaskState {
  const { now } = resolve(ctx)
  const step = state.steps.find((s) => s.id === stepId)
  if (!step)
    throw new ValidationError('stepId', `no step with id "${stepId}".`, { code: 'not-found' })
  if (!step.evidence) {
    throw new ValidationError('stepId', 'this step carries no evidence to verify.', {
      code: 'no-evidence',
    })
  }
  if (reviewedContent !== step.evidence.content) {
    throw new ValidationError(
      'reviewedContent',
      'does not match the evidence held for this step; it may have changed since it was displayed. ' +
        'Re-read the evidence before validating it.',
      { code: 'content-not-reviewed', retryable: false },
    )
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

export function setConstraintStanding(
  state: TaskState,
  constraintId: string,
  standing: Standing,
  ctx?: MutationContext,
): TaskState {
  const constraint = state.constraints.find((c) => c.id === constraintId)
  if (!constraint) {
    throw new ValidationError('constraintId', `no constraint with id "${constraintId}".`, {
      code: 'not-found',
    })
  }
  if (constraint.standing === standing) {
    throw new ValidationError('constraintId', `this constraint is already ${standing}.`, {
      code: 'not-proposed',
      retryable: false,
    })
  }

  return apply(
    state,
    {
      operation: standing === 'accepted' ? 'accept_constraint' : 'decline_constraint',
      actor: 'human',
      basedOnVersion: null,
      detail: constraint.rule,
      patch: {
        constraints: state.constraints.map((c) => (c.id === constraintId ? { ...c, standing } : c)),
      },
    },
    ctx,
  )
}

export function setRejectionStanding(
  state: TaskState,
  rejectionId: string,
  standing: Standing,
  ctx?: MutationContext,
): TaskState {
  const rejection = state.rejected.find((r) => r.id === rejectionId)
  if (!rejection) {
    throw new ValidationError('rejectionId', `no rejected approach with id "${rejectionId}".`, {
      code: 'not-found',
    })
  }
  if (rejection.standing === standing) {
    throw new ValidationError('rejectionId', `this rejection is already ${standing}.`, {
      code: 'not-proposed',
      retryable: false,
    })
  }

  return apply(
    state,
    {
      operation: standing === 'accepted' ? 'accept_rejection' : 'decline_rejection',
      actor: 'human',
      basedOnVersion: null,
      detail: rejection.approach,
      patch: {
        rejected: state.rejected.map((r) => (r.id === rejectionId ? { ...r, standing } : r)),
      },
    },
    ctx,
  )
}

export function renameTask(state: TaskState, title: unknown, ctx?: MutationContext): TaskState {
  const next = requireText('title', title, 200)
  if (next === state.title) {
    throw new ValidationError('title', 'is already the title of this task.', {
      code: 'not-proposed',
      retryable: false,
    })
  }

  return apply(
    state,
    {
      operation: 'rename_task',
      actor: 'human',
      basedOnVersion: null,
      detail: `${state.title} → ${next}`,
      patch: { title: next },
    },
    ctx,
  )
}

export function editConstraint(
  state: TaskState,
  constraintId: string,
  rule: unknown,
  ctx?: MutationContext,
): TaskState {
  const constraint = state.constraints.find((c) => c.id === constraintId)
  if (!constraint) {
    throw new ValidationError('constraintId', `no constraint with id "${constraintId}".`, {
      code: 'not-found',
    })
  }

  const next = requireText('rule', rule)
  if (next === constraint.rule) {
    throw new ValidationError('rule', 'is unchanged.', { code: 'not-proposed', retryable: false })
  }

  return apply(
    state,
    {
      operation: 'edit_constraint',
      actor: 'human',
      basedOnVersion: null,
      detail: `${constraint.rule} → ${next}`,
      patch: {
        constraints: state.constraints.map((c) =>
          c.id === constraintId ? { ...c, rule: next } : c,
        ),
      },
    },
    ctx,
  )
}

export function editRejection(
  state: TaskState,
  rejectionId: string,
  input: { approach: unknown; reason: unknown },
  ctx?: MutationContext,
): TaskState {
  const rejection = state.rejected.find((r) => r.id === rejectionId)
  if (!rejection) {
    throw new ValidationError('rejectionId', `no rejected approach with id "${rejectionId}".`, {
      code: 'not-found',
    })
  }

  const approach = requireText('approach', input.approach)
  const reason = requireText('reason', input.reason)
  if (approach === rejection.approach && reason === rejection.reason) {
    throw new ValidationError('approach', 'is unchanged.', {
      code: 'not-proposed',
      retryable: false,
    })
  }

  return apply(
    state,
    {
      operation: 'edit_rejection',
      actor: 'human',
      basedOnVersion: null,
      detail: approach,
      patch: {
        rejected: state.rejected.map((r) =>
          r.id === rejectionId ? { ...r, approach, reason } : r,
        ),
      },
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
    throw new ValidationError('constraintId', `no constraint with id "${constraintId}".`, {
      code: 'not-found',
    })

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

export function reopenTask(state: TaskState, reason: unknown, ctx?: MutationContext): TaskState {
  if (state.status === 'active') {
    throw new ValidationError('status', 'this task is already active.', {
      code: 'already-active',
      retryable: false,
    })
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

export function activeConstraints(state: TaskState): Constraint[] {
  return state.constraints.filter((c) => c.active && c.standing === 'accepted')
}

export function proposedConstraints(state: TaskState): Constraint[] {
  return state.constraints.filter((c) => c.standing === 'proposed')
}

export function acceptedRejections(state: TaskState): Rejection[] {
  return state.rejected.filter((r) => r.standing === 'accepted')
}

export function proposedRejections(state: TaskState): Rejection[] {
  return state.rejected.filter((r) => r.standing === 'proposed')
}

export function declinedRejections(state: TaskState): Rejection[] {
  return state.rejected.filter((r) => r.standing === 'declined')
}

export type EvidenceCounts = Record<Confidence, number>

export function evidenceCounts(state: TaskState): EvidenceCounts {
  const counts: EvidenceCounts = {
    human_verified: 0,
    evidence: 0,
    claimed: 0,
  }
  for (const step of state.steps) counts[step.confidence] += 1
  return counts
}

export function provenStepCount(state: TaskState): number {
  return state.steps.filter((s) => s.confidence !== 'claimed').length
}

export { requireVersion }
