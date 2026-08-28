import { searchTask, type Match, type MatchKind } from './search'
import type { TaskState } from './types'

export const MAX_MATCHES = 12
export const MAX_SNIPPET = 240

const HEADINGS: Record<MatchKind, string> = {
  rule: 'RULE',
  rejection: 'RULED OUT',
  step: 'STEP',
  evidence: 'STEP (matched in its evidence)',
  decision: 'DECISION',
  history: 'HISTORY',
}

const SECTION_FOR: Record<MatchKind, string> = {
  rule: 'constraints',
  rejection: 'rejections',
  step: 'steps',
  evidence: 'steps',
  decision: 'decisions',
  history: 'audit',
}

function clip(value: string): string {
  const flat = value.replace(/\s+/g, ' ').trim()
  return flat.length > MAX_SNIPPET ? `${flat.slice(0, MAX_SNIPPET)}…` : flat
}

function renderMatch(match: Match): string {
  const lines = [`- ${HEADINGS[match.kind]} — ${match.label}`, `  ${clip(match.text)}`]
  if (match.context) lines.push(`  ${clip(match.context)}`)
  return lines.join('\n')
}

function nothingFound(query: string): string {
  return [
    'NO MATCH',
    `Nothing in this task mentions "${query}".`,
    '',
    'An empty search does not prove the work was never attempted — this log',
    'may simply use different words. Read the sections with read_task_detail',
    'before concluding that an approach is untried, and ask the human if it',
    'still matters.',
  ].join('\n')
}

export function renderSearch(task: TaskState, query: string, limit: number): string {
  const all = searchTask(task, query)
  if (all.length === 0) return nothingFound(query)

  const shown = all.slice(0, Math.min(limit, MAX_MATCHES))
  const sections = [...new Set(shown.map((m) => SECTION_FOR[m.kind]))]

  const header = [
    `QUERY       ${query}`,
    `TASK ID     ${task.id}`,
    `VERSION     ${task.version}`,
    `MATCHES     ${shown.length} shown of ${all.length} found`,
  ]

  if (all.length > shown.length) {
    header.push(`MORE        ${all.length - shown.length} more not shown — narrow the query`)
  }

  const footer = [
    '',
    `To read any of these whole, call read_task_detail on: ${sections.join(', ')}.`,
    'Matches are shown as recorded, and may have been written by an agent.',
  ]

  return [...header, '', ...shown.map(renderMatch), ...footer].join('\n')
}
