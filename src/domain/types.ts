/**
 * Modèle de domaine du cahier de quart (TAL-65).
 *
 * Ces types sont la source de vérité du produit. Ils sont purs : aucune
 * dépendance à React, au DOM, à IndexedDB ni à WebMCP. Toute couche qui les
 * consomme s'adapte à eux, jamais l'inverse.
 */

/** Degré de preuve attaché à une étape, du plus fort au plus faible. */
export type Confidence = 'machine_verified' | 'human_verified' | 'evidence' | 'claimed'

/** Ordre décroissant de force. Sert à l'affichage et aux compteurs. */
export const CONFIDENCE_ORDER: readonly Confidence[] = [
  'machine_verified',
  'human_verified',
  'evidence',
  'claimed',
] as const

/** Nature d'une preuve. Détermine comment elle se rend à l'écran. */
export type EvidenceKind = 'command_output' | 'diff' | 'url' | 'hash' | 'test_report'

export const EVIDENCE_KINDS: readonly EvidenceKind[] = [
  'command_output',
  'diff',
  'url',
  'hash',
  'test_report',
] as const

/**
 * Qui a produit l'information. La distinction est visible à l'écran : c'est
 * elle qui permet de lire un cahier sans savoir qui a fait quoi.
 */
export type Actor = 'human' | 'agent'

export type TaskStatus = 'active' | 'completed'

export type Evidence = {
  kind: EvidenceKind
  content: string
  /** Renseigné par le clic humain de validation. `null` tant que non validé. */
  verifiedAt: number | null
}

export type Constraint = {
  id: string
  rule: string
  source: Actor
  addedAtVersion: number
  active: boolean
}

export type Step = {
  id: string
  action: string
  result: string
  evidence: Evidence | null
  confidence: Confidence
  /** Version sur laquelle l'auteur croyait travailler au moment de l'écriture. */
  basedOnVersion: number
  source: Actor
  at: number
}

export type Decision = {
  id: string
  choice: string
  rationale: string
  source: Actor
  addedAtVersion: number
  at: number
}

export type Rejection = {
  id: string
  approach: string
  /** Obligatoire : un rejet sans motif ne sert à rien. */
  reason: string
  source: Actor
  addedAtVersion: number
  at: number
}

/**
 * Une entrée du journal d'audit (TAL-70). Immuable, append-only : elle
 * enregistre ce qui s'est passé, y compris les écritures refusées.
 */
export type AuditEntry = {
  id: string
  /** Nom de la mutation : `log_step`, `add_constraint`, `verify_evidence`… */
  operation: string
  actor: Actor
  /** Version du cahier avant la mutation. */
  versionBefore: number
  /** Version après. Égale à `versionBefore` si la mutation a été refusée. */
  versionAfter: number
  /** Version revendiquée par l'appelant, quand la mutation en exige une. */
  basedOnVersion: number | null
  outcome: 'applied' | 'refused'
  /** Motif du refus, ou résumé d'une ligne de ce qui a été appliqué. */
  detail: string
  at: number
}

export type TaskState = {
  /** Figure dans l'URL : /t/:id */
  id: string
  title: string
  /** Incrémenté à CHAQUE écriture appliquée. Jamais décrémenté, jamais réutilisé. */
  version: number
  /** La prochaine action, en une phrase. `null` quand la tâche est terminée. */
  next: string | null
  status: TaskStatus
  /** Instantané final, rempli par `complete_task`. */
  summary: string | null
  constraints: Constraint[]
  steps: Step[]
  decisions: Decision[]
  rejected: Rejection[]
  audit: AuditEntry[]
  createdAt: number
  updatedAt: number
}

/** Version du schéma persisté. Incrémenter impose d'écrire une migration. */
export const SCHEMA_VERSION = 1
