import {
  CONFIDENCE_ORDER,
  EVIDENCE_KINDS,
  MAX_MUTATION_RECORDS,
  SCHEMA_VERSION,
} from '../domain/types'
import type { Confidence, EvidenceKind, Standing, TaskState } from '../domain/types'

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
 * Les entrées d'un tableau relu, réduites à celles qui sont des objets.
 *
 * Sans ce filtre, un `null` glissé dans `steps`, `rejected` ou `audit` faisait
 * planter la lecture sur `r.id` — c'est-à-dire que le module écrit pour
 * survivre à un enregistrement corrompu succombait à la forme la plus banale de
 * corruption. Une entrée illisible est écartée, le reste du cahier est sauvé.
 */
const asObjects = (v: unknown): Record<string, unknown>[] =>
  asArray<unknown>(v).filter(
    (e): e is Record<string, unknown> => typeof e === 'object' && e !== null,
  )

/**
 * Un identifiant est relu tel quel.
 *
 * Une version antérieure le réduisait à un jeu de caractères sûr, pour protéger
 * les attributs HTML où il finit interpolé. C'était la mauvaise couche : `id`
 * est la clé primaire du magasin IndexedDB, et la réécrire à la lecture faisait
 * qu'un enregistrement ne correspondait plus à sa propre clé — la comparaison
 * de version de `saveTask` était alors sautée sans erreur, et l'écriture
 * suivante forkait un second enregistrement.
 *
 * L'échappement se fait donc où il doit se faire : au rendu, dans
 * `src/ui/escape.ts`, qui neutralise guillemets et chevrons.
 */
const asId = (v: unknown): string => (typeof v === 'string' ? v : '')
const asNumber = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback
const asString = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback)
const asNullableString = (v: unknown): string | null => (typeof v === 'string' ? v : null)

/**
 * Relit un degré de preuve, en migrant `machine_verified` (schéma v1).
 *
 * Ce degré était accordé à un agent sur la seule étiquette qu'il joignait à son
 * propre texte : rien n'avait été vérifié par une machine. Les enregistrements
 * qui le portent décrivent donc une preuve jointe et non lue — c'est-à-dire
 * exactement `evidence`. On ne les efface pas, on les rebaptise pour ce qu'ils
 * ont toujours été. Les monter en `human_verified` serait inventer un clic.
 */
function normalizeConfidence(v: unknown): Confidence {
  if (v === 'machine_verified') return 'evidence'
  return CONFIDENCE_ORDER.includes(v as Confidence) ? (v as Confidence) : 'claimed'
}

/**
 * Relit la force d'une règle ou d'un rejet, en migrant le schéma v1.
 *
 * Un enregistrement d'avant ne porte pas de `standing`. On le déduit de la
 * source, et dans le sens prudent : ce qu'un humain a écrit était déjà
 * autoritaire, ce qu'un agent a écrit ne l'a jamais été légitimement — le lire
 * comme une proposition rend à l'humain une décision qu'on lui avait prise.
 */
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

    constraints: asObjects(stored.constraints).map((c) => {
      const source = c.source === 'human' ? ('human' as const) : ('agent' as const)
      return {
        id: asId(c.id),
        rule: asString(c.rule, ''),
        source,
        addedAtVersion: asNumber(c.addedAtVersion, 1),
        // Une contrainte dont l'état est illisible est tenue pour ACTIVE : en
        // cas de doute, on garde la règle plutôt que de la lever en silence.
        active: c.active !== false,
        standing: normalizeStanding(c.standing, source),
      }
    }),

    steps: asObjects(stored.steps).map((s) => ({
      id: asId(s.id),
      action: asString(s.action, ''),
      result: asString(s.result, ''),
      evidence: normalizeEvidence(s.evidence),
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

    audit: asObjects(stored.audit).map((a) => ({
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

    /**
     * Les mutations mémorisées. Absentes d'un enregistrement v1 : un cahier
     * relu d'avant repart sans garantie d'idempotence, ce qui est le
     * comportement d'avant et non une régression. Le tableau est reborné à la
     * lecture, car rien ne garantit qu'il a été écrit par ce code.
     *
     * Un enregistrement SANS EMPREINTE est écarté, pas réparé.
     *
     * L'empreinte est arrivée en v3, et elle est ce qui distingue un rejeu
     * d'une collision. Relire un enregistrement d'avant comme une base de
     * rejeu valable reviendrait à rendre la réponse du premier appel à un
     * second travail qu'on ne peut pas comparer — c'est-à-dire à conserver,
     * pour les cahiers déjà sur disque, exactement le défaut que l'empreinte
     * corrige. L'écarter ramène le réessai au rang d'écriture ordinaire, donc
     * refusée pour version périmée : un refus lisible plutôt qu'un accusé de
     * réception mensonger.
     */
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

/** Estampille l'enregistrement avec le schéma qui l'a écrit. */
export function toStored(state: TaskState): StoredTask {
  return { ...state, schemaVersion: SCHEMA_VERSION }
}
