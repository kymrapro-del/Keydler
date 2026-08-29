import { ConcurrentWriteError, StaleStateError, ValidationError } from '../domain/errors'
import { CancelledError } from '../domain/errors'
import { createTask, findMutation, newTaskId, recordMutation, recordRefusal } from '../domain/task'
import type { Actor, TaskState } from '../domain/types'
import {
  deleteTask,
  listTasks,
  loadLastTask,
  loadTask,
  putTask,
  saveTask,
  setLastTaskId,
} from '../persistence/taskRepository'
import { deleteSecretsForTask } from '../persistence/vault'
import { forgetSeen } from '../persistence/seen'

export type StoreStatus = 'loading' | 'ready' | 'empty' | 'error' | 'missing'

export type Snapshot = {
  status: StoreStatus
  task: TaskState | null
  error: string | null
  boundId: string | null
}

type Listener = () => void

const listeners = new Set<Listener>()

let snapshot: Snapshot = { status: 'loading', task: null, error: null, boundId: null }

let tasksRevisionCounter = 0

export function tasksRevision(): number {
  return tasksRevisionCounter
}

function tasksChanged(): void {
  tasksRevisionCounter += 1
}
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

export function boundTaskId(): string | null {
  return snapshot.boundId
}

/**
 * Initialise la vitrine publique sans ouvrir silencieusement une mémoire.
 *
 * La racine `/` est une landing, même lorsqu'un cahier existe déjà dans ce
 * navigateur. Les espaces de travail restent adressables explicitement par
 * `/t/:id`; la vitrine ne choisit jamais une mémoire à la place de la personne.
 */
export async function initPublicLanding(): Promise<void> {
  if (!initPromise) {
    initPromise = enqueue(async () => {
      setSnapshot({ status: 'empty', task: null, error: null, boundId: null })
    })
  }
  return initPromise
}

/**
 * Charge un cahier.
 *
 * Avec un identifiant — celui de l'adresse — la page s'y LIE : elle rendra
 * cette tâche ou signalera sa disparition, jamais une autre.
 *
 * Sans identifiant, elle reprend le dernier cahier ouvert puis s'y lie. C'est
 * le chemin d'une première visite ; une fois lié, le comportement est le même.
 */
export async function init(taskId?: string): Promise<void> {
  if (!initPromise || (taskId !== undefined && taskId !== snapshot.boundId)) {
    initPromise = enqueue(async () => {
      try {
        const task = taskId ? await loadTask(taskId) : await loadLastTask()
        if (task) {
          await setLastTaskId(task.id)
          setSnapshot({ status: 'ready', task, error: null, boundId: task.id })
        } else if (taskId) {
          setSnapshot({ status: 'missing', task: null, error: null, boundId: taskId })
        } else {
          setSnapshot({ status: 'empty', task: null, error: null, boundId: null })
        }
      } catch (error) {
        setSnapshot({
          status: 'error',
          task: null,
          error: error instanceof Error ? error.message : String(error),
          boundId: taskId ?? null,
        })
      }
    })
  }
  return initPromise
}

export async function openTask(id: string): Promise<void> {
  if (id === snapshot.boundId && snapshot.status === 'ready') return
  initPromise = null
  await init(id)
}

export type ImportOutcome = {
  imported: string[]
  copied: string[]
  skipped: string[]
}

export async function importTasks(incoming: readonly TaskState[]): Promise<ImportOutcome> {
  return enqueue(async () => {
    const outcome: ImportOutcome = { imported: [], copied: [], skipped: [] }

    for (const task of incoming) {
      const existing = await loadTask(task.id)

      if (!existing) {
        await putTask(task)
        tasksChanged()
        outcome.imported.push(task.title)
        continue
      }

      if (existing.version === task.version && existing.updatedAt === task.updatedAt) {
        outcome.skipped.push(task.title)
        continue
      }

      const copy: TaskState = {
        ...task,
        id: newTaskId(),
        title: `${task.title} (imported)`,
      }
      await putTask(copy)
      tasksChanged()
      outcome.copied.push(copy.title)
    }

    if (snapshot.task) {
      const fresh = await loadTask(snapshot.task.id)
      if (fresh) setSnapshot({ status: 'ready', task: fresh, error: null, boundId: fresh.id })
    }

    return outcome
  })
}

