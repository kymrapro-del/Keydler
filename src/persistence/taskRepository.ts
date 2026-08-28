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
    // Le contrôle ne porte que sur un entier, et il relisait tout le cahier
    // pour l'obtenir : 2 ms pour 800 ko dans Chrome, contre 0,1 ms pour une
    // clé. L'index `by-id-version` répond « ce cahier est-il à CETTE version »
    // sans rapatrier son contenu. Il est tenu par IndexedDB à partir des
    // champs du cahier : aucun miroir à maintenir, donc rien qui dérive.
    const àJour = await tasks.index('by-id-version').getKey([state.id, expectedVersion])
    if (àJour === undefined) {
      // Deux cas se ressemblent ici : le cahier n'existe pas encore, ou il a
      // bougé. Seul le second est un conflit, et lui seul paie la relecture —
      // parce qu'il faut dire à quelle version on est vraiment.
      const existe = await tasks.getKey(state.id)
      if (existe !== undefined) {
        const stored = await tasks.get(state.id)
        tx.abort()
        tx.done.catch(() => undefined)
        throw new ConcurrentWriteError(expectedVersion, stored?.version ?? -1)
      }
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

  // Le repli — plus de dernier cahier connu — rapatriait TOUS les cahiers du
  // poste pour n'en garder qu'un : 22 ms pour trente. L'index est déjà trié
  // par date d'écriture ; on n'a besoin que de ses clés, et l'on ne descend
  // vers le suivant que si le plus récent est illisible, comme avant.
  const clés = await db.getAllKeysFromIndex('tasks', 'by-updatedAt')
  for (let i = clés.length - 1; i >= 0; i--) {
    try {
      const task = normalizeTask(await db.get('tasks', clés[i]))
      if (task) return task
    } catch {
      // Illisible : on essaie le précédent, sans rien dire de plus que ce que
      // faisait la lecture en bloc.
    }
  }
  return undefined
}

export async function setLastTaskId(id: string): Promise<void> {
  const db = await getDb()
  await db.put('meta', id, LAST_TASK_KEY)
}
