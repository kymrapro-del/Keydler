import { beforeEach, describe, expect, it } from 'vitest'
import { ConcurrentWriteError } from '../src/domain/errors'
import { addConstraint, logStep } from '../src/domain/task'
import { getDb } from '../src/persistence/db'
import { loadTask, saveTask } from '../src/persistence/taskRepository'
import * as store from '../src/store/taskStore'
import { ALL_TOOLS } from '../src/webmcp/tools'

/**
 * Écriture depuis une autre page.
 *
 * La file d'écriture du magasin ne connaît que son propre onglet. Deux onglets
 * ouverts sur le même cahier — cas banal, et probable pendant une démonstration
 * — reproduiraient sans elle la perte silencieuse que la file élimine à
 * l'intérieur d'une page. C'est donc le stockage qui doit arbitrer.
 */

async function clearDatabase() {
  const db = await getDb()
  const tx = db.transaction(['tasks', 'meta'], 'readwrite')
  await Promise.all([tx.objectStore('tasks').clear(), tx.objectStore('meta').clear(), tx.done])
}

/** Simule un autre onglet : écrit directement sur le disque, hors du magasin. */
async function autreOnglet(id: string, muter: (s: Parameters<typeof logStep>[0]) => typeof s) {
  const disque = await loadTask(id)
  if (!disque) throw new Error('cahier introuvable')
  await saveTask(muter(disque))
}

beforeEach(async () => {
  store.__resetStore()
  await clearDatabase()
})

describe('conflit entre pages', () => {
  it('refuse d’écraser une version écrite par une autre page', async () => {
    const task = await store.createAndOpenTask('Tâche', 'Continuer')

    await autreOnglet(task.id, (s) =>
      addConstraint(s, { rule: 'posée ailleurs', basedOnVersion: null }, 'human'),
    )

    // Cet onglet croit encore être à jour : sa version est pourtant dépassée.
    await expect(
      store.mutate((s) => addConstraint(s, { rule: 'posée ici', basedOnVersion: null }, 'human')),
    ).rejects.toBeInstanceOf(ConcurrentWriteError)

    const disque = await loadTask(task.id)
    // L'écriture de l'autre page a survécu, la nôtre n'est pas passée.
    expect(disque?.constraints.map((c) => c.rule)).toEqual(['posée ailleurs'])
  })

  it('se resynchronise pour que l’écran cesse de mentir', async () => {
    const task = await store.createAndOpenTask('Tâche', undefined)
    expect(store.currentTask()?.version).toBe(1)

    await autreOnglet(task.id, (s) =>
      addConstraint(s, { rule: 'posée ailleurs', basedOnVersion: null }, 'human'),
    )

    await expect(
      store.mutate((s) => addConstraint(s, { rule: 'posée ici', basedOnVersion: null }, 'human')),
    ).rejects.toBeInstanceOf(ConcurrentWriteError)

    // Après le conflit, le magasin porte l'état réel, pas celui qu'il croyait.
    expect(store.currentTask()?.version).toBe(2)
    expect(store.currentTask()?.constraints.map((c) => c.rule)).toEqual(['posée ailleurs'])
  })

  it('dit à l’agent de rappeler resume_task', async () => {
    const task = await store.createAndOpenTask('Tâche', undefined)
    await autreOnglet(task.id, (s) =>
      addConstraint(s, { rule: 'posée ailleurs', basedOnVersion: null }, 'human'),
    )

    const logStepTool = ALL_TOOLS.find((t) => t.name === 'log_step')!
    const result = await logStepTool.execute({ action: 'a', result: 'b', based_on_version: 1 }, {})

    expect(result.isError).toBe(true)
    const texte = result.content[0].text
    expect(texte).toContain('STALE STATE')
    expect(texte).toContain('Call resume_task before continuing.')
    // Pas de préfixe technique : le message doit se lire comme une consigne.
    expect(texte.startsWith('STALE STATE')).toBe(true)
  })

  it('réussit une fois la version rafraîchie', async () => {
    const task = await store.createAndOpenTask('Tâche', undefined)
    await autreOnglet(task.id, (s) =>
      addConstraint(s, { rule: 'posée ailleurs', basedOnVersion: null }, 'human'),
    )

    await store.mutate((s) => s).catch(() => undefined) // provoque la resynchro
    const v = store.currentTask()!.version

    const après = await store.mutateAsAgent('log_step', v, (s) =>
      logStep(s, { action: 'a', result: 'b', basedOnVersion: v }, 'agent'),
    )
    expect(après.version).toBe(v + 1)
    expect(après.steps).toHaveLength(1)
  })
})
