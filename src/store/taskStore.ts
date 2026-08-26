import { StaleStateError } from '../domain/errors'
import { createTask, recordRefusal } from '../domain/task'
import type { Actor, TaskState } from '../domain/types'
import {
  listTasks,
  loadLastTask,
  loadTask,
  saveTask,
  setLastTaskId,
} from '../persistence/taskRepository'

/**
 * Magasin de tâche : source de vérité unique en mémoire (TAL-64).
 *
 * C'est le point de rencontre des trois couches. Les outils WebMCP écrivent
 * ici, le tableau de bord lit ici, IndexedDB reçoit une copie à chaque
 * changement. Aucune des trois ne parle directement aux autres.
 *
 * Le magasin est délibérément un singleton de module, hors du cycle de rendu
 * React : les outils doivent rester joignables même si aucun composant n'est
 * monté, et le mode strict de React ne doit jamais pouvoir les dédoubler.
 */

export type StoreStatus = 'loading' | 'ready' | 'empty' | 'error'

export type Snapshot = {
  status: StoreStatus
  task: TaskState | null
  error: string | null
}

type Listener = () => void

const listeners = new Set<Listener>()

let snapshot: Snapshot = { status: 'loading', task: null, error: null }
let initPromise: Promise<void> | null = null

function setSnapshot(next: Snapshot): void {
  snapshot = next
  for (const listener of listeners) listener()
}

export function getSnapshot(): Snapshot {
  return snapshot
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Charge un cahier. Sans identifiant, reprend le dernier ouvert — c'est le
 * chemin emprunté par un agent qui arrive sans contexte.
 */
export async function init(taskId?: string): Promise<void> {
  if (!initPromise || taskId) {
    initPromise = (async () => {
      try {
        const task = taskId ? await loadTask(taskId) : await loadLastTask()
        if (task) {
          await setLastTaskId(task.id)
          setSnapshot({ status: 'ready', task, error: null })
        } else {
          setSnapshot({ status: 'empty', task: null, error: null })
        }
      } catch (error) {
        setSnapshot({
          status: 'error',
          task: null,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })()
  }
  return initPromise
}

/** Force un rechargement depuis IndexedDB, en ignorant le cache d'init. */
export async function reload(taskId?: string): Promise<void> {
  initPromise = null
  return init(taskId ?? snapshot.task?.id)
}

export async function openTask(id: string): Promise<TaskState | undefined> {
  const task = await loadTask(id)
  if (task) {
    await setLastTaskId(id)
    setSnapshot({ status: 'ready', task, error: null })
  } else {
    setSnapshot({ status: 'empty', task: null, error: null })
  }
  return task
}

export async function createAndOpenTask(title: string, next?: string): Promise<TaskState> {
  const task = createTask({ title, next })
  await saveTask(task)
  setSnapshot({ status: 'ready', task, error: null })
  return task
}

/** Ouvre un cahier déjà constitué. Sert au cahier de démonstration. */
export async function openPreparedTask(task: TaskState): Promise<TaskState> {
  await saveTask(task)
  setSnapshot({ status: 'ready', task, error: null })
  return task
}

export async function allTasks(): Promise<TaskState[]> {
  return listTasks()
}

/** Cahier courant, ou `null` si aucun n'est ouvert. */
export function currentTask(): TaskState | null {
  return snapshot.task
}

/**
 * File d'écriture.
 *
 * Un agent émet volontiers plusieurs appels d'outil en parallèle. Sans
 * sérialisation, deux écritures concurrentes lisent le même état, produisent
 * chacune la version suivante, et la seconde écrase la première : les deux ont
 * passé le contrôle de version, et le numéro final ne trahit rien. C'est
 * exactement la perte silencieuse que ce produit existe pour empêcher.
 *
 * Sérialisée, la seconde écriture lit l'état déjà avancé et se fait refuser
 * pour état périmé — ce qui est le comportement voulu : un refus explicite
 * plutôt qu'une disparition.
 */
let writeQueue: Promise<unknown> = Promise.resolve()

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  // On enchaîne sur l'issue précédente quelle qu'elle soit : un refus ne doit
  // pas bloquer la file.
  const run = writeQueue.then(work, work)
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

/**
 * Corps d'une mutation. Suppose que l'appelant détient déjà la file : ne
 * jamais l'appeler directement, sous peine de rouvrir la fenêtre de course.
 */
async function applyLocked(fn: (state: TaskState) => TaskState): Promise<TaskState> {
  const current = snapshot.task
  if (!current) {
    throw new Error('NO ACTIVE TASK\nNo watch log is open on this device.')
  }
  const next = fn(current)
  await saveTask(next)
  setSnapshot({ status: 'ready', task: next, error: null })
  return next
}

/**
 * Applique une mutation pure, persiste, notifie. Toute écriture du produit
 * passe par ici : c'est ce qui garantit qu'aucune ne peut échapper à la
 * persistance, laisser l'écran désynchronisé, ou en écraser une autre.
 */
export async function mutate(fn: (state: TaskState) => TaskState): Promise<TaskState> {
  return enqueue(() => applyLocked(fn))
}

/**
 * Applique une écriture d'agent. Un refus pour état périmé est journalisé puis
 * relancé : le tableau de bord doit pouvoir l'afficher, et l'agent doit
 * recevoir l'instruction de rappeler `resume_task`.
 */
export async function mutateAsAgent(
  operation: string,
  basedOnVersion: number | null,
  fn: (state: TaskState) => TaskState,
  actor: Actor = 'agent',
): Promise<TaskState> {
  // Un seul passage dans la file pour la mutation ET la journalisation du
  // refus : deux passages laisseraient une autre écriture s'intercaler entre
  // l'échec et sa trace.
  return enqueue(async () => {
    try {
      return await applyLocked(fn)
    } catch (error) {
      const current = snapshot.task
      if (current) {
        const detail = error instanceof Error ? error.message.split('\n')[0] : String(error)
        const refused = recordRefusal(current, {
          operation,
          actor,
          basedOnVersion,
          detail:
            error instanceof StaleStateError
              ? `stale write on v${error.claimedVersion}, current v${error.currentVersion}`
              : detail,
        })
        await saveTask(refused)
        setSnapshot({ status: 'ready', task: refused, error: null })
      }
      throw error
    }
  })
}

/** Remet le magasin à son état initial. Réservé aux tests. */
export function __resetStore(): void {
  listeners.clear()
  writeQueue = Promise.resolve()
  snapshot = { status: 'loading', task: null, error: null }
  initPromise = null
}
