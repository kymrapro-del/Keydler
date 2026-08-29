import {
  CONFIDENCE_ORDER,
  EVIDENCE_KINDS,
  MAX_AUDIT_ENTRIES,
  MAX_MUTATION_RECORDS,
  SCHEMA_VERSION,
} from '../domain/types'
import type { Confidence, EvidenceKind, Standing, TaskState } from '../domain/types'
import { MAX_EVIDENCE_LENGTH, MAX_FIELD_LENGTH } from '../domain/validate'

export type StoredTask = TaskState & { schemaVersion?: number }

export class FutureSchemaError extends Error {
  constructor(found: number) {
    super(
      [
        'STORAGE FROM A NEWER VERSION',
        `This nightorder was written with schema v${found}, but this build only understands v${SCHEMA_VERSION}.`,
        'Reading it could silently drop information. Update the page instead.',
      ].join('\n'),
    )
    this.name = 'FutureSchemaError'
  }
}

/**
 * Imported or manually corrupted IndexedDB values must not turn one task into
 * an unbounded allocation. This is intentionally generous compared with the
 * visible dashboard, while still giving every collection a finite ceiling.
 */
export const MAX_NORMALIZED_ITEMS = 1_000
export const MAX_NORMALIZED_ID_LENGTH = 200
export const MAX_NORMALIZED_RECORD_TEXT = 32_000

const asArray = <T>(v: unknown, max = MAX_NORMALIZED_ITEMS): T[] =>
  Array.isArray(v) ? (v as T[]).slice(-max) : []

const asObjects = (v: unknown, max = MAX_NORMALIZED_ITEMS): Record<string, unknown>[] =>
  asArray<unknown>(v, max).filter(
    (e): e is Record<string, unknown> => typeof e === 'object' && e !== null,
  )

const bounded = (value: string, max: number): string => value.slice(0, max)
const asId = (v: unknown): string =>
  typeof v === 'string' ? bounded(v, MAX_NORMALIZED_ID_LENGTH) : ''
const asNumber = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback
const asString = (v: unknown, fallback: string, max = MAX_FIELD_LENGTH): string =>
  typeof v === 'string' ? bounded(v, max) : fallback
const asNullableString = (v: unknown, max = MAX_FIELD_LENGTH): string | null =>
  typeof v === 'string' ? bounded(v, max) : null

function normalizeConfidence(v: unknown): Confidence {
  if (v === 'machine_verified') return 'evidence'
  return CONFIDENCE_ORDER.includes(v as Confidence) ? (v as Confidence) : 'claimed'
}

function normalizeStanding(v: unknown, source: 'human' | 'agent'): Standing {
  if (v === 'proposed' || v === 'accepted' || v === 'declined') return v
  return source === 'human' ? 'accepted' : 'proposed'
}

function normalizeEvidence(v: unknown): TaskState['steps'][number]['evidence'] {
  if (!v || typeof v !== 'object') return null
  const e = v as Record<string, unknown>
  if (!EVIDENCE_KINDS.includes(e.kind as EvidenceKind)) return null
  return {
    kind: e.kind as EvidenceKind,
    content: asString(e.content, '', MAX_EVIDENCE_LENGTH),
    verifiedAt: typeof e.verifiedAt === 'number' ? e.verifiedAt : null,
  }
}

function normalizeDispute(v: unknown): TaskState['steps'][number]['dispute'] {
  if (!v || typeof v !== 'object') return null
  const d = v as Record<string, unknown>
  const reason = asString(d.reason, '', 400)
  if (reason === '') return null
  return { reason, at: asNumber(d.at, 0) }
}