/**
 * Fusionne un instantané authentifié venu du cloud.
 *
 * Une version distante plus récente remplace la copie locale. Une version
 * identique ou plus ancienne est ignorée : le moteur de domaine utilise déjà
 * la version comme verrou optimiste, donc une synchronisation ne doit jamais
 * faire reculer un cahier ni créer une seconde vérité silencieuse.
 */
export async function mergeCloudTask(
  incoming: TaskState,
): Promise<'inserted' | 'updated' | 'ignored'> {
  return enqueue(async () => {
    const existing = await loadTask(incoming.id)
    if (existing && existing.version >= incoming.version) return 'ignored'

    await putTask(incoming)
    tasksChanged()
    if (!existing) return 'inserted'

    if (snapshot.boundId === incoming.id) {
      setSnapshot({ status: 'ready', task: incoming, error: null, boundId: incoming.id })
    }
    return 'updated'
  })
}

export async function updateTask(
  id: string,
  fn: (state: TaskState) => TaskState,
): Promise<TaskState> {
  return enqueue(async () => {
    if (snapshot.task && snapshot.task.id === id) {
      return applyLocked(fn)
    }

    const current = await loadTask(id)
    if (!current) throw new Error('NO SUCH TASK\nThat task is not on this device any more.')

    const next = fn(current)
    await saveTask(next, current.version)
    tasksChanged()
    if (snapshot.task) await setLastTaskId(snapshot.task.id)
    return next
  })
}

export async function createAndOpenTask(title: string, next?: string): Promise<TaskState> {
  const task = createTask({ title, next })
  await saveTask(task)
  tasksChanged()
  setSnapshot({ status: 'ready', task, error: null, boundId: task.id })
  return task
}

export async function openPreparedTask(task: TaskState): Promise<TaskState> {
  await saveTask(task)
  tasksChanged()
  setSnapshot({ status: 'ready', task, error: null, boundId: task.id })
  return task
}

export async function deleteCurrentTask(): Promise<void> {
  const current = snapshot.task
  if (!current) return

  await enqueue(async () => {
    // Les identifiants scellés vivent hors de l'état de la tâche : sans cet
    // appel, ils survivaient à la suppression, hors d'atteinte de l'écran mais
    // bien présents sur le disque. On les supprime en premier et on laisse
    // remonter toute erreur : la tâche reste alors visible et l'écran peut dire
    // honnêtement que la suppression n'a pas abouti.
    await deleteSecretsForTask(current.id)
    await deleteTask(current.id)
    forgetSeen(current.id)
    tasksChanged()
    const suivant = await loadLastTask()
    if (suivant) {
      await setLastTaskId(suivant.id)
      setSnapshot({ status: 'ready', task: suivant, error: null, boundId: suivant.id })
    } else {
      setSnapshot({ status: 'empty', task: null, error: null, boundId: null })
    }
  })
}

export async function allTasks(): Promise<TaskState[]> {
  return listTasks()
}

export function currentTask(): TaskState | null {
  return snapshot.task
}

export function storageFailure(): string | null {
  return snapshot.status === 'error' ? snapshot.error : null
}

export function missingTaskId(): string | null {
  return snapshot.status === 'missing' ? snapshot.boundId : null
}

let writeQueue: Promise<unknown> = Promise.resolve()

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(work, work)
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

async function applyLocked(fn: (state: TaskState) => TaskState): Promise<TaskState> {
  const current = snapshot.task
  if (!current) {
    throw new Error('NO ACTIVE TASK\nNo nightorder is open on this device.')
  }
  const next = fn(current)

  try {
    await saveTask(next, current.version)
  } catch (error) {
    if (error instanceof ConcurrentWriteError) {
      await resyncFromDisk(current.id)
    }
    throw error
  }

  setSnapshot({ status: 'ready', task: next, error: null, boundId: next.id })
  return next
}

