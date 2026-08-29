import { beforeEach, describe, expect, it } from 'vitest'
import { addConstraint, logStep } from '../src/domain/task'
import * as store from '../src/store/taskStore'
import { clearDatabase, storeWrite } from './helpers'
import { loadLastTask, loadTask } from '../src/persistence/taskRepository'
import { getDb } from '../src/persistence/db'
import { putTask } from '../src/persistence/taskRepository'
import { buildCoreTask } from '../src/demo/seed'
import { SCHEMA_VERSION } from '../src/domain/types'
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

  // Le repli (plus de dernier cahier connu) rapatriait TOUS les cahiers du
  // poste pour n'en garder qu'un ; il descend maintenant l'index par date.
  // Les dates sont posées à la main : deux cahiers créés dans la même
  // milliseconde n'ont pas de « plus récent », et le produit n'en promet pas.
  async function poser(id: string, updatedAt: number, schemaVersion = SCHEMA_VERSION) {
    await putTask({ ...buildCoreTask(), id, title: id, updatedAt } as never)
    const db = await getDb()
    const stored = await db.get('tasks', id)
    await db.put('tasks', { ...stored!, schemaVersion } as StoredTask)
  }

  it('sans dernier cahier connu, prend le plus récent', async () => {
    await clearDatabase()
    await poser('ancien', 1_000)
    await poser('recent', 2_000)

    expect((await loadLastTask())?.id).toBe('recent')
  })

  it('descend au suivant quand le plus récent est illisible', async () => {
    await clearDatabase()
    await poser('ancien', 1_000)
    // Un cahier écrit par une version future : refusé à la lecture, comme il
    // se doit, mais il ne doit pas emporter tout le poste avec lui.
    await poser('recent', 2_000, 999)

    expect((await loadLastTask())?.id).toBe('ancien')
  })

  it('écarte un cahier illisible de la liste, sans emporter les autres', async () => {
    // Trouvé en mutant : rien ne tenait ce filet. Un cahier venu d'une version
    // future ne doit pas vider le sélecteur du poste.
    await clearDatabase()
    await poser('lisible', 1_000)
    await poser('futur', 2_000, 999)

    const cartes = await store.allTaskCards()
    expect(cartes.map((c) => c.id)).toEqual(['lisible'])
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
