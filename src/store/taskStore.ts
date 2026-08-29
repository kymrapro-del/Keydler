import { ConcurrentWriteError, StaleStateError, ValidationError } from '../domain/errors'
import { CancelledError } from '../domain/errors'
import { createTask, findMutation, newTaskId, recordMutation, recordRefusal } from '../domain/task'
import { cardOf, type TaskCard } from '../domain/card'
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

/** The number of tasks changed, and the other tabs must re-read the list. */
function tasksChangedEverywhere(): void {
  tasksChanged()
  announce(null, 0)
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

export async function init(taskId?: string): Promise<void> {
  // Open the channel HERE, and not on the first announcement. A tab that only
  // reads never announces anything: created lazily, it stayed deaf, and it was
  // exactly the tab to wake. Found in the browser, with two tabs. The suite did
  // not see it, because every one of its stores had written before listening.
  bus()

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
        tasksChangedEverywhere()
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
      tasksChangedEverywhere()
      outcome.copied.push(copy.title)
    }

    if (snapshot.task) {
      const fresh = await loadTask(snapshot.task.id)
      if (fresh) setSnapshot({ status: 'ready', task: fresh, error: null, boundId: fresh.id })
    }

    return outcome
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
    tasksChangedEverywhere()
    if (snapshot.task) await setLastTaskId(snapshot.task.id)
    return next
  })
}

export async function createAndOpenTask(title: string, next?: string): Promise<TaskState> {
  const task = createTask({ title, next })
  await saveTask(task)
  tasksChangedEverywhere()
  setSnapshot({ status: 'ready', task, error: null, boundId: task.id })
  return task
}

export async function openPreparedTask(task: TaskState): Promise<TaskState> {
  await saveTask(task)
  tasksChangedEverywhere()
  setSnapshot({ status: 'ready', task, error: null, boundId: task.id })
  return task
}

export async function deleteCurrentTask(): Promise<void> {
  const current = snapshot.task
  if (!current) return

  await enqueue(async () => {
    await deleteTask(current.id)
    // Sealed credentials live outside the task state: without this call they
    // survived the deletion, out of reach of the screen but very much present
    // on disk.
    await deleteSecretsForTask(current.id).catch(() => undefined)
    forgetSeen(current.id)
    tasksChanged()
    // Name the deleted task, and not only "the list changed": without that the
    // other tab kept a vanished task on screen, and its next write brought it
    // back, stripped of its sealed credentials, which had been erased.
    announce(current.id, 0, true)
    const following = await loadLastTask()
    if (following) {
      await setLastTaskId(following.id)
      setSnapshot({ status: 'ready', task: following, error: null, boundId: following.id })
    } else {
      setSnapshot({ status: 'empty', task: null, error: null, boundId: null })
    }
  })
}

export async function allTasks(): Promise<TaskState[]> {
  return listTasks()
}

/**
 * The same read, cut down to what the picker displays. Whole tasks become
 * collectable as soon as it returns: it is the retained memory that is
 * bounded, not the cost of the read.
 */
export async function allTaskCards(): Promise<TaskCard[]> {
  return (await listTasks()).map(cardOf)
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
    throw new Error('NO ACTIVE TASK\nNo log is open on this device.')
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
  announce(next.id, next.version)
  return next
}

// Two tabs on the same task: measured, the second wrote up to v31 while the
// first still displayed v29 and "Task closed". `BroadcastChannel` does not
// deliver to the context that posts, so there is no echo to filter. The re-read
// goes through the write queue, otherwise it would slot into a write in flight.
const CHANNEL = 'cahier-de-quart'

type Announcement = { id: string | null; version: number; gone?: boolean }

let channel: BroadcastChannel | null = null

