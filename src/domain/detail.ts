import { ValidationError } from './errors'
import type { AuditEntry, Constraint, Decision, Rejection, Step, TaskState } from './types'

/**
 * Lecture détaillée du cahier.
 *
 * `resume_task` tient sous 400 tokens, et il le tient en coupant : les preuves
 * y sont réduites à un degré, les étapes anciennes à un compte, les motifs à
 * une ligne. C'était jusqu'ici sans recours — le contenu entier n'existait que
 * dans l'export Markdown, qui ne s'ouvre qu'avec des mains humaines. Un agent
 * qui voulait relire la sortie de test qu'il avait lui-même jointe la veille
 * n'avait aucun moyen de le faire, et devait la reproduire.
 *
 * Ce module rend ce que le résumé a coupé, sans jamais rendre tout d'un coup :
 * une section à la fois, une page à la fois, ou un élément nommé en entier.
 *
 * Il ne mute rien. C'est le seul autre outil en lecture seule du produit, et le
 * seul qui puisse dépasser le budget de tokens du pointeur — parce qu'ici,
 * c'est l'agent qui demande, en sachant ce qu'il demande.
 */

export const SECTIONS = [
  'steps',
  'decisions',
  'rejections',
  'constraints',
  'proposals',
  'audit',
] as const

export type Section = (typeof SECTIONS)[number]

/** Éléments rendus par page. Plus haut, la réponse cesse d'être lisible. */
export const MAX_LIMIT = 20
export const DEFAULT_LIMIT = 5

/**
 * Longueur d'aperçu d'une preuve en mode paginé.
 *
 * Cinq preuves de 8000 caractères feraient une réponse de 10 000 tokens, soit
 * vingt-cinq fois le budget du pointeur : la pagination n'aurait rien borné.
 * En liste, on donne de quoi reconnaître ; pour le contenu entier, on nomme
 * l'étape — c'est exactement ce que « ciblé ou paginé » veut dire.
 */
export const EVIDENCE_PREVIEW = 600

export type DetailQuery = {
  section: Section
  offset?: number
  limit?: number
  /** Identifiant d'un élément précis. Le rend en entier, hors pagination. */
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
    // Une preuve jointe par un agent n'atteste de rien tant que personne ne
    // l'a lue. Le dire ici évite qu'elle se lise comme une vérification.
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

function renderAudit(a: AuditEntry): string[] {
  const versions =
    a.versionBefore === a.versionAfter
      ? `v${a.versionBefore}`
      : `v${a.versionBefore} → v${a.versionAfter}`
  const repeated = a.repeated && a.repeated > 1 ? ` ×${a.repeated}` : ''
  return [`- ${a.operation} · ${a.actor} · ${versions} · ${a.outcome}${repeated}`, `  ${a.detail}`]
}

type Entry = { id: string; lines: (full: boolean) => string[] }

function collect(state: TaskState, section: Section): Entry[] {
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
    case 'audit':
      return state.audit.map((a) => ({ id: a.id, lines: () => renderAudit(a) }))
  }
}

/**
 * Rend une page de détail, ou un élément nommé en entier.
 *
 * L'en-tête dit toujours où l'on est dans la collection et s'il reste quelque
 * chose : sans cela, une page vide et une collection épuisée se lisent pareil,
 * et l'agent doit deviner s'il doit redemander.
 */
export function renderDetail(state: TaskState, query: Required<DetailQuery>): string {
  const entries = collect(state, query.section)

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

  return [...header, ...page.flatMap((e) => e.lines(false))].join('\n')
}