async function resyncFromDisk(id: string): Promise<void> {
  try {
    const fresh = await loadTask(id)
    if (fresh) setSnapshot({ status: 'ready', task: fresh, error: null, boundId: fresh.id })
  } catch {}
}

export async function mutate(fn: (state: TaskState) => TaskState): Promise<TaskState> {
  return enqueue(() => applyLocked(fn))
}

export type AgentWrite = {
  operation: string
  basedOnVersion: number
  mutationId: string
  fingerprint: string
  signal?: AbortSignal
  mutate: (state: TaskState) => TaskState
  render: (next: TaskState) => string
}

export type AgentWriteOutcome = {
  text: string
  replayed: boolean
  version: number
}

export async function mutateAsAgent(
  write: AgentWrite,
  actor: Actor = 'agent',
): Promise<AgentWriteOutcome> {
  return enqueue(async () => {
    const ouvert = snapshot.task
    if (!ouvert) {
      throw new Error('NO ACTIVE TASK\nNo nightorder is open on this device.')
    }

    let rendu = ''
    try {
      if (write.signal?.aborted) throw new CancelledError(write.operation)

      const déjàFaite = findMutation(ouvert, write.mutationId)
      if (déjàFaite) {
        if (déjàFaite.operation !== write.operation) {
          throw new ValidationError(
            'mutation_id',
            `was already used for ${déjàFaite.operation}; a mutation_id identifies one write and cannot be reused. ` +
              'Use a fresh one.',
            { code: 'mutation-id-reused', retryable: false },
          )
        }
        if (déjàFaite.fingerprint !== write.fingerprint) {
          throw new ValidationError(
            'mutation_id',
            `was already used for a ${déjàFaite.operation} call with different arguments. ` +
              'A mutation_id identifies one write. Nothing was written. ' +
              'Use a fresh mutation_id for this work, or resend the original arguments to get the original reply.',
            { code: 'mutation-id-collision', retryable: false },
          )
        }
        return { text: déjàFaite.result, replayed: true, version: déjàFaite.version }
      }

      const appliqué = await applyLocked((state) => {
        const next = write.mutate(state)
        rendu = write.render(next)
        return recordMutation(next, {
          id: write.mutationId,
          operation: write.operation,
          version: next.version,
          fingerprint: write.fingerprint,
          result: rendu,
          at: next.updatedAt,
        })
      })
      return { text: rendu, replayed: false, version: appliqué.version }
    } catch (error) {
      const current = snapshot.task
      if (current) {
        const detail =
          error instanceof ValidationError
            ? `${error.field}: ${error.code}`
            : error instanceof Error
              ? error.message.split('\n')[0]
              : String(error)
        const refused = recordRefusal(current, {
          operation: write.operation,
          actor,
          basedOnVersion: write.basedOnVersion,
          detail:
            error instanceof StaleStateError
              ? `stale write on v${error.claimedVersion}, current v${error.currentVersion}`
              : error instanceof ConcurrentWriteError
                ? `another page wrote v${error.foundVersion} while this one held v${error.expectedVersion}`
                : error instanceof CancelledError
                  ? 'cancelled before anything was written'
                  : detail,
        })
        await saveTask(refused, current.version)
        setSnapshot({ status: 'ready', task: refused, error: null, boundId: refused.id })
      }
      throw error
    }
  })
}

export async function recordAgentRefusal(
  operation: string,
  basedOnVersion: number | null,
  detail: string,
  actor: Actor = 'agent',
): Promise<void> {
  await enqueue(async () => {
    const current = snapshot.task
    if (!current) return
    const refused = recordRefusal(current, { operation, actor, basedOnVersion, detail })
    await saveTask(refused, current.version)
    setSnapshot({ status: 'ready', task: refused, error: null, boundId: refused.id })
  })
}

export function __resetStore(): void {
  tasksRevisionCounter = 0
  listeners.clear()
  writeQueue = Promise.resolve()
  snapshot = { status: 'loading', task: null, error: null, boundId: null }
  initPromise = null
}
