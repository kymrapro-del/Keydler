import { beforeEach, describe, expect, it } from 'vitest'
import { StaleStateError } from '../src/domain/errors'
import { addConstraint, logStep } from '../src/domain/task'
import { getDb } from '../src/persistence/db'
import { loadTask } from '../src/persistence/taskRepository'
import * as store from '../src/store/taskStore'
import { storeWrite } from './helpers'

async function clearDatabase() {
  const db = await getDb()
  const tx = db.transaction(['tasks', 'meta'], 'readwrite')
  await Promise.all([tx.objectStore('tasks').clear(), tx.objectStore('meta').clear(), tx.done])
}

beforeEach(async () => {
  store.__resetStore()
  await clearDatabase()
})

describe('concurrent writes', () => {
  it('applies only one and refuses the other, instead of losing it', async () => {
    const task = await store.createAndOpenTask('Task', 'Continue')
    const v = task.version

    const results = await Promise.allSettled([
      store.mutateAsAgent(
        storeWrite('log_step', v, { n: v }, (s) =>
          logStep(s, { action: 'A', result: 'a', basedOnVersion: v }, 'agent'),
        ),
      ),
      store.mutateAsAgent(
        storeWrite('log_step', v, { n: v }, (s) =>
          logStep(s, { action: 'B', result: 'b', basedOnVersion: v }, 'agent'),
        ),
      ),
    ])

    const applied = results.filter((r) => r.status === 'fulfilled')
    const refused = results.filter((r) => r.status === 'rejected')

    expect(applied).toHaveLength(1)
    expect(refused).toHaveLength(1)
    expect((refused[0] as PromiseRejectedResult).reason).toBeInstanceOf(StaleStateError)

    const final = store.currentTask()!
    expect(final.version).toBe(v + 1)
    expect(final.steps).toHaveLength(1)
  })

  it('loses no write under heavy concurrency', async () => {
    const task = await store.createAndOpenTask('Task', undefined)
    const v = task.version

    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) =>
        store.mutateAsAgent(
          storeWrite('log_step', v, { n: v }, (s) =>
            logStep(s, { action: `step ${i}`, result: 'r', basedOnVersion: v }, 'agent'),
          ),
        ),
      ),
    )

    const applied = results.filter((r) => r.status === 'fulfilled')
    expect(applied).toHaveLength(1)

    const final = store.currentTask()!
    expect(final.version).toBe(v + 1)
    expect(final.steps).toHaveLength(1)

    const refusal = final.audit.filter((e) => e.outcome === 'refused')
    expect(refusal).toHaveLength(1)
    expect(refusal[0].repeated).toBe(7)
  })

  it('applies a chain of writes that respect the version returned', async () => {
    const task = await store.createAndOpenTask('Task', undefined)
    let v = task.version

    for (let i = 0; i < 5; i++) {
      const next = await store.mutateAsAgent(
        storeWrite('log_step', v, { n: v }, (s) =>
          logStep(s, { action: `step ${i}`, result: 'r', basedOnVersion: v }, 'agent'),
        ),
      )
      v = next.version
    }

    const final = store.currentTask()!
    expect(final.version).toBe(task.version + 5)
    expect(final.steps).toHaveLength(5)
    expect(final.steps.map((s) => s.action)).toEqual([
      'step 0',
      'step 1',
      'step 2',
      'step 3',
      'step 4',
    ])
  })

  it('serializes human writes too, which are never refused', async () => {
    const task = await store.createAndOpenTask('Task', undefined)

    await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        store.mutate((s) => addConstraint(s, { rule: `rule ${i}`, basedOnVersion: null }, 'human')),
      ),
    )

    const final = store.currentTask()!
    expect(final.constraints).toHaveLength(6)
    expect(final.version).toBe(task.version + 6)
  })

  it('persists the exact state that is displayed, with no write left behind', async () => {
    const task = await store.createAndOpenTask('Task', undefined)
    const v = task.version

    await Promise.allSettled([
      store.mutateAsAgent(
        storeWrite('log_step', v, { n: v }, (s) =>
          logStep(s, { action: 'A', result: 'a', basedOnVersion: v }, 'agent'),
        ),
      ),
      store.mutate((s) => addConstraint(s, { rule: 'humaine', basedOnVersion: null }, 'human')),
    ])

    const inMemory = store.currentTask()!
    const surDisque = await loadTask(task.id)
    expect(surDisque?.version).toBe(inMemory.version)
    expect(surDisque?.steps.length).toBe(inMemory.steps.length)
    expect(surDisque?.constraints.length).toBe(inMemory.constraints.length)
    expect(surDisque?.audit.length).toBe(inMemory.audit.length)
  })
})
