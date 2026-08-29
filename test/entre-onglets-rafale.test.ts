import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addConstraint } from '../src/domain/task'

// A burst of announcements must not produce a burst of re-reads: measured on a
// 20,000 step task, fifty announcements cost fifty reads and 1702 ms, of which
// 1668 ms thrown away, and delayed this tab's writes by a factor of 51: the write
// queue is shared. The counter goes through `vi.mock` rather than a stopwatch:
// what counts is a NUMBER of reads, and a number does not flicker.
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

    // The other tab writes once, then announces fifty times, which is exactly
    // what an agent writing in a burst produces.
    const surLeDisque = await loadTask(task.id)
    await saveTask(
      addConstraint(surLeDisque!, { rule: 'Posée ailleurs', basedOnVersion: null }, 'human'),
    )

    lectures.loadTask = 0
    for (let i = 0; i < 50; i++) autreOnglet.postMessage({ id: task.id, version: 2 + i })

    await waitUntil(() => (store.currentTask()?.version ?? 0) >= 2, 'la relecture')
    await new Promise((r) => setTimeout(r, 80))

    expect(store.currentTask()!.constraints.map((c) => c.rule)).toContain('Posée ailleurs')
    // One, not fifty. The bound is loose on purpose: what we refuse is the
    // number of reads following the number of announcements.
    expect(lectures.loadTask).toBeLessThanOrEqual(2)
  })

  it('relit à nouveau si une annonce arrive APRÈS que la première a été servie', async () => {
    // Batching must not mean ignoring: two separate waves are two re-reads,
    // without which the screen would stay behind.
    const task = await store.createAndOpenTask('Deux vagues', undefined)

    const avancer = async (rule: string) => {
      const disque = await loadTask(task.id)
      await saveTask(addConstraint(disque!, { rule: rule, basedOnVersion: null }, 'human'))
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
