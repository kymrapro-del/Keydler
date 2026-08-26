/**
 * Modèle de domaine du cahier de quart (TAL-65).
 *
 * Ces types sont la source de vérité du produit. Ils sont purs : aucune
 * dépendance à React, au DOM, à IndexedDB ni à WebMCP. Toute couche qui les
 * consomme s'adapte à eux, jamais l'inverse.
 */

/**
 * Degré de preuve attaché à une étape, du plus fort au plus faible.
 *
 * Il n'existe PAS de degré « vérifié machine » accessible à un agent. Une
 * version antérieure en accordait un dès que la preuve jointe était étiquetée
 * `command_output` ou `test_report` — c'est-à-dire sur la seule parole de
 * l'agent, qui choisit l'étiquette comme il choisit le contenu. Rien n'avait
 * été vérifié par une machine : un texte avait été recopié. Le mot promettait
 * à l'humain une garantie que le système n'avait jamais obtenue.
 *
 * Ce qu'un agent apporte est donc AU MIEUX `evidence` : quelque chose est
 * joint, et reste à lire. Seul un clic humain, porté sur le contenu affiché,
 * atteint `human_verified`.
 */
export type Confidence = 'human_verified' | 'evidence' | 'claimed'

/** Ordre décroissant de force. Sert à l'affichage et aux compteurs. */
export const CONFIDENCE_ORDER: readonly Confidence[] = [
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

/**
 * Force d'une règle ou d'un rejet.
 *
 * `proposed` : écrit par un agent, non encore endossé. Consultable, jamais
 * opposable — un agent ne peut pas se donner à lui-même, ni donner à la
 * conversation suivante, un interdit que personne n'a validé.
 *
 * `accepted` : écrit par l'humain, ou approuvé par lui d'un clic. Autoritaire.
 *
 * `declined` : écarté par l'humain. Conservé, car savoir qu'une proposition a
 * été refusée vaut mieux que la voir reproposée à l'identique.
 */
export type Standing = 'proposed' | 'accepted' | 'declined'

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
  /** Une règle acceptée peut être levée sans être refusée. */
  active: boolean
  standing: Standing
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
  standing: Standing
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
  /**
   * Nombre de fois que la même tentative s'est répétée d'affilée. Absent vaut
   * une. Un agent bloqué sur une version périmée réessaie à l'identique : on
   * compte plutôt que d'empiler.
   */
  repeated?: number
  at: number
}

/**
 * Trace d'une écriture d'agent appliquée, retrouvée par le `mutation_id` que
 * l'appelant a fourni.
 *
 * Elle existe pour une raison précise : la spécification WebMCP JETTE le
 * résultat d'une exécution annulée — l'écriture a lieu, l'agent n'en voit
 * jamais la réponse. Sans mémoire du `mutation_id`, son réessai naturel crée un
 * doublon. Avec elle, le réessai retrouve la réponse exacte du premier appel.
 *
 * Le texte rendu est conservé tel quel, plutôt que recalculé : c'est la seule
 * façon que « restituer le résultat du premier appel » soit littéralement vrai
 * et non « en reconstruire un qui devrait lui ressembler ».
 */
export type MutationRecord = {
  /** Fourni par l'agent, unique dans ce cahier. */
  id: string
  operation: string
  /** Version produite par l'application initiale. */
  version: number
  /**
   * Empreinte de l'intention validée : l'opération et ses arguments, sous une
   * forme canonique indépendante de l'ordre des clés.
   *
   * Sans elle, le jeton seul ne distinguait pas un rejeu d'une COLLISION —
   * deux travaux différents arrivés sous le même identifiant. Le second était
   * alors accueilli par la réponse du premier : jamais écrit, et pourtant
   * accusé réception.
   */
  fingerprint: string
  /** Réponse exacte rendue au premier appel. */
  result: string
  at: number
}

/**
 * Borne du journal d'audit.
 *
 * L'état entier est resérialisé à chaque écriture : un journal sans borne rend
 * le coût d'écriture quadratique et finit par peser sur la page. On élague le
 * plus ancien en disant combien, plutôt que de laisser filer ou de perdre en
 * silence.
 */
export const MAX_AUDIT_ENTRIES = 200

/**
 * Borne des mutations mémorisées.
 *
 * Même raison que le journal. La conséquence d'un élagage est bornée elle
 * aussi : un réessai sur un `mutation_id` oublié redevient une écriture
 * ordinaire, qui sera refusée pour version périmée plutôt qu'appliquée en
 * double — l'agent reçoit un refus lisible, pas un doublon silencieux.
 */
export const MAX_MUTATION_RECORDS = 100

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
  mutations: MutationRecord[]
  createdAt: number
  updatedAt: number
}

/**
 * Version du schéma persisté. Incrémenter impose d'écrire une migration.
 *
 * v2 : les contraintes et rejets portent un `standing`, le cahier porte ses
 * `mutations`, et `machine_verified` disparaît des degrés atteignables.
 * v3 : chaque mutation mémorisée porte l'empreinte de son intention.
 */
export const SCHEMA_VERSION = 3
