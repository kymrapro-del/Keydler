import { renderTaskState } from '../domain/render'
import type { TaskState } from '../domain/types'

function horodatage(at: number): string {
  try {
    return new Date(at).toISOString()
  } catch {
    return `horodatage illisible (${at})`
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
    `- Identifiant : \`${task.id}\``,
    `- Version : ${task.version}`,
    `- État : ${task.status}`,
    `- Créé : ${horodatage(task.createdAt)}`,
    `- Dernière écriture : ${horodatage(task.updatedAt)}`,
    '',
  ]
}

function journal(task: TaskState): string[] {
  if (task.audit.length === 0) return []
  return [
    '## Journal des écritures',
    '',
    '| Horodatage | Acteur | Opération | Version | Issue | Détail |',
    '|---|---|---|---|---|---|',
    ...task.audit.map((e) => {
      const versions =
        e.versionBefore === e.versionAfter
          ? `v${e.versionBefore}`
          : `v${e.versionBefore} → v${e.versionAfter}`
      const issue = e.outcome === 'refused' ? '**refusé**' : 'appliqué'
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
    `- Degré : \`${s.confidence}\``,
    `- Nature : \`${s.evidence!.kind}\``,
    `- Validée : ${s.evidence!.verifiedAt ? horodatage(s.evidence!.verifiedAt) : 'non'}`,
    '',
    ...bloc(s.evidence!.content),
    '',
  ])

  return [
    '## Preuves jointes',
    '',
    "La restitution compacte n'en montre que le degré. Les voici en entier :",
    "c'est là qu'une affirmation se vérifie, ou se contredit.",
    '',
    ...blocs,
  ]
}

export function buildTaskExport(task: TaskState): string {
  return [
    ...enTete(task),
    '## Ce que `resume_task` restitue',
    '',
    ...bloc(
      renderTaskState(task, {
        recentSteps: task.steps.length,
        recentDecisions: task.decisions.length,
      }),
    ),
    '',
    ...preuves(task),
    ...journal(task),
    '## État complet',
    '',
    ...bloc(JSON.stringify(task, null, 2), 'json'),
    '',
  ].join('\n')
}

export function buildFullExport(tasks: readonly TaskState[]): string {
  if (tasks.length === 0) return '# Aucun cahier sur cet appareil\n'
  return [
    `# ${tasks.length} cahier${tasks.length > 1 ? 's' : ''}`,
    '',
    ...tasks.map((t) => `- ${t.title} — v${t.version}, ${t.steps.length} étapes`),
    '',
    '---',
    '',
    tasks.map(buildTaskExport).join('\n---\n\n'),
  ].join('\n')
}

export function exportFilename(task: TaskState | null): string {
  if (!task) return 'cahiers.md'
  const base = task.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
  return `cahier-${base || task.id}-v${task.version}.md`
}
