import { beforeEach, describe, expect, it } from 'vitest'
import { StaleStateError } from '../src/domain/errors'
import { addConstraint, logStep } from '../src/domain/task'
import { getDb } from '../src/persistence/db'
import { loadTask } from '../src/persistence/taskRepository'
import * as store from '../src/store/taskStore'
import { storeWrite } from './helpers'

async function clearDatabase() {
  const db = await getDb()
  const tx = db.transaction(['tasks', 'meta'], 'readwrite')
  await Promise.all([tx.objectStore('tasks').clear(), tx.objectStore('meta').clear(), tx.done])
}

beforeEach(async () => {
  store.__resetStore()
  await clearDatabase()
})

describe('écritures concurrentes', () => {
  it('n’en applique qu’une et refuse l’autre, au lieu de la perdre', async () => {
    const task = await store.createAndOpenTask('Tâche', 'Continuer')
    const v = task.version

    const résultats = await Promise.allSettled([
      store.mutateAsAgent(
        storeWrite('log_step', v, { n: v }, (s) =>
          logStep(s, { action: 'A', result: 'a', basedOnVersion: v }, 'agent'),
        ),
      ),
      store.mutateAsAgent(
        storeWrite('log_step', v, { n: v }, (s) =>
          logStep(s, { action: 'B', result: 'b', basedOnVersion: v }, 'agent'),
        ),
      ),
    ])

    const appliquées = résultats.filter((r) => r.status === 'fulfilled')
    const refusées = résultats.filter((r) => r.status === 'rejected')

    expect(appliquées).toHaveLength(1)
    expect(refusées).toHaveLength(1)
    expect((refusées[0] as PromiseRejectedResult).reason).toBeInstanceOf(StaleStateError)

    const final = store.currentTask()!
    expect(final.version).toBe(v + 1)
    expect(final.steps).toHaveLength(1)
  })

  it('ne perd aucune écriture sous forte concurrence', async () => {
    const task = await store.createAndOpenTask('Tâche', undefined)
    const v = task.version

    const résultats = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) =>
        store.mutateAsAgent(
          storeWrite('log_step', v, { n: v }, (s) =>
            logStep(s, { action: `étape ${i}`, result: 'r', basedOnVersion: v }, 'agent'),
          ),
        ),
      ),
    )

    const appliquées = résultats.filter((r) => r.status === 'fulfilled')
    expect(appliquées).toHaveLength(1)

    const final = store.currentTask()!
    expect(final.version).toBe(v + 1)
    expect(final.steps).toHaveLength(1)

    const refus = final.audit.filter((e) => e.outcome === 'refused')
    expect(refus).toHaveLength(1)
    expect(refus[0].repeated).toBe(7)
  })

  it('applique une chaîne d’écritures qui respectent la version rendue', async () => {
    const task = await store.createAndOpenTask('Tâche', undefined)
    let v = task.version

    for (let i = 0; i < 5; i++) {
      const next = await store.mutateAsAgent(
        storeWrite('log_step', v, { n: v }, (s) =>
          logStep(s, { action: `étape ${i}`, result: 'r', basedOnVersion: v }, 'agent'),
        ),
      )
      v = next.version
    }

    const final = store.currentTask()!
    expect(final.version).toBe(task.version + 5)
    expect(final.steps).toHaveLength(5)
    expect(final.steps.map((s) => s.action)).toEqual([
      'étape 0',
      'étape 1',
      'étape 2',
      'étape 3',
      'étape 4',
    ])
  })

  it('sérialise aussi les écritures humaines, qui ne sont jamais refusées', async () => {
    const task = await store.createAndOpenTask('Tâche', undefined)

    await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        store.mutate((s) =>
          addConstraint(s, { rule: `règle ${i}`, basedOnVersion: null }, 'human'),
        ),
      ),
    )

    const final = store.currentTask()!
    expect(final.constraints).toHaveLength(6)
    expect(final.version).toBe(task.version + 6)
  })

  it('persiste l’état exact qui est affiché, sans écriture en retard', async () => {
    const task = await store.createAndOpenTask('Tâche', undefined)
    const v = task.version

    await Promise.allSettled([
      store.mutateAsAgent(
        storeWrite('log_step', v, { n: v }, (s) =>
          logStep(s, { action: 'A', result: 'a', basedOnVersion: v }, 'agent'),
        ),
      ),
      store.mutate((s) => addConstraint(s, { rule: 'humaine', basedOnVersion: null }, 'human')),
    ])

    const enMémoire = store.currentTask()!
    const surDisque = await loadTask(task.id)
    expect(surDisque?.version).toBe(enMémoire.version)
    expect(surDisque?.steps.length).toBe(enMémoire.steps.length)
    expect(surDisque?.constraints.length).toBe(enMémoire.constraints.length)
    expect(surDisque?.audit.length).toBe(enMémoire.audit.length)
  })
})
