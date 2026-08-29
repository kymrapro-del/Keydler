import { beforeEach, describe, expect, it, vi } from 'vitest'

const { deleteSecretsForTask } = vi.hoisted(() => ({
  deleteSecretsForTask: vi.fn<() => Promise<void>>(),
}))

vi.mock('../src/persistence/vault', async () => {
  const actual = await vi.importActual<typeof import('../src/persistence/vault')>(
    '../src/persistence/vault',
  )
  return { ...actual, deleteSecretsForTask }
})

import { loadTask } from '../src/persistence/taskRepository'
import * as store from '../src/store/taskStore'
import { clearDatabase } from './helpers'

beforeEach(async () => {
  deleteSecretsForTask.mockReset()
  store.__resetStore()
  await clearDatabase()
  await store.init()
})

describe('échec de suppression des secrets', () => {
  it('remonte l’erreur et conserve la tâche visible', async () => {
    const task = await store.createAndOpenTask('Keep until cleanup succeeds', 'Continue')
    deleteSecretsForTask.mockRejectedValueOnce(new Error('credential cleanup failed'))

    await expect(store.deleteCurrentTask()).rejects.toThrow('credential cleanup failed')
    expect(store.currentTask()?.id).toBe(task.id)
    expect(await loadTask(task.id)).toBeDefined()
  })
})
