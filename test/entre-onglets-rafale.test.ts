import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addConstraint } from '../src/domain/task'

// Une rafale d'annonces ne doit pas produire une rafale de relectures : mesuré sur un
// cahier de 20 000 étapes, cinquante annonces coûtaient cinquante lectures et 1702 ms,
// dont 1668 ms jetés, et retardaient les écritures de cet onglet d'un facteur 51 : la
// file d'écriture est partagée. Le compteur passe par `vi.mock` plutôt que par un
// chronomètre : ce qui compte est un NOMBRE de lectures, et un nombre ne clignote pas.
const lectures = { loadTask: 0 }

vi.mock('../src/persistence/taskRepository', async (original) => {
  const vrai = await original<typeof import('../src/persistence/taskRepository')>()
  return {
    ...vrai,
    loadTask: async (id: string) => {
      lectures.loadTask += 1
      return vrai.loadTask(id)
    },
  }
})

const { loadTask, saveTask } = await import('../src/persistence/taskRepository')
const store = await import('../src/store/taskStore')
const { clearDatabase, waitUntil } = await import('./helpers')

let autreOnglet: BroadcastChannel

beforeEach(async () => {
  store.__resetStore()
  await clearDatabase()
  lectures.loadTask = 0
  autreOnglet = new BroadcastChannel('cahier-de-quart')
})

afterEach(() => {
  autreOnglet.close()
})

describe('une rafale d’annonces ne coûte qu’une relecture', () => {
  it('regroupe cinquante annonces en une seule lecture', async () => {
    const task = await store.createAndOpenTask('Sous la rafale', undefined)

    // L'autre onglet écrit une fois, puis annonce cinquante fois, ce qui est
    // exactement ce que produit un agent qui écrit en rafale.
    const surLeDisque = await loadTask(task.id)
    await saveTask(
      addConstraint(surLeDisque!, { rule: 'Posée ailleurs', basedOnVersion: null }, 'human'),
    )

    lectures.loadTask = 0
    for (let i = 0; i < 50; i++) autreOnglet.postMessage({ id: task.id, version: 2 + i })

    await waitUntil(() => (store.currentTask()?.version ?? 0) >= 2, 'la relecture')
    await new Promise((r) => setTimeout(r, 80))

    expect(store.currentTask()!.constraints.map((c) => c.rule)).toContain('Posée ailleurs')
    // Une, pas cinquante. La borne est lâche exprès : ce qu'on refuse, c'est
    // que le nombre de lectures suive le nombre d'annonces.
    expect(lectures.loadTask).toBeLessThanOrEqual(2)
  })

  it('relit à nouveau si une annonce arrive APRÈS que la première a été servie', async () => {
    // Regrouper ne doit pas vouloir dire ignorer : deux vagues séparées sont
    // deux relectures, sans quoi l'écran resterait en retard.
    const task = await store.createAndOpenTask('Deux vagues', undefined)

    const avancer = async (règle: string) => {
      const disque = await loadTask(task.id)
      await saveTask(addConstraint(disque!, { rule: règle, basedOnVersion: null }, 'human'))
    }

    await avancer('Première vague')
    lectures.loadTask = 0
    autreOnglet.postMessage({ id: task.id, version: 2 })
    await waitUntil(() => (store.currentTask()?.version ?? 0) >= 2, 'la première relecture')

    await avancer('Seconde vague')
    autreOnglet.postMessage({ id: task.id, version: 3 })
    await waitUntil(() => (store.currentTask()?.version ?? 0) >= 3, 'la seconde relecture')

    expect(store.currentTask()!.constraints.map((c) => c.rule)).toContain('Seconde vague')
    expect(lectures.loadTask).toBeGreaterThanOrEqual(2)
  })
})
