import { describe, expect, it } from 'vitest'
import { buildMeasureTask } from '../src/demo/measures'
import { buildDemoTask } from '../src/demo/seed'
import { buildFullExport, buildTaskExport, exportFilename } from '../src/export/notebook'
import { logStep, recordRefusal } from '../src/domain/task'

/**
 * L'export est ce qui rend une campagne de mesure vérifiable par un tiers :
 * sans lui, les journaux ne sortent que par une lecture manuelle d'IndexedDB.
 */
describe('export d’un cahier', () => {
  it('montre le contenu des preuves, que la restitution compacte cache', () => {
    const sortie = buildTaskExport(buildDemoTask())
    // C'est là qu'une affirmation se vérifie — ou se contredit.
    expect(sortie).toContain('## Preuves jointes')
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
    expect(sortie).toContain('## Journal des écritures')
    expect(sortie).toContain('**refusé**')
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
    expect(sortie).toContain('# 3 cahiers')
    for (const t of tasks) expect(sortie).toContain(t.title)
  })

  it('dit clairement qu’il n’y a rien à récolter', () => {
    expect(buildFullExport([])).toContain('Aucun cahier')
  })

  it('donne un nom de fichier stable et sans caractère hasardeux', () => {
    const task = buildMeasureTask(5)
    const nom = exportFilename(task)
    expect(nom).toMatch(/^cahier-[a-z0-9-]+-v\d+\.md$/)
    expect(exportFilename(task)).toBe(nom)
  })
})
