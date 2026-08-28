import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addConstraint, logStep } from '../src/domain/task'
import { loadTask, saveTask } from '../src/persistence/taskRepository'
import * as store from '../src/store/taskStore'
import { clearDatabase, waitUntil } from './helpers'

/**
 * Trouvé en navigateur, deux onglets ouverts sur la même tâche : le second
 * avait rouvert la tâche et écrit jusqu'à v31 pendant que le premier affichait
 * encore v29 et « Task closed ». La sûreté tenait — l'écriture du premier
 * aurait été refusée — mais son écran mentait jusque-là, ce qui est exactement
 * ce que ce produit reproche aux résumés de conversation.
 *
 * Ici, « l'autre onglet » est un second `BroadcastChannel` : dans un même
 * processus comme entre deux onglets, il ne livre jamais au contexte qui poste,
 * ce qui est précisément la propriété dont dépend le correctif.
 */
let autreOnglet: BroadcastChannel

function annonce(id: string, version: number): void {
  autreOnglet.postMessage({ id, version })
}

beforeEach(async () => {
  store.__resetStore()
  await clearDatabase()
  autreOnglet = new BroadcastChannel('cahier-de-quart')
})

afterEach(() => {
  autreOnglet.close()
})

describe('ce qu’un onglet apprend de l’autre', () => {
  it('relit le cahier quand une autre page l’a fait avancer', async () => {
    const task = await store.createAndOpenTask('Partagée', 'Continuer')
    expect(store.currentTask()!.version).toBe(1)

    // L'autre page écrit sur le disque, sans passer par ce magasin.
    const surLeDisque = await loadTask(task.id)
    await saveTask(
      addConstraint(surLeDisque!, { rule: 'Posée ailleurs', basedOnVersion: null }, 'human'),
    )
    annonce(task.id, 2)

    await waitUntil(() => (store.currentTask()?.version ?? 0) >= 2, 'la relecture')
    expect(store.currentTask()!.constraints.map((c) => c.rule)).toContain('Posée ailleurs')
  })

  it('écoute même sans avoir jamais écrit', async () => {
    // Le piège : le canal était ouvert à la première ANNONCE. Un onglet qui ne
    // fait que lire n'annonce rien, restait donc sourd — et c'est justement
    // celui qu'il fallait réveiller. Ici, le magasin n'écrit pas une fois.
    const posé = await store.createAndOpenTask('Écrite ailleurs', undefined)
    const id = posé.id
    store.__resetStore()
    await store.init(id)
    expect(store.currentTask()!.version).toBe(1)

    const surLeDisque = await loadTask(id)
    await saveTask(
      addConstraint(surLeDisque!, { rule: 'Posée ailleurs', basedOnVersion: null }, 'human'),
    )
    annonce(id, 2)

    await waitUntil(() => (store.currentTask()?.version ?? 0) >= 2, 'la relecture')
    expect(store.currentTask()!.constraints.map((c) => c.rule)).toContain('Posée ailleurs')
  })

  it('ignore une annonce qui concerne une autre tâche', async () => {
    const task = await store.createAndOpenTask('La mienne', undefined)
    const avant = store.currentTask()!.version

    annonce('une-autre-tache', 99)
    await new Promise((r) => setTimeout(r, 30))

    expect(store.currentTask()!.version).toBe(avant)
    expect(store.currentTask()!.id).toBe(task.id)
  })

  it('ignore une annonce plus ancienne que ce qu’il tient déjà', async () => {
    // Sinon une annonce en retard ferait reculer l'écran vers un état dépassé.
    const task = await store.createAndOpenTask('La mienne', undefined)
    await store.mutate((s) =>
      addConstraint(s, { rule: 'Posée ici', basedOnVersion: null }, 'human'),
    )
    const version = store.currentTask()!.version

    annonce(task.id, 1)
    await new Promise((r) => setTimeout(r, 30))

    expect(store.currentTask()!.version).toBe(version)
    expect(store.currentTask()!.constraints.map((c) => c.rule)).toContain('Posée ici')
  })

  it('prévient les autres pages de ses propres écritures', async () => {
    const task = await store.createAndOpenTask('Partagée', undefined)
    const reçues: { id: string | null; version: number }[] = []
    autreOnglet.onmessage = (e) => reçues.push(e.data)

    await store.mutate((s) =>
      logStep(s, { action: 'a', result: 'b', basedOnVersion: s.version }, 'agent'),
    )

    // On attend l'annonce de CETTE tâche : la création en a déjà émis une pour
    // la liste, qui arrive de façon asynchrone et gagnerait la course.
    await waitUntil(() => reçues.some((m) => m.id === task.id), 'l’annonce de la tâche')
    expect(reçues).toContainEqual({ id: task.id, version: store.currentTask()!.version })
  })

  it('réveille la liste des cahiers quand une autre page en crée un', async () => {
    await store.createAndOpenTask('La mienne', undefined)
    const avant = store.tasksRevision()

    // Une création ailleurs : l'identifiant ne nous concerne pas, mais la
    // liste, si.
    autreOnglet.postMessage({ id: null, version: 0 })
    await waitUntil(() => store.tasksRevision() > avant, 'la révision de la liste')
  })
})