export function normalizeTask(stored: StoredTask | undefined): TaskState | undefined {
  if (!stored || typeof stored !== 'object') return undefined

  const schema = asNumber(stored.schemaVersion, 1)
  if (schema > SCHEMA_VERSION) throw new FutureSchemaError(schema)

  const now = asNumber(stored.updatedAt, Date.now())

  return {
    id: asId(stored.id),
    title: asString(stored.title, 'Untitled task', 200),
    version: Math.max(1, Math.trunc(asNumber(stored.version, 1))),
    next: asNullableString(stored.next, 400),
    goal: asNullableString(stored.goal, 400),
    status: stored.status === 'completed' ? 'completed' : 'active',
    archived: stored.archived === true,
    summary: asNullableString(stored.summary, 4_000),

    constraints: asObjects(stored.constraints).map((c) => {
      const source = c.source === 'human' ? ('human' as const) : ('agent' as const)
      return {
        id: asId(c.id),
        rule: asString(c.rule, ''),
        source,
        addedAtVersion: asNumber(c.addedAtVersion, 1),
        active: c.active !== false,
        standing: normalizeStanding(c.standing, source),
      }
    }),

    steps: asObjects(stored.steps).map((s) => ({
      id: asId(s.id),
      action: asString(s.action, ''),
      result: asString(s.result, ''),
      evidence: normalizeEvidence(s.evidence),
      dispute: normalizeDispute(s.dispute),
      confidence: normalizeConfidence(s.confidence),
      basedOnVersion: asNumber(s.basedOnVersion, 1),
      source: s.source === 'human' ? 'human' : 'agent',
      at: asNumber(s.at, now),
    })),

    decisions: asObjects(stored.decisions).map((d) => ({
      id: asId(d.id),
      choice: asString(d.choice, ''),
      rationale: asString(d.rationale, ''),
      source: d.source === 'human' ? 'human' : 'agent',
      addedAtVersion: asNumber(d.addedAtVersion, 1),
      at: asNumber(d.at, now),
    })),

    rejected: asObjects(stored.rejected).map((r) => {
      const source = r.source === 'human' ? ('human' as const) : ('agent' as const)
      return {
        id: asId(r.id),
        approach: asString(r.approach, ''),
        reason: asString(r.reason, ''),
        source,
        addedAtVersion: asNumber(r.addedAtVersion, 1),
        standing: normalizeStanding(r.standing, source),
        at: asNumber(r.at, now),
      }
    }),

    questions: asObjects(stored.questions).map((q) => ({
      id: asId(q.id),
      question: asString(q.question, ''),
      why: asString(q.why, ''),
      source: q.source === 'human' ? 'human' : 'agent',
      addedAtVersion: asNumber(q.addedAtVersion, 1),
      at: asNumber(q.at, now),
      answer: asNullableString(q.answer),
      answeredAt: typeof q.answeredAt === 'number' ? q.answeredAt : null,
    })),

    approvals: asObjects(stored.approvals).map((a) => ({
      id: asId(a.id),
      action: asString(a.action, ''),
      why: asString(a.why, ''),
      source: a.source === 'human' ? 'human' : 'agent',
      addedAtVersion: asNumber(a.addedAtVersion, 1),
      at: asNumber(a.at, now),
      decision: a.decision === 'allowed' || a.decision === 'denied' ? a.decision : null,
      decidedAt: typeof a.decidedAt === 'number' ? a.decidedAt : null,
    })),

    audit: asObjects(stored.audit, MAX_AUDIT_ENTRIES).map((a) => ({
      id: asId(a.id),
      operation: asString(a.operation, 'unknown'),
      actor: a.actor === 'human' ? 'human' : 'agent',
      versionBefore: asNumber(a.versionBefore, 0),
      versionAfter: asNumber(a.versionAfter, 0),
      basedOnVersion: typeof a.basedOnVersion === 'number' ? a.basedOnVersion : null,
      outcome: a.outcome === 'refused' ? 'refused' : 'applied',
      detail: asString(a.detail, '', MAX_EVIDENCE_LENGTH),
      ...(typeof a.targetId === 'string' && a.targetId !== ''
        ? { targetId: asId(a.targetId) }
        : {}),
      ...(typeof a.previous === 'string'
        ? { previous: bounded(a.previous, MAX_NORMALIZED_RECORD_TEXT) }
        : {}),
      ...(typeof a.repeated === 'number' ? { repeated: a.repeated } : {}),
      at: asNumber(a.at, now),
    })),

    mutations: asObjects(stored.mutations, MAX_MUTATION_RECORDS)
      .map((m) => ({
        id: asId(m.id),
        operation: asString(m.operation, 'unknown'),
        version: asNumber(m.version, 1),
        fingerprint: asString(m.fingerprint, '', MAX_NORMALIZED_RECORD_TEXT),
        result: asString(m.result, '', MAX_NORMALIZED_RECORD_TEXT),
        at: asNumber(m.at, now),
      }))
      .filter((m) => m.id !== '' && m.fingerprint !== '')
      .slice(-MAX_MUTATION_RECORDS),

    createdAt: asNumber(stored.createdAt, now),
    updatedAt: now,
  }
}

export function toStored(state: TaskState): StoredTask {
  return { ...state, schemaVersion: SCHEMA_VERSION }
}
