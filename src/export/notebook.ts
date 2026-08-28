import { renderTaskState } from '../domain/render'
import type { TaskState } from '../domain/types'

function horodatage(at: number): string {
  try {
    return new Date(at).toISOString()
  } catch {
    return `unreadable timestamp (${at})`
  }
}

function bloc(contenu: string, langue = ''): string[] {
  const plusLongue = (contenu.match(/`+/g) ?? []).reduce((n, m) => Math.max(n, m.length), 0)
  const clôture = '`'.repeat(Math.max(3, plusLongue + 1))
  return [`${clôture}${langue}`, contenu, clôture]
}

function enTete(task: TaskState): string[] {
  return [
    `# ${task.title}`,
    '',
    `- Task id: \`${task.id}\``,
    `- Version: ${task.version}`,
    `- Status: ${task.status}${task.archived ? ' (archived)' : ''}`,
    `- Created: ${horodatage(task.createdAt)}`,
    `- Last write: ${horodatage(task.updatedAt)}`,
    '',
    'Credentials are never exported. This file carries names and work, never a',
    'sealed value.',
    '',
  ]
}

function questions(task: TaskState): string[] {
  if (task.questions.length === 0) return []

  const blocs = task.questions.flatMap((q) => [
    `### ${q.question}`,
    '',
    `- Asked by: ${q.source} at v${q.addedAtVersion}`,
    `- Why it blocks: ${q.why}`,
    `- Answer: ${q.answer === null ? '**still open — nobody has answered**' : q.answer}`,
    ...(q.answeredAt === null ? [] : [`- Answered: ${horodatage(q.answeredAt)}`]),
    '',
  ])

  return [
    '## Questions and answers',
    '',
    'What an agent stopped for rather than guess, and what a human answered.',
    '',
    ...blocs,
  ]
}

function journal(task: TaskState): string[] {
  if (task.audit.length === 0) return []
  return [
    '## Write log',
    '',
    '| When | Who | Operation | Version | Outcome | Detail |',
    '|---|---|---|---|---|---|',
    ...task.audit.map((e) => {
      const versions =
        e.versionBefore === e.versionAfter
          ? `v${e.versionBefore}`
          : `v${e.versionBefore} → v${e.versionAfter}`
      const issue = e.outcome === 'refused' ? '**refused**' : 'applied'
      const répété = e.repeated && e.repeated > 1 ? ` (×${e.repeated})` : ''
      const détail = e.detail.replace(/\|/g, '\\|').replace(/\n/g, ' ')
      return `| ${horodatage(e.at)} | ${e.actor} | \`${e.operation}\` | ${versions} | ${issue}${répété} | ${détail} |`
    }),
    '',
  ]
}

function preuves(task: TaskState): string[] {
  const avecPreuve = task.steps.filter((s) => s.evidence !== null)
  if (avecPreuve.length === 0) return []

  const blocs = avecPreuve.flatMap((s) => [
    `### ${s.action}`,
    '',
    `- Confidence: \`${s.confidence}\``,
    `- Evidence kind: \`${s.evidence!.kind}\``,
    `- Checked by a human: ${s.evidence!.verifiedAt ? horodatage(s.evidence!.verifiedAt) : 'no'}`,
    '',
    ...bloc(s.evidence!.content),
    '',
  ])

  return [
    '## Attached evidence',
    '',
    'The compact state shows only how much each step is trusted. Here is the',
    'evidence in full — this is where a claim holds up, or does not.',
    '',
    ...blocs,
  ]
}

export function buildTaskExport(task: TaskState): string {
  return [
    ...enTete(task),
    '## What `resume_task` returns',
    '',
    ...bloc(
      renderTaskState(task, {
        recentSteps: task.steps.length,
        recentDecisions: task.decisions.length,
      }),
    ),
    '',
    ...preuves(task),
    ...questions(task),
    ...journal(task),
    '## Full state',
    '',
    'This block is what an import reads. Everything above is for you.',
    '',
    ...bloc(JSON.stringify(task, null, 2), 'json'),
    '',
  ].join('\n')
}

export function buildFullExport(tasks: readonly TaskState[]): string {
  if (tasks.length === 0) return '# No watch log on this device\n'
  return [
    `# ${tasks.length} watch log${tasks.length > 1 ? 's' : ''}`,
    '',
    ...tasks.map(
      (t) =>
        `- ${t.title} — v${t.version}, ${t.steps.length} step${t.steps.length === 1 ? '' : 's'}`,
    ),
    '',
    '---',
    '',
    tasks.map(buildTaskExport).join('\n---\n\n'),
  ].join('\n')
}

export function exportFilename(task: TaskState | null): string {
  if (!task) return 'watch-logs.md'
  const base = task.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
  return `watch-log-${base || task.id}-v${task.version}.md`
}
