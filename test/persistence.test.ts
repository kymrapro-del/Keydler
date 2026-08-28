import { beforeEach, describe, expect, it } from 'vitest'
import { addConstraint, logStep } from '../src/domain/task'
import * as store from '../src/store/taskStore'
import { storeWrite } from './helpers'
import { loadLastTask, loadTask } from '../src/persistence/taskRepository'

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

  it('laisse la racine publique même si une mémoire locale existe déjà', async () => {
    const existing = await store.createAndOpenTask('Mémoire existante', 'Continuer')

    store.__resetStore()
    await store.initPublicLanding()

    expect(store.getSnapshot()).toMatchObject({
      status: 'empty',
      task: null,
      boundId: null,
    })
    expect((await loadTask(existing.id))?.title).toBe('Mémoire existante')

    await store.init(existing.id)
    expect(store.currentTask()?.id).toBe(existing.id)
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
