export type Confidence = 'human_verified' | 'evidence' | 'claimed'

export const CONFIDENCE_ORDER: readonly Confidence[] = [
  'human_verified',
  'evidence',
  'claimed',
] as const

export type EvidenceKind = 'command_output' | 'diff' | 'url' | 'hash' | 'test_report'

export const EVIDENCE_KINDS: readonly EvidenceKind[] = [
  'command_output',
  'diff',
  'url',
  'hash',
  'test_report',
] as const

export type Actor = 'human' | 'agent'

export type TaskStatus = 'active' | 'completed'

export type Standing = 'proposed' | 'accepted' | 'declined'

export type Evidence = {
  kind: EvidenceKind
  content: string
  verifiedAt: number | null
}

export type Constraint = {
  id: string
  rule: string
  source: Actor
  addedAtVersion: number
  active: boolean
  standing: Standing
}

export type Step = {
  id: string
  action: string
  result: string
  evidence: Evidence | null
  confidence: Confidence
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
  reason: string
  source: Actor
  addedAtVersion: number
  standing: Standing
  at: number
}

export type AuditEntry = {
  id: string
  operation: string
  actor: Actor
  versionBefore: number
  versionAfter: number
  basedOnVersion: number | null
  outcome: 'applied' | 'refused'
  detail: string
  repeated?: number
  at: number
}

export type MutationRecord = {
  id: string
  operation: string
  version: number
  fingerprint: string
  result: string
  at: number
}

export const MAX_AUDIT_ENTRIES = 200

export const MAX_MUTATION_RECORDS = 100

export type TaskState = {
  id: string
  title: string
  version: number
  next: string | null
  status: TaskStatus
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

export const SCHEMA_VERSION = 3
