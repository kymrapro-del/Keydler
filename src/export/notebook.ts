import { renderTaskState } from '../domain/render'
import type { TaskState } from '../domain/types'

/**
 * Export d'un cahier.
 *
 * Le protocole de mesure exige que les journaux soient versés au dépôt pour
 * qu'un tiers reproduise. Sans export, ils ne sortent que par une lecture
 * manuelle d'IndexedDB — ce qu'un essai a signalé comme un obstacle réel, et
 * ce qui m'a fait détruire sept cahiers en réinitialisant entre deux essais.
 *
 * Deux formats dans un seul fichier : la restitution compacte en tête, lisible
 * telle quelle, et l'état complet en JSON pour rejouer ou vérifier.
 */

const horodatage = (at: number) => new Date(at).toISOString()

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

/** Le journal d'audit en tableau : qui a écrit quoi, quand, et ce qui a été refusé. */
function journal(task: TaskState): string[] {
  if (task.audit.length === 0) return []
  return [
    "## Journal des écritures",
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

/** Les preuves jointes, que la restitution compacte ne montre jamais. */
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
    '```',
    s.evidence!.content,
    '```',
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
    '```',
    renderTaskState(task, {
      recentSteps: task.steps.length,
      recentDecisions: task.decisions.length,
    }),
    '```',
    '',
    ...preuves(task),
    ...journal(task),
    '## État complet',
    '',
    '```json',
    JSON.stringify(task, null, 2),
    '```',
    '',
  ].join('\n')
}

/** Tous les cahiers d'un appareil, pour récolter une campagne de mesure. */
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

/** Nom de fichier stable et triable, sans caractère hasardeux. */
export function exportFilename(task: TaskState | null): string {
  if (!task) return 'cahiers.md'
  const base = task.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
  return `cahier-${base || task.id}-v${task.version}.md`
}
