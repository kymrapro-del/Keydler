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

describe('persistence', () => {
  it('gives back the same state and the same version after a reload', async () => {
    const created = await store.createAndOpenTask('Persistent task', 'Continue')
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

  it('finds the last task opened, with no id given', async () => {
    await store.createAndOpenTask('First', undefined)
    const second = await store.createAndOpenTask('Second', undefined)

    store.__resetStore()
    await store.init()

    expect(store.currentTask()?.id).toBe(second.id)
    expect((await loadLastTask())?.id).toBe(second.id)
  })

  // The fallback (no last log known any more) used to pull back every log on
  // the machine only to keep one; it now walks down the index by date. The
  // dates are set by hand: two logs created within the same millisecond have no
  // "most recent", and the product does not promise one.
  async function putStoredTask(id: string, updatedAt: number, schemaVersion = SCHEMA_VERSION) {
    await putTask({ ...buildCoreTask(), id, title: id, updatedAt } as never)
    const db = await getDb()
    const stored = await db.get('tasks', id)
    await db.put('tasks', { ...stored!, schemaVersion } as StoredTask)
  }

  it('with no last task known, takes the most recent', async () => {
    await clearDatabase()
    await putStoredTask('old', 1_000)
    await putStoredTask('recent', 2_000)

    expect((await loadLastTask())?.id).toBe('recent')
  })

  it('goes down to the next one when the most recent is unreadable', async () => {
    await clearDatabase()
    await putStoredTask('old', 1_000)
    // A log written by a future version: refused on read, as it should be, but
    // it must not take the whole machine down with it.
    await putStoredTask('recent', 2_000, 999)

    expect((await loadLastTask())?.id).toBe('old')
  })

  it('drops an unreadable task from the list, without taking the others with it', async () => {
    // Found by mutation: nothing held this net. A log from a future version
    // must not empty the machine's picker.
    await clearDatabase()
    await putStoredTask('readable', 1_000)
    await putStoredTask('future', 2_000, 999)

    const cards = await store.allTaskCards()
    expect(cards.map((c) => c.id)).toEqual(['readable'])
  })

  it('persists refused writes too', async () => {
    const task = await store.createAndOpenTask('Task', undefined)
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
