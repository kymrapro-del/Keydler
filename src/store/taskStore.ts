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

/** Le nombre de cahiers a changé — les autres onglets doivent relire la liste. */
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
  // Ouvrir le canal ICI, et pas à la première annonce. Un onglet qui ne fait
  // que lire n'annonce jamais rien : créé paresseusement, il restait sourd, et
  // c'était précisément l'onglet à réveiller. Trouvé en navigateur, avec deux
  // onglets — la suite ne l'a pas vu, parce que chacun de ses magasins avait
  // écrit avant d'écouter.
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
    // Les identifiants scellés vivent hors de l'état de la tâche : sans cet
    // appel, ils survivaient à la suppression, hors d'atteinte de l'écran mais
    // bien présents sur le disque.
    await deleteSecretsForTask(current.id).catch(() => undefined)
    forgetSeen(current.id)
    tasksChanged()
    // Nommer le cahier supprimé, et pas seulement « la liste a changé » : sans
    // cela l'autre onglet gardait un cahier disparu à l'écran, et sa prochaine
    // écriture le ressuscitait — amputé de ses identifiants scellés, eux bien
    // effacés.
    announce(current.id, 0, true)
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

/**
 * La même lecture, réduite à ce que le sélecteur affiche. Les cahiers entiers
 * deviennent collectables dès le retour : c'est la mémoire retenue qu'on
 * borne, pas le coût de la lecture.
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
  announce(next.id, next.version)
  return next
}

/**
 * Deux onglets sur la même tâche : l'un écrivait, l'autre gardait son écran
 * d'avant. Mesuré, un second onglet a rouvert la tâche et écrit jusqu'à v31
 * pendant que le premier affichait encore v29 et « Task closed ». Il ne
 * l'apprenait qu'en tentant d'écrire — la sûreté tenait, l'écran mentait.
 *
 * `BroadcastChannel` ne livre pas au contexte qui poste : personne ne réagit
 * donc à sa propre annonce, et il n'y a pas d'écho à filtrer. La relecture
 * passe par la file d'écriture, sinon elle pourrait s'intercaler au milieu
 * d'une écriture en cours et remettre en place un état déjà dépassé.
 */
const CHANNEL = 'cahier-de-quart'

type Announcement = { id: string | null; version: number; gone?: boolean }

let channel: BroadcastChannel | null = null

function bus(): BroadcastChannel | null {
  if (typeof BroadcastChannel !== 'function') return null
  if (!channel) {
    channel = new BroadcastChannel(CHANNEL)
    channel.onmessage = (event: MessageEvent<Announcement>) => {
      const { id, version, gone } = event.data ?? { id: null, version: 0 }
      // Surtout PAS `tasksChangedEverywhere` ici : réannoncer ce qu'on vient de
      // recevoir ferait rebondir le message entre deux onglets, chacun
      // répondant à l'autre, sans fin.
      tasksChanged()

      if (id !== null && id === snapshot.boundId) {
        if (gone) {
          // Le cahier a été supprimé ailleurs. Le taire laissait cet onglet
          // écrire dessus, et son écriture le ressuscitait.
          setSnapshot({ status: 'missing', task: null, error: null, boundId: id })
        } else if (version > (snapshot.task?.version ?? 0)) {
          planifierRelecture(id, version)
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
    // Un onglet qui se ferme peut fermer le canal sous nos pieds. Ne rien
    // annoncer est un défaut d'affichage ailleurs, pas une écriture perdue.
  }
}

/**
 * Une rafale d'annonces ne doit pas produire une rafale de relectures. Mesuré
 * sur un cahier de 20 000 étapes : 50 annonces coûtaient 50 lectures et
 * 1702 ms, dont 1668 ms jetés — la désérialisation de l'enregistrement est le
 * coût, pas la normalisation. Et comme la file d'écriture est partagée avec
 * les écritures locales, ces relectures retardaient les écritures de cet
 * onglet d'un facteur 51.
 *
 * On ne retient donc qu'une relecture par cahier : la version la plus haute
 * annoncée suffit à décider s'il faut relire, et le disque rendra de toute
 * façon ce qu'il porte au moment où l'on y va.
 */
const relecturesAttendues = new Map<string, number>()

function planifierRelecture(id: string, version: number): void {
  const déjàEnFile = relecturesAttendues.has(id)
  relecturesAttendues.set(id, Math.max(relecturesAttendues.get(id) ?? 0, version))
  if (déjàEnFile) return

  void enqueue(async () => {
    const visée = relecturesAttendues.get(id) ?? 0
    relecturesAttendues.delete(id)
    // Le cahier ouvert a pu changer entre l'annonce et son tour dans la file.
    if (id !== snapshot.boundId) return
    if (visée <= (snapshot.task?.version ?? 0)) return
    await resyncFromDisk(id)
  })
}

async function resyncFromDisk(id: string): Promise<void> {
  try {
    const fresh = await loadTask(id)
    // Revérifier la liaison APRÈS l'attente : la garde posée à la réception du
    // message ne dit rien de ce qui s'est passé pendant la lecture, et écrire
    // ici sans la refaire rebasculait l'écran — et `boundId` — sur le cahier
    // précédent, juste après que l'utilisateur en a ouvert un autre.
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
  channel?.close()
  channel = null
  tasksRevisionCounter = 0
  listeners.clear()
  writeQueue = Promise.resolve()
  snapshot = { status: 'loading', task: null, error: null, boundId: null }
  initPromise = null
}
