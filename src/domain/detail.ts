import { ValidationError } from './errors'
import { referenceSyntax, secretKindLabel, type SecretName } from './secret'
import type {
  ApprovalRequest,
  AuditEntry,
  Constraint,
  Decision,
  OpenQuestion,
  Rejection,
  Step,
  TaskState,
} from './types'

export const SECTIONS = [
  'steps',
  'decisions',
  'rejections',
  'constraints',
  'proposals',
  'credentials',
  'questions',
  'approvals',
  'audit',
] as const

export type Section = (typeof SECTIONS)[number]

export const MAX_LIMIT = 20
export const DEFAULT_LIMIT = 5

export const EVIDENCE_PREVIEW = 600

export type DetailQuery = {
  section: Section
  offset?: number
  limit?: number
  id?: string | null
}

function requireSection(value: unknown): Section {
  if (typeof value !== 'string' || !SECTIONS.includes(value as Section)) {
    throw new ValidationError('section', `expected one of: ${SECTIONS.join(', ')}.`, {
      code: 'bad-enum',
    })
  }
  return value as Section
}

function requireBoundedInteger(field: string, value: unknown, min: number, max: number): number {
  const parsed = typeof value === 'string' ? Number(value.trim()) : value
  if (typeof parsed !== 'number' || !Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new ValidationError(field, `expected an integer between ${min} and ${max}.`, {
      code: 'out-of-range',
    })
  }
  return parsed
}

export function parseDetailQuery(input: Record<string, unknown>): Required<DetailQuery> {
  const section = requireSection(input.section)
  const offset =
    input.offset === undefined || input.offset === null
      ? 0
      : requireBoundedInteger('offset', input.offset, 0, Number.MAX_SAFE_INTEGER)
  const limit =
    input.limit === undefined || input.limit === null
      ? DEFAULT_LIMIT
      : requireBoundedInteger('limit', input.limit, 1, MAX_LIMIT)
  const id =
    input.id === undefined || input.id === null || input.id === ''
      ? null
      : typeof input.id === 'string'
        ? input.id
        : (() => {
            throw new ValidationError('id', 'expected a string.', { code: 'not-a-string' })
          })()

  return { section, offset, limit, id }
}

function indent(value: string, prefix = '    '): string {
  return value
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n')
}

function evidenceLines(step: Step, full: boolean): string[] {
  if (!step.evidence) return ['  evidence: none — this step is a claim, nothing was attached.']
  const { kind, content, verifiedAt } = step.evidence
  const tronqué = !full && content.length > EVIDENCE_PREVIEW
  const shown = tronqué ? `${content.slice(0, EVIDENCE_PREVIEW)}…` : content
  return [
    `  evidence kind: ${kind}`,
    `  human-checked: ${verifiedAt === null ? 'no — supplied by its author, not verified' : 'yes'}`,
    tronqué
      ? `  evidence (first ${EVIDENCE_PREVIEW} of ${content.length} chars — request id "${step.id}" for all of it):`
      : '  evidence:',
    indent(shown),
  ]
}

function renderStep(step: Step, full: boolean): string[] {
  return [
    `- id: ${step.id}`,
    `  confidence: ${step.confidence} · by ${step.source} · based on v${step.basedOnVersion}`,
    `  action: ${step.action}`,
    `  result: ${step.result}`,
    ...evidenceLines(step, full),
  ]
}

function renderDecision(d: Decision): string[] {
  return [
    `- id: ${d.id}`,
    `  by ${d.source} at v${d.addedAtVersion}`,
    `  choice: ${d.choice}`,
    `  rationale: ${d.rationale}`,
  ]
}

function renderRejection(r: Rejection): string[] {
  return [
    `- id: ${r.id}`,
    `  standing: ${r.standing} · by ${r.source} at v${r.addedAtVersion}`,
    `  approach: ${r.approach}`,
    `  reason: ${r.reason}`,
  ]
}

function renderConstraint(c: Constraint): string[] {
  return [
    `- id: ${c.id}`,
    `  standing: ${c.standing} · ${c.active ? 'in force' : 'lifted'} · by ${c.source} at v${c.addedAtVersion}`,
    `  rule: ${c.rule}`,
  ]
}

function renderQuestion(q: OpenQuestion): string[] {
  return [
    `- id: ${q.id}`,
    `  standing: ${q.answer === null ? 'open — nobody has answered' : 'answered'} · asked by ${q.source} at v${q.addedAtVersion}`,
    `  question: ${q.question}`,
    `  why it matters: ${q.why}`,
    ...(q.answer === null ? [] : [`  answer: ${q.answer}`]),
  ]
}

