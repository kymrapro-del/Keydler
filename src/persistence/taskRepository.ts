import { getDb } from './db'
import type { TaskState } from '../domain/types'

/**
 * Accès aux cahiers. Une seule porte d'entrée vers IndexedDB : le reste de
 * l'application ignore où l'état est rangé.
 */

const LAST_TASK_KEY = 'lastTaskId'

export async function loadTask(id: string): Promise<TaskState | undefined> {
  const db = await getDb()
  return db.get('tasks', id)
}

export async function saveTask(state: TaskState): Promise<void> {
  const db = await getDb()
  const tx = db.transaction(['tasks', 'meta'], 'readwrite')
  await Promise.all([
    tx.objectStore('tasks').put(state),
    tx.objectStore('meta').put(state.id, LAST_TASK_KEY),
    tx.done,
  ])
}

export async function deleteTask(id: string): Promise<void> {
  const db = await getDb()
  await db.delete('tasks', id)
}

/** Cahiers du plus récemment touché au plus ancien. */
export async function listTasks(): Promise<TaskState[]> {
  const db = await getDb()
  const all = await db.getAllFromIndex('tasks', 'by-updatedAt')
  return all.reverse()
}

/**
 * Dernier cahier ouvert. C'est ce que `resume_task` restitue quand l'agent
 * arrive sans savoir de quelle tâche il s'agit — le cas de la conversation
 * neuve, qui est précisément celui qu'on cherche à couvrir.
 */
export async function loadLastTask(): Promise<TaskState | undefined> {
  const db = await getDb()
  const id = await db.get('meta', LAST_TASK_KEY)
  if (id) {
    const task = await db.get('tasks', id)
    if (task) return task
  }
  const all = await listTasks()
  return all[0]
}

export async function setLastTaskId(id: string): Promise<void> {
  const db = await getDb()
  await db.put('meta', id, LAST_TASK_KEY)
}
