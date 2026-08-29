import { describe, expect, it } from 'vitest'
import { ConcurrentWriteError, TaskGoneError } from '../src/domain/errors'
import { buildCoreTask } from '../src/demo/seed'
import { loadTask, saveTask } from '../src/persistence/taskRepository'
import { getDb } from '../src/persistence/db'
import type { TaskState } from '../src/domain/types'

// Concurrency control goes through the `by-id-version` index rather than a full
// re-read of the task: 2 ms for 800 kB in Chrome, against 0.1 ms for a key.
// This file opens the database at the OLD version before anything else touches
// it, so that the migration really happens: `getDb()` memoises its promise, and
// a single earlier call would make the test hollow.
function ancienneBase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('cahier-de-quart', 2)
    request.onupgradeneeded = () => {
      const db = request.result
      const tasks = db.createObjectStore('tasks', { keyPath: 'id' })
      tasks.createIndex('by-updatedAt', 'updatedAt')
      db.createObjectStore('meta')
      const secrets = db.createObjectStore('secrets', { keyPath: 'id' })
      secrets.createIndex('by-taskId', 'taskId')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function writeOldStyle(db: IDBDatabase, task: TaskState): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('tasks', 'readwrite')
    tx.objectStore('tasks').put({ ...task, schemaVersion: 10 })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

describe('a log written before the index stays protected', () => {
  it('migrates, then refuses a stale write and says the real version', async () => {
    const installed: TaskState = { ...buildCoreTask(), id: 'ancien', version: 7 }

    const vieille = await ancienneBase()
    await writeOldStyle(vieille, installed)
    vieille.close()

    // First contact between the application code and the database: this is
    // where the migration to the index happens, on a record already present.
    const db = await getDb()
    expect(db.version).toBe(3)

    const relu = await loadTask('ancien')
    expect(relu?.version).toBe(7)

    // At the right version: accepted.
    await saveTask({ ...relu!, version: 8 }, 7)
    expect((await loadTask('ancien'))?.version).toBe(8)

    // At a stale version: refused, and the message carries the REAL version,
    // without which the caller would not know what to rebase on.
    const error = await saveTask({ ...relu!, version: 9 }, 7).catch((e) => e)
    expect(error).toBeInstanceOf(ConcurrentWriteError)
    expect((error as ConcurrentWriteError).message).toContain('8')
    expect((await loadTask('ancien'))?.version).toBe(8)
  })

  // A write that CARRIES an expected version is by definition an update:
  // creations take the versionless path. A missing key is therefore a task
  // deleted elsewhere, and letting it through resurrected it with all its steps
  // and its evidence, but without its sealed credentials, which really were
  // erased.
  it('refuses to resurrect a deleted log, and does not recreate it', async () => {
    const installed: TaskState = { ...buildCoreTask(), id: 'supprime', version: 3 }
    await saveTask(installed)
    expect((await loadTask('supprime'))?.version).toBe(3)

    const db = await getDb()
    await db.delete('tasks', 'supprime')

    const error = await saveTask({ ...installed, version: 4 }, 3).catch((e) => e)
    expect(error).toBeInstanceOf(TaskGoneError)
    expect((error as Error).message).toContain('was deleted')
    expect(await loadTask('supprime')).toBeUndefined()
  })

  it('lets a creation through, since it carries no expected version', async () => {
    const neuf: TaskState = { ...buildCoreTask(), id: 'jamais-vu', version: 1 }
    await saveTask(neuf)
    expect((await loadTask('jamais-vu'))?.version).toBe(1)
  })
})
