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

describe('supprimer une tâche ne laisse rien derrière', () => {
  it('emporte les identifiants scellés avec elle', async () => {
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

    // Le scellé restait dans IndexedDB, hors d'atteinte de l'écran mais bien
    // présent sur le disque, alors que l'humain croit avoir tout supprimé.
    expect(await listSecretNames(task.id)).toHaveLength(0)

    const db = await getDb()
    const restants = await db.getAll('secrets')
    expect(restants.filter((s) => s.taskId === task.id)).toHaveLength(0)
  })

  it('ne touche pas aux identifiants des autres cahiers', async () => {
    const gardé = await store.openPreparedTask(buildCoreTask())
    await addSecret({
      taskId: gardé.id,
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
    expect(await listSecretNames(gardé.id)).toHaveLength(1)
  })

  it('oublie aussi le repère de lecture, qui sinon s’accumule sans fin', async () => {
    const task = await store.openPreparedTask(buildCoreTask())
    markSeen(task.id, task.version)
    expect(seenVersion(task.id)).toBe(task.version)

    await store.deleteCurrentTask()
    await waitUntil(() => seenVersion(task.id) === null, 'le repère effacé')

    expect(seenVersion(task.id)).toBeNull()
  })

  it('n’oublie que le sien', async () => {
    const gardé = await store.openPreparedTask(buildCoreTask())
    markSeen(gardé.id, 3)
    const jetable = await store.createAndOpenTask('To delete', 'x')
    markSeen(jetable.id, 2)

    await store.deleteCurrentTask()

    expect(seenVersion(jetable.id)).toBeNull()
    expect(seenVersion(gardé.id)).toBe(3)
    forgetSeen(gardé.id)
  })
})