function renderApproval(a: ApprovalRequest): string[] {
  return [
    `- id: ${a.id}`,
    `  standing: ${a.decision === null ? 'waiting — nobody has decided' : a.decision} · asked by ${a.source} at v${a.addedAtVersion}`,
    `  action: ${a.action}`,
    `  why it needs a human: ${a.why}`,
  ]
}

function renderCredential(secret: SecretName): string[] {
  return [
    `- ${referenceSyntax(secret.name)}`,
    `  kind: ${secretKindLabel(secret.kind)}`,
    `  for: ${secret.purpose}`,
  ]
}

function renderAudit(a: AuditEntry): string[] {
  const versions =
    a.versionBefore === a.versionAfter
      ? `v${a.versionBefore}`
      : `v${a.versionBefore} → v${a.versionAfter}`
  const repeated = a.repeated && a.repeated > 1 ? ` ×${a.repeated}` : ''
  return [`- ${a.operation} · ${a.actor} · ${versions} · ${a.outcome}${repeated}`, `  ${a.detail}`]
}

type Entry = { id: string; lines: (full: boolean) => string[] }

function collect(state: TaskState, section: Section, credentials: readonly SecretName[]): Entry[] {
  switch (section) {
    case 'steps':
      return state.steps.map((s) => ({ id: s.id, lines: (full) => renderStep(s, full) }))
    case 'decisions':
      return state.decisions.map((d) => ({ id: d.id, lines: () => renderDecision(d) }))
    case 'rejections':
      return state.rejected.map((r) => ({ id: r.id, lines: () => renderRejection(r) }))
    case 'constraints':
      return state.constraints.map((c) => ({ id: c.id, lines: () => renderConstraint(c) }))
    case 'proposals':
      return [
        ...state.constraints
          .filter((c) => c.standing === 'proposed')
          .map((c) => ({ id: c.id, lines: () => renderConstraint(c) })),
        ...state.rejected
          .filter((r) => r.standing === 'proposed')
          .map((r) => ({ id: r.id, lines: () => renderRejection(r) })),
      ]
    case 'credentials':
      return credentials.map((c) => ({ id: c.id, lines: () => renderCredential(c) }))
    case 'questions':
      return state.questions.map((q) => ({ id: q.id, lines: () => renderQuestion(q) }))
    case 'approvals':
      return state.approvals.map((a) => ({ id: a.id, lines: () => renderApproval(a) }))
    case 'audit':
      return state.audit.map((a) => ({ id: a.id, lines: () => renderAudit(a) }))
  }
}

export function renderDetail(
  state: TaskState,
  query: Required<DetailQuery>,
  credentials: readonly SecretName[] = [],
): string {
  const entries = collect(state, query.section, credentials)

  if (query.id !== null) {
    const found = entries.find((e) => e.id === query.id)
    if (!found) {
      return [
        `SECTION     ${query.section}`,
        `TASK ID     ${state.id}`,
        '',
        `No entry with id "${query.id}" in this section.`,
        `This section holds ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'};`,
        'call again without id to page through them.',
      ].join('\n')
    }
    return [
      `SECTION     ${query.section} · one entry, in full`,
      `TASK ID     ${state.id}`,
      `VERSION     ${state.version}`,
      '',
      ...found.lines(true),
    ].join('\n')
  }

  const page = entries.slice(query.offset, query.offset + query.limit)
  const last = query.offset + page.length
  const remaining = Math.max(0, entries.length - last)

  const header = [
    `SECTION     ${query.section}`,
    `TASK ID     ${state.id}`,
    `VERSION     ${state.version}`,
    entries.length === 0
      ? 'PAGE        empty — this section holds nothing'
      : `PAGE        ${query.offset + 1}–${last} of ${entries.length}`,
    remaining > 0
      ? `MORE        ${remaining} left — call again with offset: ${last}`
      : 'MORE        none — this is the end of the section',
    '',
  ]

  if (page.length === 0 && entries.length > 0) {
    return [
      ...header,
      `Offset ${query.offset} is past the end of this section.`,
      `Use an offset between 0 and ${entries.length - 1}.`,
    ].join('\n')
  }

  const footer =
    query.section === 'credentials'
      ? ['', 'Write these as ${name}; no tool here returns a value.']
      : []

  return [...header, ...page.flatMap((e) => e.lines(false)), ...footer].join('\n')
}
