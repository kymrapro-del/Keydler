import { describe, expect, it } from 'vitest'
import { buildMeasureTask } from '../src/demo/measures'
import { buildDemoTask } from '../src/demo/seed'
import { buildFullExport, buildTaskExport, exportFilename } from '../src/export/notebook'
import { completeTask, logStep, recordRefusal } from '../src/domain/task'

describe('export d’un cahier', () => {
  it('montre le contenu des preuves, que la restitution compacte cache', () => {
    const output = buildTaskExport(buildDemoTask())
    expect(output).toContain('## Attached evidence')
    expect(output).toContain('auth suite: 183 passed, 0 failed, 0 skipped')
    expect(output).toContain('bench --auth-refresh')
  })

  it('rend le journal des écritures, refus compris', () => {
    let task = buildMeasureTask(1)
    task = recordRefusal(task, {
      operation: 'log_step',
      actor: 'agent',
      basedOnVersion: 1,
      detail: 'stale write on v1',
    })

    const output = buildTaskExport(task)
    expect(output).toContain('## Write log')
    expect(output).toContain('**refused**')
    expect(output).toContain('`log_step`')
  })

  it('n’égare pas un détail contenant une barre verticale dans le tableau', () => {
    let task = buildMeasureTask(2)
    task = logStep(
      task,
      { action: 'a | b | c', result: 'r', basedOnVersion: task.version },
      'agent',
    )
    const line = buildTaskExport(task)
      .split('\n')
      .find((l) => l.includes('a \\| b \\| c'))
    expect(line).toBeDefined()
  })

  it('joint l’état complet, pour rejouer ou vérifier', () => {
    const task = buildMeasureTask(3)
    const output = buildTaskExport(task)
    const json = output.split('```json\n')[1].split('\n```')[0]
    expect(JSON.parse(json).id).toBe(task.id)
    expect(JSON.parse(json).version).toBe(task.version)
  })

  it('récolte tous les cahiers d’un appareil en un fichier', () => {
    const tasks = [buildMeasureTask(1), buildMeasureTask(2), buildMeasureTask(3)]
    const output = buildFullExport(tasks)
    expect(output).toContain('# 3 logs from Keydler')
    for (const t of tasks) expect(output).toContain(t.title)
  })

  it('dit clairement qu’il n’y a rien à récolter', () => {
    expect(buildFullExport([])).toContain('No Keydler log')
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

    const output = buildTaskExport(task)

    expect(output).toContain('````\n```\n# Faux titre injecté\n```\n````')
  })

  it('survit à un horodatage hors plage plutôt que d’emporter tout l’export', () => {
    const task = { ...buildMeasureTask(5), updatedAt: 1e20 }
    expect(() => buildTaskExport(task)).not.toThrow()
    expect(buildTaskExport(task)).toContain('unreadable timestamp')
  })

  it('donne un nom de fichier stable et sans caractère hasardeux', () => {
    const task = buildMeasureTask(5)
    const nom = exportFilename(task)
    expect(nom).toMatch(/^keydler-[a-z0-9-]+-v\d+\.md$/)
    expect(exportFilename(task)).toBe(nom)
  })
})

describe('export : cas limites', () => {
  it('omet les sections vides plutôt que d’afficher des titres creux', () => {
    const nu = { ...buildMeasureTask(1), steps: [], audit: [], decisions: [] }
    const output = buildTaskExport(nu)
    expect(output).not.toContain('## Attached evidence')
    expect(output).not.toContain('## Write log')
    expect(output).toContain('## Full state')
  })

  it('rend le résumé final d’une tâche close', () => {
    const task = completeTask(
      buildMeasureTask(2),
      { summary: 'Approche retenue et livrée.', basedOnVersion: buildMeasureTask(2).version },
      'agent',
    )
    const output = buildTaskExport(task)
    expect(output).toContain('- Status: completed')
    expect(output).toContain('Approche retenue et livrée.')
  })

  it('marque une preuve validée par un humain, et une autre non', () => {
    let task = buildDemoTask()
    const output = buildTaskExport(task)
    expect(output).toContain('- Checked by a human: no')
    expect(output).toMatch(/- Checked by a human: \d{4}-/)
    task = { ...task, steps: [] }
    expect(buildTaskExport(task)).not.toContain('- Validée :')
  })
})
