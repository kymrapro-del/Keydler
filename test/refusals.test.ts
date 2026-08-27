import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '../src/persistence/db'
import * as store from '../src/store/taskStore'
import { ALL_TOOLS } from '../src/webmcp/tools'
import { exec, mutationId, storeWrite } from './helpers'

async function clear() {
  const db = await getDb()
  const tx = db.transaction(['tasks', 'meta'], 'readwrite')
  await Promise.all([tx.objectStore('tasks').clear(), tx.objectStore('meta').clear(), tx.done])
}

const logStep = () => ALL_TOOLS.find((t) => t.name === 'log_step')!
const rejectApproach = () => ALL_TOOLS.find((t) => t.name === 'reject_approach')!

beforeEach(async () => {
  store.__resetStore()
  await clear()
})

describe('refus consignés', () => {
  it('journalise une version manquante, qui n’atteint jamais la mutation', async () => {
    await store.createAndOpenTask('Tâche', 'Continuer')
    const avant = store.currentTask()!.audit.length

    const result = await logStep().execute({ action: 'a', result: 'b' }, exec())

    expect(result.isError).toBe(true)
    const après = store.currentTask()!
    expect(après.audit.length).toBe(avant + 1)
    expect(après.audit.at(-1)).toMatchObject({ outcome: 'refused', operation: 'log_step' })
    expect(après.version).toBe(1)
  })

  it('journalise une version illisible', async () => {
    await store.createAndOpenTask('Tâche', undefined)

    const result = await logStep().execute(
      { action: 'a', result: 'b', mutation_id: mutationId(), based_on_version: 'plus tard' },
      exec(),
    )

    expect(result.isError).toBe(true)
    expect(store.currentTask()!.audit.at(-1)).toMatchObject({ outcome: 'refused' })
  })

  it('ne consigne pas deux fois un refus déjà journalisé par le magasin', async () => {
    const task = await store.createAndOpenTask('Tâche', undefined)
    const avant = store.currentTask()!.audit.length

    const result = await rejectApproach().execute(
      {
        approach: 'JWT B',
        reason: '   ',
        mutation_id: mutationId(),
        based_on_version: task.version,
      },
      exec(),
    )

    expect(result.isError).toBe(true)
    expect(store.currentTask()!.audit.length).toBe(avant + 1)
  })

  it('dit que rien n’a été écrit et donne la version pour réessayer', async () => {
    const task = await store.createAndOpenTask('Tâche', undefined)

    const result = await rejectApproach().execute(
      { approach: 'JWT B', reason: '', mutation_id: mutationId(), based_on_version: task.version },
      exec(),
    )

    const texte = result.content[0].text
    expect(texte).toContain('INVALID INPUT')
    expect(texte).toContain('Nothing was written.')
    expect(texte).toContain(`based_on_version: ${task.version}`)
  })

  it('n’ajoute pas ce rappel à un refus pour état périmé', async () => {
    const task = await store.createAndOpenTask('Tâche', undefined)
    await store.mutateAsAgent(
      storeWrite('add_constraint', task.version, { rule: 'x' }, (s) => ({
        ...s,
        version: s.version + 1,
      })),
    )
    const result = await logStep().execute(
      { action: 'a', result: 'b', mutation_id: mutationId(), based_on_version: task.version },
      exec(),
    )

    const texte = result.content[0].text
    expect(texte).toContain('STALE STATE')
    // Le rappel « retry with based_on_version » n'a pas de sens ici : la
    // version que l'agent tenait est précisément celle qui a été refusée.
    expect(texte).not.toMatch(/Retry with based_on_version/i)
    // Le refus doit nommer l'outil fait pour ce cas précis, pas seulement la
    // relecture complète : c'est le chemin le plus fréquent d'un agent.
    expect(texte).toContain('what_changed')
    expect(texte).toContain(`since_version: ${task.version}`)
    expect(texte).toContain('resume_task')
  })
})

describe('conseil de réessai', () => {
  it('ne suggère pas de réessayer sur une tâche close', async () => {
    const task = await store.createAndOpenTask('Tâche', undefined)
    const complete = ALL_TOOLS.find((t) => t.name === 'complete_task')!
    await complete.execute(
      { summary: 'Terminé.', mutation_id: mutationId(), based_on_version: task.version },
      exec(),
    )

    const result = await logStep().execute(
      {
        action: 'a',
        result: 'b',
        mutation_id: mutationId(),
        based_on_version: store.currentTask()!.version,
      },
      exec(),
    )

    const texte = result.content[0].text
    expect(result.isError).toBe(true)
    expect(texte).not.toContain('Retry with based_on_version')
    expect(texte).toContain('Retrying will not help')
    expect(texte).toContain('ask the human to reopen')
  })

  it('suggère toujours le réessai quand l’entrée est simplement à corriger', async () => {
    const task = await store.createAndOpenTask('Tâche', undefined)

    const result = await rejectApproach().execute(
      { approach: 'JWT B', reason: '', mutation_id: mutationId(), based_on_version: task.version },
      exec(),
    )

    expect(result.content[0].text).toContain(`Retry with based_on_version: ${task.version}`)
  })
})
