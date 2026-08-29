import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addConstraint } from '../src/domain/task'

// A burst of announcements must not produce a burst of re-reads: measured on a
// 20,000 step task, fifty announcements cost fifty reads and 1702 ms, of which
// 1668 ms thrown away, and delayed this tab's writes by a factor of 51: the
// write queue is shared. The counter goes through `vi.mock` rather than a
// stopwatch: what counts is a number of reads, and a number does not flicker.
const lectures = { loadTask: 0 }

vi.mock('../src/persistence/taskRepository', async (original) => {
  const actual = await original<typeof import('../src/persistence/taskRepository')>()
  return {
    ...actual,
    loadTask: async (id: string) => {
      lectures.loadTask += 1
      return actual.loadTask(id)
    },
  }
})

const { loadTask, saveTask } = await import('../src/persistence/taskRepository')
const store = await import('../src/store/taskStore')
const { clearDatabase, waitUntil } = await import('./helpers')

let otherTab: BroadcastChannel

beforeEach(async () => {
  store.__resetStore()
  await clearDatabase()
  lectures.loadTask = 0
  otherTab = new BroadcastChannel('cahier-de-quart')
})

afterEach(() => {
  otherTab.close()
})

describe('a burst of announcements costs only one re-read', () => {
  it('batches fifty announcements into a single read', async () => {
    const task = await store.createAndOpenTask('Under load', undefined)

    // The other tab writes once, then announces fifty times, which is exactly
    // what an agent writing in a burst produces.
    const onDisk = await loadTask(task.id)
    await saveTask(
      addConstraint(onDisk!, { rule: 'Added elsewhere', basedOnVersion: null }, 'human'),
    )

    lectures.loadTask = 0
    for (let i = 0; i < 50; i++) otherTab.postMessage({ id: task.id, version: 2 + i })

    await waitUntil(() => (store.currentTask()?.version ?? 0) >= 2, 'the re-read')
    await new Promise((r) => setTimeout(r, 80))

    expect(store.currentTask()!.constraints.map((c) => c.rule)).toContain('Added elsewhere')
    // One, not fifty. The bound is loose on purpose: what it refuses is the
    // number of reads following the number of announcements.
    expect(lectures.loadTask).toBeLessThanOrEqual(2)
  })

  it('reads again if an announcement arrives AFTER the first was served', async () => {
    // Batching must not mean ignoring: two separate waves are two re-reads,
    // without which the screen would stay behind.
    const task = await store.createAndOpenTask('Deux vagues', undefined)

    const avancer = async (rule: string) => {
      const disk = await loadTask(task.id)
      await saveTask(addConstraint(disk!, { rule: rule, basedOnVersion: null }, 'human'))
    }

    await avancer('First vague')
    lectures.loadTask = 0
    otherTab.postMessage({ id: task.id, version: 2 })
    await waitUntil(() => (store.currentTask()?.version ?? 0) >= 2, 'the first re-read')

    await avancer('Seconde vague')
    otherTab.postMessage({ id: task.id, version: 3 })
    await waitUntil(() => (store.currentTask()?.version ?? 0) >= 3, 'the second re-read')

    expect(store.currentTask()!.constraints.map((c) => c.rule)).toContain('Seconde vague')
    expect(lectures.loadTask).toBeGreaterThanOrEqual(2)
  })
})
