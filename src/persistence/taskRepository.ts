import { ConcurrentWriteError } from '../domain/errors'
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
    const stored = await tasks.get(state.id)
    if (stored && stored.version !== expectedVersion) {
      tx.abort()
      tx.done.catch(() => undefined)
      throw new ConcurrentWriteError(expectedVersion, stored.version)
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
  const all = await listTasks()
  return all[0]
}

export async function setLastTaskId(id: string): Promise<void> {
  const db = await getDb()
  await db.put('meta', id, LAST_TASK_KEY)
}
