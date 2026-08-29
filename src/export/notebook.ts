import { renderTaskState } from '../domain/render'
import type { TaskState } from '../domain/types'

function timestamp(at: number): string {
  try {
    return new Date(at).toISOString()
  } catch {
    return `unreadable timestamp (${at})`
  }
}

function codeBlock(content: string, language = ''): string[] {
  const longestRun = (content.match(/`+/g) ?? []).reduce((n, m) => Math.max(n, m.length), 0)
  const fence = '`'.repeat(Math.max(3, longestRun + 1))
  return [`${fence}${language}`, content, fence]
}

function header(task: TaskState): string[] {
  return [
    `# ${task.title}`,
    '',
    `- Task id: \`${task.id}\``,
    `- Version: ${task.version}`,
    `- Status: ${task.status}${task.archived ? ' (archived)' : ''}`,
    `- Created: ${timestamp(task.createdAt)}`,
    `- Last write: ${timestamp(task.updatedAt)}`,
    '',
    'Credentials are never exported. This file carries names and work, never a',
    'sealed value.',
    '',
  ]
}

function questions(task: TaskState): string[] {
  if (task.questions.length === 0) return []

  const blocks = task.questions.flatMap((q) => [
    `### ${q.question}`,
    '',
    `- Asked by: ${q.source} at v${q.addedAtVersion}`,
    `- Why it blocks: ${q.why}`,
    `- Answer: ${q.answer === null ? '**still open, nobody has answered**' : q.answer}`,
    ...(q.answeredAt === null ? [] : [`- Answered: ${timestamp(q.answeredAt)}`]),
    '',
  ])

  return [
    '## Questions and answers',
    '',
    'What an agent stopped for rather than guess, and what a human answered.',
    '',
    ...blocks,
  ]
}

function approvals(task: TaskState): string[] {
  if (task.approvals.length === 0) return []

  const blocks = task.approvals.flatMap((a) => [
    `### ${a.action}`,
    '',
    `- Asked by: ${a.source} at v${a.addedAtVersion}`,
    `- Why it needed a human: ${a.why}`,
    `- Decision: ${a.decision === null ? '**never decided, nobody answered**' : a.decision}`,
    ...(a.decidedAt === null ? [] : [`- Decided: ${timestamp(a.decidedAt)}`]),
    '',
  ])

  return [
    '## Permission asked',
    '',
    'What an agent stopped to ask before acting, and what was decided.',
    '',
    ...blocks,
  ]
}

function writeLog(task: TaskState): string[] {
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
      const repeated = e.repeated && e.repeated > 1 ? ` (×${e.repeated})` : ''
      const detail = e.detail.replace(/\|/g, '\\|').replace(/\n/g, ' ')
      return `| ${timestamp(e.at)} | ${e.actor} | \`${e.operation}\` | ${versions} | ${issue}${repeated} | ${detail} |`
    }),
    '',
  ]
}

function evidence(task: TaskState): string[] {
  const stepsWithEvidence = task.steps.filter((s) => s.evidence !== null)
  if (stepsWithEvidence.length === 0) return []

  const blocks = stepsWithEvidence.flatMap((s) => [
    `### ${s.action}`,
    '',
    `- Confidence: \`${s.confidence}\``,
    ...(s.dispute ? [`- **DISPUTED by the human:** ${s.dispute.reason}`] : []),
    `- Evidence kind: \`${s.evidence!.kind}\``,
    `- Checked by a human: ${s.evidence!.verifiedAt ? timestamp(s.evidence!.verifiedAt) : 'no'}`,
    '',
    ...codeBlock(s.evidence!.content),
    '',
  ])

  return [
    '## Attached evidence',
    '',
    'The compact state shows only how much each step is trusted. Here is the',
    'evidence in full: this is where a claim holds up, or does not.',
    '',
    ...blocks,
  ]
}

export function buildTaskExport(task: TaskState): string {
  return [
    ...header(task),
    '## What `resume_task` returns',
    '',
    ...codeBlock(
      renderTaskState(task, {
        recentSteps: task.steps.length,
        recentDecisions: task.decisions.length,
      }),
    ),
    '',
    ...evidence(task),
    ...questions(task),
    ...approvals(task),
    ...writeLog(task),
    '## Full state',
    '',
    'This block is what an import reads. Everything above is for you.',
    '',
    ...codeBlock(JSON.stringify(task, null, 2), 'json'),
    '',
  ].join('\n')
}

export function buildFullExport(tasks: readonly TaskState[]): string {
  if (tasks.length === 0) return '# No Keydler log on this device\n'
  return [
    `# ${tasks.length} log${tasks.length > 1 ? 's' : ''} from Keydler`,
    '',
    ...tasks.map(
      (t) =>
        `- ${t.title} (v${t.version}, ${t.steps.length} step${t.steps.length === 1 ? '' : 's'})`,
    ),
    '',
    '---',
    '',
    tasks.map(buildTaskExport).join('\n---\n\n'),
  ].join('\n')
}

export function exportFilename(task: TaskState | null): string {
  if (!task) return 'keydler-logs.md'
  const base = task.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
  return `keydler-${base || task.id}-v${task.version}.md`
}
