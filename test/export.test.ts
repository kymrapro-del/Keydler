import { describe, expect, it } from 'vitest'
import { buildMeasureTask } from '../src/demo/measures'
import { buildDemoTask } from '../src/demo/seed'
import { buildFullExport, buildTaskExport, exportFilename } from '../src/export/notebook'
import { completeTask, logStep, recordRefusal } from '../src/domain/task'

describe('export d’un cahier', () => {
  it('montre le contenu des preuves, que la restitution compacte cache', () => {
    const sortie = buildTaskExport(buildDemoTask())
    expect(sortie).toContain('## Attached evidence')
    expect(sortie).toContain('auth suite — 183 passed, 0 failed, 0 skipped')
    expect(sortie).toContain('bench --auth-refresh')
  })

  it('rend le journal des écritures, refus compris', () => {
    let task = buildMeasureTask(1)
    task = recordRefusal(task, {
      operation: 'log_step',
      actor: 'agent',
      basedOnVersion: 1,
      detail: 'stale write on v1',
    })

    const sortie = buildTaskExport(task)
    expect(sortie).toContain('## Write log')
    expect(sortie).toContain('**refused**')
    expect(sortie).toContain('`log_step`')
  })

  it('n’égare pas un détail contenant une barre verticale dans le tableau', () => {
    let task = buildMeasureTask(2)
    task = logStep(
      task,
      { action: 'a | b | c', result: 'r', basedOnVersion: task.version },
      'agent',
    )
    const ligne = buildTaskExport(task)
      .split('\n')
      .find((l) => l.includes('a \\| b \\| c'))
    expect(ligne).toBeDefined()
  })

  it('joint l’état complet, pour rejouer ou vérifier', () => {
    const task = buildMeasureTask(3)
    const sortie = buildTaskExport(task)
    const json = sortie.split('```json\n')[1].split('\n```')[0]
    expect(JSON.parse(json).id).toBe(task.id)
    expect(JSON.parse(json).version).toBe(task.version)
  })

  it('récolte tous les cahiers d’un appareil en un fichier', () => {
    const tasks = [buildMeasureTask(1), buildMeasureTask(2), buildMeasureTask(3)]
    const sortie = buildFullExport(tasks)
    expect(sortie).toContain('# 3 watch logs')
    for (const t of tasks) expect(sortie).toContain(t.title)
  })

  it('dit clairement qu’il n’y a rien à récolter', () => {
    expect(buildFullExport([])).toContain('No watch log')
  })

  it('ne laisse pas une preuve refermer le bloc qui la contient', () => {
    let task = buildMeasureTask(4)
    task = logStep(
      task,
      {
        action: 'Sortie contenant une clôture de bloc',
        result: 'r',
        evidence: { kind: 'command_output', content: '```\n# Faux titre injecté\n```' },
        basedOnVersion: task.version,
      },
      'agent',
    )

    const sortie = buildTaskExport(task)

    expect(sortie).toContain('````\n```\n# Faux titre injecté\n```\n````')
  })

  it('survit à un horodatage hors plage plutôt que d’emporter tout l’export', () => {
    const task = { ...buildMeasureTask(5), updatedAt: 1e20 }
    expect(() => buildTaskExport(task)).not.toThrow()
    expect(buildTaskExport(task)).toContain('unreadable timestamp')
  })

  it('donne un nom de fichier stable et sans caractère hasardeux', () => {
    const task = buildMeasureTask(5)
    const nom = exportFilename(task)
    expect(nom).toMatch(/^watch-log-[a-z0-9-]+-v\d+\.md$/)
    expect(exportFilename(task)).toBe(nom)
  })
})

describe('export : cas limites', () => {
  it('omet les sections vides plutôt que d’afficher des titres creux', () => {
    const nu = { ...buildMeasureTask(1), steps: [], audit: [], decisions: [] }
    const sortie = buildTaskExport(nu)
    expect(sortie).not.toContain('## Attached evidence')
    expect(sortie).not.toContain('## Write log')
    expect(sortie).toContain('## Full state')
  })

  it('rend le résumé final d’une tâche close', () => {
    const task = completeTask(
      buildMeasureTask(2),
      { summary: 'Approche retenue et livrée.', basedOnVersion: buildMeasureTask(2).version },
      'agent',
    )
    const sortie = buildTaskExport(task)
    expect(sortie).toContain('- Status: completed')
    expect(sortie).toContain('Approche retenue et livrée.')
  })

  it('marque une preuve validée par un humain, et une autre non', () => {
    let task = buildDemoTask()
    const sortie = buildTaskExport(task)
    expect(sortie).toContain('- Checked by a human: no')
    expect(sortie).toMatch(/- Checked by a human: \d{4}-/)
    task = { ...task, steps: [] }
    expect(buildTaskExport(task)).not.toContain('- Validée :')
  })
})
