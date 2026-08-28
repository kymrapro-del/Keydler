import { beforeEach, describe, expect, it } from 'vitest'
import { addConstraint, logStep } from '../src/domain/task'
import * as store from '../src/store/taskStore'
import { storeWrite } from './helpers'
import { loadLastTask, loadTask } from '../src/persistence/taskRepository'
import { getDb } from '../src/persistence/db'
import type { StoredTask } from '../src/persistence/normalize'

beforeEach(() => {
  store.__resetStore()
})

describe('persistance', () => {
  it('restitue le même état et la même version après rechargement', async () => {
    const created = await store.createAndOpenTask('Tâche persistée', 'Continuer')
    await store.mutate((state) =>
      logStep(state, { action: 'a', result: 'b', basedOnVersion: state.version }, 'agent'),
    )
    const before = store.currentTask()!

    store.__resetStore()
    await store.init(created.id)

    const after = store.currentTask()!
    expect(after.id).toBe(before.id)
    expect(after.version).toBe(before.version)
    expect(after.steps).toHaveLength(1)
  })

  it('retrouve le dernier cahier ouvert sans identifiant', async () => {
    await store.createAndOpenTask('Premier', undefined)
    const second = await store.createAndOpenTask('Second', undefined)

    store.__resetStore()
    await store.init()

    expect(store.currentTask()?.id).toBe(second.id)
    expect((await loadLastTask())?.id).toBe(second.id)
  })

  /**
   * Le repli — plus de dernier cahier connu — rapatriait TOUS les cahiers du
   * poste pour n'en garder qu'un. Il descend maintenant l'index par date, et
   * ne lit que ce qu'il rend. Ce qu'il faut vérifier, c'est qu'il rend
   * toujours la même chose : le plus récent, et le suivant si celui-là est
   * illisible.
   */
  it('sans dernier cahier connu, prend le plus récent', async () => {
    await store.createAndOpenTask('Premier', undefined)
    const second = await store.createAndOpenTask('Second', undefined)

    const db = await getDb()
    await db.delete('meta', 'lastTaskId')

    expect((await loadLastTask())?.id).toBe(second.id)
  })

  it('descend au suivant quand le plus récent est illisible', async () => {
    const premier = await store.createAndOpenTask('Premier', undefined)
    const second = await store.createAndOpenTask('Second', undefined)

    const db = await getDb()
    await db.delete('meta', 'lastTaskId')
    // Un cahier écrit par une version future : refusé à la lecture, comme il
    // se doit, mais il ne doit pas emporter tout le poste avec lui.
    const abîmé = await db.get('tasks', second.id)
    await db.put('tasks', { ...abîmé!, schemaVersion: 999 } as StoredTask)

    expect((await loadLastTask())?.id).toBe(premier.id)
  })

  it('persiste aussi les écritures refusées', async () => {
    const task = await store.createAndOpenTask('Tâche', undefined)
    await store.mutate((state) =>
      addConstraint(state, { rule: 'R', basedOnVersion: null }, 'human'),
    )

    await expect(
      store.mutateAsAgent(
        storeWrite('log_step', task.version, { n: task.version }, (state) =>
          logStep(state, { action: 'a', result: 'b', basedOnVersion: task.version }, 'agent'),
        ),
      ),
    ).rejects.toThrow(/STALE STATE/)

    const stored = await loadTask(task.id)
    expect(stored?.audit.at(-1)).toMatchObject({ outcome: 'refused' })
  })
})
