import {
  CONFIDENCE_ORDER,
  EVIDENCE_KINDS,
  MAX_MUTATION_RECORDS,
  SCHEMA_VERSION,
} from '../domain/types'
import type { Confidence, EvidenceKind, Standing, TaskState } from '../domain/types'

export type StoredTask = TaskState & { schemaVersion?: number }

export class FutureSchemaError extends Error {
  constructor(found: number) {
    super(
      [
        'STORAGE FROM A NEWER VERSION',
        `This watch log was written with schema v${found}, but this build only understands v${SCHEMA_VERSION}.`,
        'Reading it could silently drop information. Update the page instead.',
      ].join('\n'),
    )
    this.name = 'FutureSchemaError'
  }
}

const asArray = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])

const asObjects = (v: unknown): Record<string, unknown>[] =>
  asArray<unknown>(v).filter(
    (e): e is Record<string, unknown> => typeof e === 'object' && e !== null,
  )

const asId = (v: unknown): string => (typeof v === 'string' ? v : '')
const asNumber = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback
const asString = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback)
const asNullableString = (v: unknown): string | null => (typeof v === 'string' ? v : null)

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
    content: asString(e.content, ''),
    verifiedAt: typeof e.verifiedAt === 'number' ? e.verifiedAt : null,
  }
}

function normalizeDispute(v: unknown): TaskState['steps'][number]['dispute'] {
  if (!v || typeof v !== 'object') return null
  const d = v as Record<string, unknown>
  const reason = asString(d.reason, '')
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
    title: asString(stored.title, 'Untitled task'),
    version: Math.max(1, Math.trunc(asNumber(stored.version, 1))),
    next: asNullableString(stored.next),
    status: stored.status === 'completed' ? 'completed' : 'active',
    archived: stored.archived === true,
    summary: asNullableString(stored.summary),

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

    audit: asObjects(stored.audit).map((a) => ({
      id: asId(a.id),
      operation: asString(a.operation, 'unknown'),
      actor: a.actor === 'human' ? 'human' : 'agent',
      versionBefore: asNumber(a.versionBefore, 0),
      versionAfter: asNumber(a.versionAfter, 0),
      basedOnVersion: typeof a.basedOnVersion === 'number' ? a.basedOnVersion : null,
      outcome: a.outcome === 'refused' ? 'refused' : 'applied',
      detail: asString(a.detail, ''),
      ...(typeof a.targetId === 'string' && a.targetId !== '' ? { targetId: a.targetId } : {}),
      ...(typeof a.repeated === 'number' ? { repeated: a.repeated } : {}),
      at: asNumber(a.at, now),
    })),

    mutations: asObjects(stored.mutations)
      .map((m) => ({
        id: asId(m.id),
        operation: asString(m.operation, 'unknown'),
        version: asNumber(m.version, 1),
        fingerprint: asString(m.fingerprint, ''),
        result: asString(m.result, ''),
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