function bus(): BroadcastChannel | null {
  if (typeof BroadcastChannel !== 'function') return null
  if (!channel) {
    channel = new BroadcastChannel(CHANNEL)
    channel.onmessage = (event: MessageEvent<Announcement>) => {
      const { id, version, gone } = event.data ?? { id: null, version: 0 }
      // Never `tasksChangedEverywhere` here: re-announcing what we have just
      // received would bounce the message between two tabs, each answering the
      // other, endlessly.
      tasksChanged()

      if (id !== null && id === snapshot.boundId) {
        if (gone) {
          // The task was deleted elsewhere. Keeping quiet let this tab write
          // to it, and its write brought it back.
          setSnapshot({ status: 'missing', task: null, error: null, boundId: id })
        } else if (version > (snapshot.task?.version ?? 0)) {
          scheduleReread(id, version)
        }
      }
      for (const listener of listeners) listener()
    }
  }
  return channel
}

function announce(id: string | null, version: number, gone = false): void {
  try {
    bus()?.postMessage({ id, version, gone })
  } catch {
    // A tab that closes can close the channel under our feet. Announcing
    // nothing is a display defect elsewhere, not a lost write.
  }
}

// A burst of announcements must not produce a burst of re-reads: measured on a
// 20,000 step task, 50 announcements cost 1702 ms of which 1668 thrown away
// (deserializing the record, not normalizing it) and delayed local writes, which
// share the queue, by a factor of 51. One re-read per task is enough: the highest
// version announced decides whether to re-read.
const pendingRereads = new Map<string, number>()

function scheduleReread(id: string, version: number): void {
  const alreadyQueued = pendingRereads.has(id)
  pendingRereads.set(id, Math.max(pendingRereads.get(id) ?? 0, version))
  if (alreadyQueued) return

  void enqueue(async () => {
    const target = pendingRereads.get(id) ?? 0
    pendingRereads.delete(id)
    // The open task can have changed between the announcement and its turn in the queue.
    if (id !== snapshot.boundId) return
    if (target <= (snapshot.task?.version ?? 0)) return
    await resyncFromDisk(id)
  })
}

async function resyncFromDisk(id: string): Promise<void> {
  try {
    const fresh = await loadTask(id)
    // Recheck the binding AFTER the await: the guard set when the message
    // arrived says nothing about what happened during the read, and writing
    // here without redoing it flipped the screen (and `boundId`) back to the
    // previous task, just after the user had opened another one.
    if (id !== snapshot.boundId) return
    if (fresh) setSnapshot({ status: 'ready', task: fresh, error: null, boundId: fresh.id })
    else setSnapshot({ status: 'missing', task: null, error: null, boundId: id })
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
      throw new Error('NO ACTIVE TASK\nNo log is open on this device.')
    }

    let rendered = ''
    try {
      if (write.signal?.aborted) throw new CancelledError(write.operation)

      const alreadyDone = findMutation(ouvert, write.mutationId)
      if (alreadyDone) {
        if (alreadyDone.operation !== write.operation) {
          throw new ValidationError(
            'mutation_id',
            `was already used for ${alreadyDone.operation}; a mutation_id identifies one write and cannot be reused. ` +
              'Use a fresh one.',
            { code: 'mutation-id-reused', retryable: false },
          )
        }
        if (alreadyDone.fingerprint !== write.fingerprint) {
          throw new ValidationError(
            'mutation_id',
            `was already used for a ${alreadyDone.operation} call with different arguments. ` +
              'A mutation_id identifies one write. Nothing was written. ' +
              'Use a fresh mutation_id for this work, or resend the original arguments to get the original reply.',
            { code: 'mutation-id-collision', retryable: false },
          )
        }
        return { text: alreadyDone.result, replayed: true, version: alreadyDone.version }
      }

      const applied = await applyLocked((state) => {
        const next = write.mutate(state)
        rendered = write.render(next)
        return recordMutation(next, {
          id: write.mutationId,
          operation: write.operation,
          version: next.version,
          fingerprint: write.fingerprint,
          result: rendered,
          at: next.updatedAt,
        })
      })
      return { text: rendered, replayed: false, version: applied.version }
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
  channel?.close()
  channel = null
  tasksRevisionCounter = 0
  listeners.clear()
  writeQueue = Promise.resolve()
  snapshot = { status: 'loading', task: null, error: null, boundId: null }
  initPromise = null
}
