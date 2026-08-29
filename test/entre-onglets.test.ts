import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addConstraint, logStep } from '../src/domain/task'
import { loadTask, saveTask } from '../src/persistence/taskRepository'
import { getDb } from '../src/persistence/db'
import * as store from '../src/store/taskStore'
import { clearDatabase, waitUntil } from './helpers'

// Two tabs on the same task: the second had written up to v31 while the first
// still showed v29 and "Task closed". The write from the first would indeed
// have been refused, but its screen lied until then. "The other tab" is a
// second `BroadcastChannel`: within one process as between two tabs, it never
// delivers to the context that posts.
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

describe('what one tab learns from the other', () => {
  it('rereads the log when another page has moved it forward', async () => {
    const task = await store.createAndOpenTask('Partagée', 'Continuer')
    expect(store.currentTask()!.version).toBe(1)

    // The other page writes to disk, without going through this store.
    const surLeDisque = await loadTask(task.id)
    await saveTask(
      addConstraint(surLeDisque!, { rule: 'Posée ailleurs', basedOnVersion: null }, 'human'),
    )
    annonce(task.id, 2)

    await waitUntil(() => (store.currentTask()?.version ?? 0) >= 2, 'the re-read')
    expect(store.currentTask()!.constraints.map((c) => c.rule)).toContain('Posée ailleurs')
  })

  it('listens even when it has never written', async () => {
    // The trap: the channel was opened on the first ANNOUNCEMENT. A tab that
    // only reads announces nothing, so it stayed deaf, and it is exactly the
    // one that had to be woken. Here the store does not write once.
    const installed = await store.createAndOpenTask('Écrite ailleurs', undefined)
    const id = installed.id
    store.__resetStore()
    await store.init(id)
    expect(store.currentTask()!.version).toBe(1)

    const surLeDisque = await loadTask(id)
    await saveTask(
      addConstraint(surLeDisque!, { rule: 'Posée ailleurs', basedOnVersion: null }, 'human'),
    )
    annonce(id, 2)

    await waitUntil(() => (store.currentTask()?.version ?? 0) >= 2, 'the re-read')
    expect(store.currentTask()!.constraints.map((c) => c.rule)).toContain('Posée ailleurs')
  })

  it('ignores an announcement about another task', async () => {
    const task = await store.createAndOpenTask('La mienne', undefined)
    const before = store.currentTask()!.version

    annonce('une-autre-tache', 99)
    await new Promise((r) => setTimeout(r, 30))

    expect(store.currentTask()!.version).toBe(before)
    expect(store.currentTask()!.id).toBe(task.id)
  })

  it('ignores an announcement older than what it already holds', async () => {
    // Otherwise a late announcement would walk the screen back to a stale
    // state.
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

  it('tells the other pages about its own writes', async () => {
    const task = await store.createAndOpenTask('Partagée', undefined)
    const received: { id: string | null; version: number; gone?: boolean }[] = []
    autreOnglet.onmessage = (e) => received.push(e.data)

    await store.mutate((s) =>
      logStep(s, { action: 'a', result: 'b', basedOnVersion: s.version }, 'agent'),
    )

    // We wait for the announcement of THIS task: creation already emitted one
    // for the list, which arrives asynchronously and would win the race.
    await waitUntil(() => received.some((m) => m.id === task.id), 'the task announcement')
    expect(received).toContainEqual({
      id: task.id,
      version: store.currentTask()!.version,
      gone: false,
    })
  })

  it('wakes the list of logs when another page creates one', async () => {
    await store.createAndOpenTask('La mienne', undefined)
    const before = store.tasksRevision()

    // A creation elsewhere: the id does not concern us, but the list does.
    autreOnglet.postMessage({ id: null, version: 0 })
    await waitUntil(() => store.tasksRevision() > before, 'the list revision')
  })
})

describe('what a tab does with a deletion from elsewhere', () => {
  // Deletion only announced "the list has changed", without naming the task:
  // the tab next door kept it on screen and its next write RESURRECTED it, with
  // all its steps and all its evidence, but without its sealed credentials,
  // those really erased. The human believed the data gone; it came back maimed.
  it('learns the open log was deleted, and stops showing it', async () => {
    const task = await store.createAndOpenTask('Supprimée ailleurs', undefined)
    expect(store.getSnapshot().status).toBe('ready')

    autreOnglet.postMessage({ id: task.id, version: 0, gone: true })

    await waitUntil(() => store.getSnapshot().status === 'missing', 'the “gone” state')
    expect(store.currentTask()).toBeNull()
    expect(store.missingTaskId()).toBe(task.id)
  })

  it('does not resurrect a deleted log when it tries to write', async () => {
    const task = await store.createAndOpenTask('Supprimée ailleurs', undefined)
    // The other tab deletes for good, then the announcement arrives.
    const db = await getDb()
    await db.delete('tasks', task.id)
    autreOnglet.postMessage({ id: task.id, version: 0, gone: true })
    await waitUntil(() => store.getSnapshot().status === 'missing', 'the “gone” state')

    await expect(
      store.mutate((s) => addConstraint(s, { rule: 'Trop tard', basedOnVersion: null }, 'human')),
    ).rejects.toThrow()
    expect(await loadTask(task.id)).toBeUndefined()
  })

  it('ignores a disappearance about another task', async () => {
    await store.createAndOpenTask('La mienne', undefined)
    autreOnglet.postMessage({ id: 'une-autre', version: 0, gone: true })
    await new Promise((r) => setTimeout(r, 30))
    expect(store.getSnapshot().status).toBe('ready')
  })
})

describe('the reread will not overwrite the wrong log', () => {
  // The "is this really the open task?" guard was evaluated when the message
  // was RECEIVED, the re-read being deferred in the write queue: opening
  // another task in between switched the screen, and `boundId`, back to the
  // previous one.
  it('gives up if the open log changed between the announcement and its turn', async () => {
    const a = await store.createAndOpenTask('Cahier A', undefined)
    const b = await store.createAndOpenTask('Cahier B', undefined)

    // Move A forward on disk, without going through this store.
    const surLeDisque = await loadTask(a.id)
    await saveTask(
      addConstraint(surLeDisque!, { rule: 'Posée ailleurs', basedOnVersion: null }, 'human'),
    )

    // B is open; the announcement is about A.
    expect(store.currentTask()!.id).toBe(b.id)
    autreOnglet.postMessage({ id: a.id, version: 99 })
    await new Promise((r) => setTimeout(r, 60))

    expect(store.currentTask()!.id).toBe(b.id)
    expect(store.getSnapshot().boundId).toBe(b.id)
  })
})
