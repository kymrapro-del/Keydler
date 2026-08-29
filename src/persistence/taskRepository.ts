import { ConcurrentWriteError, TaskGoneError } from '../domain/errors'
import { getDb } from './db'
import { normalizeTask, toStored } from './normalize'
import type { TaskState } from '../domain/types'

const LAST_TASK_KEY = 'lastTaskId'

export async function loadTask(id: string): Promise<TaskState | undefined> {
  const db = await getDb()
  return normalizeTask(await db.get('tasks', id))
}

export async function saveTask(state: TaskState, expectedVersion?: number): Promise<void> {
  const db = await getDb()
  const tx = db.transaction(['tasks', 'meta'], 'readwrite')
  const tasks = tx.objectStore('tasks')

  if (expectedVersion !== undefined) {
    // The check is about one integer only, and it re-read the whole task to
    // get it: 2 ms for 800 KB in Chrome, against 0.1 ms for a key. The
    // `by-id-version` index answers “is this task at THIS version” without
    // fetching its content back. IndexedDB maintains it from the task's own
    // fields: no mirror to keep in step, so nothing that drifts.
    const àJour = await tasks.index('by-id-version').getKey([state.id, expectedVersion])
    if (àJour === undefined) {
      // The task moved, or it is GONE: the second case passed for “not created
      // yet” and fell back on the `put`, resurrecting a task deleted in another
      // tab without its sealed credentials, which really were erased.
      const existe = await tasks.getKey(state.id)
      tx.abort()
      tx.done.catch(() => undefined)
      if (existe === undefined) throw new TaskGoneError(state.id)

      const relecture = db.transaction('tasks', 'readonly')
      const stored = await relecture.objectStore('tasks').get(state.id)
      throw new ConcurrentWriteError(expectedVersion, stored?.version ?? -1)
    }
  }

  await Promise.all([
    tasks.put(toStored(state)),
    tx.objectStore('meta').put(state.id, LAST_TASK_KEY),
    tx.done,
  ])
}

export async function putTask(state: TaskState): Promise<void> {
  const db = await getDb()
  await db.put('tasks', toStored(state))
}

export async function deleteTask(id: string): Promise<void> {
  const db = await getDb()
  await db.delete('tasks', id)
}

export async function listTasks(): Promise<TaskState[]> {
  const db = await getDb()
  const all = await db.getAllFromIndex('tasks', 'by-updatedAt')
  return all
    .reverse()
    .map((t) => {
      try {
        return normalizeTask(t)
      } catch {
        return undefined
      }
    })
    .filter((t): t is TaskState => t !== undefined)
}

export async function loadLastTask(): Promise<TaskState | undefined> {
  const db = await getDb()
  const id = await db.get('meta', LAST_TASK_KEY)
  if (id) {
    const task = normalizeTask(await db.get('tasks', id))
    if (task) return task
  }

  // The fallback (no last known task) fetched back EVERY task on the device to
  // keep just one: 22 ms for thirty. The index is already sorted by write
  // date; only its keys are needed, and we walk down to the next one only if
  // the most recent is unreadable, as before.
  const clés = await db.getAllKeysFromIndex('tasks', 'by-updatedAt')
  for (let i = clés.length - 1; i >= 0; i--) {
    try {
      const task = normalizeTask(await db.get('tasks', clés[i]))
      if (task) return task
    } catch {
      // Unreadable: try the previous one, saying nothing more than the bulk
      // read did.
    }
  }
  return undefined
}

export async function setLastTaskId(id: string): Promise<void> {
  const db = await getDb()
  await db.put('meta', id, LAST_TASK_KEY)
}
