import { CONFIDENCE_ORDER, EVIDENCE_KINDS, SCHEMA_VERSION } from '../domain/types'
import type { Confidence, EvidenceKind, TaskState } from '../domain/types'

/**
 * Lecture défensive.
 *
 * Ce qui sort d'IndexedDB a été écrit par une version antérieure du code, pas
 * par celle qui le lit. Le schéma a déjà bougé une fois — le journal d'audit a
 * gagné un champ — et il bougera encore. Un enregistrement d'hier auquel il
 * manque un tableau ferait planter la page sur un `undefined.length`, et
 * l'utilisateur perdrait son cahier alors que la donnée est là.
 *
 * On répare donc ce qui se répare, silencieusement. On refuse en revanche ce
 * qui vient d'une version PLUS RÉCENTE : mieux vaut un message clair qu'un
 * cahier tronqué par un code qui ne comprend pas ce qu'il lit.
 */

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

/**
 * Un identifiant relu est réduit au jeu de caractères qu'on émet nous-mêmes.
 * Il finit dans des attributs HTML et des sélecteurs CSS : y laisser passer un
 * guillemet ou un crochet serait offrir une porte à qui saurait écrire dans
 * IndexedDB.
 */
const asId = (v: unknown): string =>
  typeof v === 'string' ? v.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) : ''
const asNumber = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback
const asString = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback)
const asNullableString = (v: unknown): string | null => (typeof v === 'string' ? v : null)

function normalizeConfidence(v: unknown): Confidence {
  return CONFIDENCE_ORDER.includes(v as Confidence) ? (v as Confidence) : 'claimed'
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

/** Répare un enregistrement lu, ou lève si son schéma est plus récent que le nôtre. */
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
    summary: asNullableString(stored.summary),

    constraints: asArray<Record<string, unknown>>(stored.constraints).map((c) => ({
      id: asId(c.id),
      rule: asString(c.rule, ''),
      source: c.source === 'human' ? 'human' : 'agent',
      addedAtVersion: asNumber(c.addedAtVersion, 1),
      // Une contrainte dont l'état est illisible est tenue pour ACTIVE : en cas
      // de doute, on garde la règle plutôt que de la lever en silence.
      active: c.active !== false,
    })),

    steps: asArray<Record<string, unknown>>(stored.steps).map((s) => ({
      id: asId(s.id),
      action: asString(s.action, ''),
      result: asString(s.result, ''),
      evidence: normalizeEvidence(s.evidence),
      confidence: normalizeConfidence(s.confidence),
      basedOnVersion: asNumber(s.basedOnVersion, 1),
      source: s.source === 'human' ? 'human' : 'agent',
      at: asNumber(s.at, now),
    })),

    decisions: asArray<Record<string, unknown>>(stored.decisions).map((d) => ({
      id: asId(d.id),
      choice: asString(d.choice, ''),
      rationale: asString(d.rationale, ''),
      source: d.source === 'human' ? 'human' : 'agent',
      addedAtVersion: asNumber(d.addedAtVersion, 1),
      at: asNumber(d.at, now),
    })),

    rejected: asArray<Record<string, unknown>>(stored.rejected).map((r) => ({
      id: asId(r.id),
      approach: asString(r.approach, ''),
      reason: asString(r.reason, ''),
      source: r.source === 'human' ? 'human' : 'agent',
      addedAtVersion: asNumber(r.addedAtVersion, 1),
      at: asNumber(r.at, now),
    })),

    audit: asArray<Record<string, unknown>>(stored.audit).map((a) => ({
      id: asId(a.id),
      operation: asString(a.operation, 'unknown'),
      actor: a.actor === 'human' ? 'human' : 'agent',
      versionBefore: asNumber(a.versionBefore, 0),
      versionAfter: asNumber(a.versionAfter, 0),
      basedOnVersion: typeof a.basedOnVersion === 'number' ? a.basedOnVersion : null,
      outcome: a.outcome === 'refused' ? 'refused' : 'applied',
      detail: asString(a.detail, ''),
      ...(typeof a.repeated === 'number' ? { repeated: a.repeated } : {}),
      at: asNumber(a.at, now),
    })),

    createdAt: asNumber(stored.createdAt, now),
    updatedAt: now,
  }
}

/** Estampille l'enregistrement avec le schéma qui l'a écrit. */
export function toStored(state: TaskState): StoredTask {
  return { ...state, schemaVersion: SCHEMA_VERSION }
}
