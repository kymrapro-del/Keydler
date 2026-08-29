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

describe('a burst of announcements costs only one re-read', () => {
  it('batches fifty announcements into a single read', async () => {
    const task = await store.createAndOpenTask('Sous la rafale', undefined)

    // The other tab writes once, then announces fifty times, which is exactly
    // what an agent writing in a burst produces.
    const surLeDisque = await loadTask(task.id)
    await saveTask(
      addConstraint(surLeDisque!, { rule: 'Posée ailleurs', basedOnVersion: null }, 'human'),
    )

    lectures.loadTask = 0
    for (let i = 0; i < 50; i++) autreOnglet.postMessage({ id: task.id, version: 2 + i })

    await waitUntil(() => (store.currentTask()?.version ?? 0) >= 2, 'the re-read')
    await new Promise((r) => setTimeout(r, 80))

    expect(store.currentTask()!.constraints.map((c) => c.rule)).toContain('Posée ailleurs')
    // One, not fifty. The bound is loose on purpose: what we refuse is the
    // number of reads following the number of announcements.
    expect(lectures.loadTask).toBeLessThanOrEqual(2)
  })

  it('reads again if an announcement arrives AFTER the first was served', async () => {
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
    await waitUntil(() => (store.currentTask()?.version ?? 0) >= 2, 'the first re-read')

    await avancer('Seconde vague')
    autreOnglet.postMessage({ id: task.id, version: 3 })
    await waitUntil(() => (store.currentTask()?.version ?? 0) >= 3, 'the second re-read')

    expect(store.currentTask()!.constraints.map((c) => c.rule)).toContain('Seconde vague')
    expect(lectures.loadTask).toBeGreaterThanOrEqual(2)
  })
})
