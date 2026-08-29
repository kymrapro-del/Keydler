import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildCoreTask } from '../src/demo/seed'
import { addSecret, listSecretNames } from '../src/persistence/vault'
import { getDb } from '../src/persistence/db'
import { forgetSeen, markSeen, seenVersion } from '../src/persistence/seen'
import * as store from '../src/store/taskStore'
import { clearDatabase, waitUntil } from './helpers'

const PASSPHRASE = 'correct horse battery'

beforeEach(async () => {
  localStorage.clear()
  store.__resetStore()
  await clearDatabase()
  await store.init()
})

afterEach(() => {
  localStorage.clear()
  store.__resetStore()
})

describe('deleting a task leaves nothing behind', () => {
  it('takes the sealed credentials with it', async () => {
    const task = await store.openPreparedTask(buildCoreTask())
    await addSecret({
      taskId: task.id,
      name: 'gemini-api-key',
      purpose: 'Gemini calls',
      kind: 'api_key',
      value: 'AIzaSy-should-not-survive',
      passphrase: PASSPHRASE,
    })
    expect(await listSecretNames(task.id)).toHaveLength(1)

    await store.deleteCurrentTask()

    // The sealed secret stayed in IndexedDB, out of reach of the screen but
    // very much present on disk, while the human believes it was all deleted.
    expect(await listSecretNames(task.id)).toHaveLength(0)

    const db = await getDb()
    const restants = await db.getAll('secrets')
    expect(restants.filter((s) => s.taskId === task.id)).toHaveLength(0)
  })

  it('leaves the credentials of other logs alone', async () => {
    const kept = await store.openPreparedTask(buildCoreTask())
    await addSecret({
      taskId: kept.id,
      name: 'kept-key',
      purpose: 'stays',
      kind: 'token',
      value: 'stays',
      passphrase: PASSPHRASE,
    })

    const jetable = await store.createAndOpenTask('To delete', 'x')
    await addSecret({
      taskId: jetable.id,
      name: 'doomed-key',
      purpose: 'goes',
      kind: 'token',
      value: 'goes',
      passphrase: PASSPHRASE,
    })

    await store.deleteCurrentTask()

    expect(await listSecretNames(jetable.id)).toHaveLength(0)
    expect(await listSecretNames(kept.id)).toHaveLength(1)
  })

  it('forgets the read marker too, which would otherwise pile up forever', async () => {
    const task = await store.openPreparedTask(buildCoreTask())
    markSeen(task.id, task.version)
    expect(seenVersion(task.id)).toBe(task.version)

    await store.deleteCurrentTask()
    await waitUntil(() => seenVersion(task.id) === null, 'the marker to clear')

    expect(seenVersion(task.id)).toBeNull()
  })

  it('forgets only its own', async () => {
    const kept = await store.openPreparedTask(buildCoreTask())
    markSeen(kept.id, 3)
    const jetable = await store.createAndOpenTask('To delete', 'x')
    markSeen(jetable.id, 2)

    await store.deleteCurrentTask()

    expect(seenVersion(jetable.id)).toBeNull()
    expect(seenVersion(kept.id)).toBe(3)
    forgetSeen(kept.id)
  })
})
