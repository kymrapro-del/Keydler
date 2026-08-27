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
      outcome.copied.push(copy.title)
    }

    if (snapshot.task) {
      const fresh = await loadTask(snapshot.task.id)
      if (fresh) setSnapshot({ status: 'ready', task: fresh, error: null, boundId: fresh.id })
    }

    return outcome
  })
}

export async function createAndOpenTask(title: string, next?: string): Promise<TaskState> {
  const task = createTask({ title, next })
  await saveTask(task)
  setSnapshot({ status: 'ready', task, error: null, boundId: task.id })
  return task
}

export async function openPreparedTask(task: TaskState): Promise<TaskState> {
  await saveTask(task)
  setSnapshot({ status: 'ready', task, error: null, boundId: task.id })
  return task
}

export async function deleteCurrentTask(): Promise<void> {
  const current = snapshot.task
  if (!current) return

  await enqueue(async () => {
    await deleteTask(current.id)
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
    throw new Error('NO ACTIVE TASK\nNo watch log is open on this device.')
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
      throw new Error('NO ACTIVE TASK\nNo watch log is open on this device.')
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
  listeners.clear()
  writeQueue = Promise.resolve()
  snapshot = { status: 'loading', task: null, error: null, boundId: null }
  initPromise = null
}
