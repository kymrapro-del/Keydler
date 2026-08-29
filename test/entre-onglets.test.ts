import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addConstraint, logStep } from '../src/domain/task'
import { loadTask, saveTask } from '../src/persistence/taskRepository'
import { getDb } from '../src/persistence/db'
import * as store from '../src/store/taskStore'
import { clearDatabase, waitUntil } from './helpers'

// Deux onglets sur la même tâche : le second avait écrit jusqu'à v31 pendant que le
// premier affichait encore v29 et « Task closed ». L'écriture du premier aurait bien
// été refusée, mais son écran mentait jusque-là.
// « L'autre onglet » est un second `BroadcastChannel` : dans un même processus comme
// entre deux onglets, il ne livre jamais au contexte qui poste.
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
    // fait que lire n'annonce rien, restait donc sourd, et c'est justement
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
    const reçues: { id: string | null; version: number; gone?: boolean }[] = []
    autreOnglet.onmessage = (e) => reçues.push(e.data)

    await store.mutate((s) =>
      logStep(s, { action: 'a', result: 'b', basedOnVersion: s.version }, 'agent'),
    )

    // On attend l'annonce de CETTE tâche : la création en a déjà émis une pour
    // la liste, qui arrive de façon asynchrone et gagnerait la course.
    await waitUntil(() => reçues.some((m) => m.id === task.id), 'l’annonce de la tâche')
    expect(reçues).toContainEqual({
      id: task.id,
      version: store.currentTask()!.version,
      gone: false,
    })
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

describe('ce qu’un onglet fait d’une suppression venue d’ailleurs', () => {
  // La suppression n'annonçait que « la liste a changé », sans nommer le cahier :
  // l'onglet d'à côté le gardait à l'écran et sa prochaine écriture le RESSUSCITAIT,
  // avec toutes ses étapes et toutes ses preuves, mais sans ses identifiants scellés,
  // eux réellement effacés. L'humain croyait la donnée partie ; elle revenait amputée.
  it('apprend que le cahier ouvert a été supprimé, et cesse de le montrer', async () => {
    const task = await store.createAndOpenTask('Supprimée ailleurs', undefined)
    expect(store.getSnapshot().status).toBe('ready')

    autreOnglet.postMessage({ id: task.id, version: 0, gone: true })

    await waitUntil(() => store.getSnapshot().status === 'missing', 'l’état « disparu »')
    expect(store.currentTask()).toBeNull()
    expect(store.missingTaskId()).toBe(task.id)
  })

  it('ne ressuscite pas un cahier supprimé quand il tente d’écrire', async () => {
    const task = await store.createAndOpenTask('Supprimée ailleurs', undefined)
    // L'autre onglet supprime pour de bon, puis l'annonce arrive.
    const db = await getDb()
    await db.delete('tasks', task.id)
    autreOnglet.postMessage({ id: task.id, version: 0, gone: true })
    await waitUntil(() => store.getSnapshot().status === 'missing', 'l’état « disparu »')

    await expect(
      store.mutate((s) => addConstraint(s, { rule: 'Trop tard', basedOnVersion: null }, 'human')),
    ).rejects.toThrow()
    expect(await loadTask(task.id)).toBeUndefined()
  })

  it('ignore une disparition qui concerne une autre tâche', async () => {
    await store.createAndOpenTask('La mienne', undefined)
    autreOnglet.postMessage({ id: 'une-autre', version: 0, gone: true })
    await new Promise((r) => setTimeout(r, 30))
    expect(store.getSnapshot().status).toBe('ready')
  })
})

describe('la relecture ne va pas écraser le mauvais cahier', () => {
  // La garde « est-ce bien le cahier ouvert ? » était évaluée à la RÉCEPTION du
  // message, la relecture étant différée dans la file d'écriture : ouvrir un autre
  // cahier entre les deux rebasculait l'écran, et `boundId`, sur le précédent.
  it('abandonne si le cahier ouvert a changé entre l’annonce et son tour', async () => {
    const a = await store.createAndOpenTask('Cahier A', undefined)
    const b = await store.createAndOpenTask('Cahier B', undefined)

    // Faire avancer A sur le disque, sans passer par ce magasin.
    const surLeDisque = await loadTask(a.id)
    await saveTask(
      addConstraint(surLeDisque!, { rule: 'Posée ailleurs', basedOnVersion: null }, 'human'),
    )

    // B est ouvert ; l'annonce parle de A.
    expect(store.currentTask()!.id).toBe(b.id)
    autreOnglet.postMessage({ id: a.id, version: 99 })
    await new Promise((r) => setTimeout(r, 60))

    expect(store.currentTask()!.id).toBe(b.id)
    expect(store.getSnapshot().boundId).toBe(b.id)
  })
})
