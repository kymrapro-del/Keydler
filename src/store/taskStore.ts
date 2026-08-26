import { ConcurrentWriteError, StaleStateError, ValidationError } from '../domain/errors'
import { CancelledError } from '../domain/errors'
import { createTask, findMutation, recordMutation, recordRefusal } from '../domain/task'
import type { Actor, TaskState } from '../domain/types'
import {
  deleteTask,
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

export type StoreStatus = 'loading' | 'ready' | 'empty' | 'error' | 'missing'

export type Snapshot = {
  status: StoreStatus
  task: TaskState | null
  error: string | null
  /**
   * Le cahier auquel la page est LIÉE, par son adresse `/t/:id`.
   *
   * Sans ce lien, `resume_task` rendait « le dernier cahier touché sur cet
   * appareil ». Deux onglets ouverts sur deux tâches suffisaient donc à ce
   * qu'un agent reçoive l'état d'une tâche qui n'était pas la sienne, sans
   * qu'aucune ligne de la réponse ne le dise. Une page liée rend cette tâche-là
   * ou dit qu'elle a disparu ; elle n'en substitue jamais une autre.
   */
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

/** Le cahier auquel la page est liée, ou `null` si elle ne l'est pas encore. */
export function boundTaskId(): string | null {
  return snapshot.boundId
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
    // DANS la file d'écriture, comme tout ce qui pose un état.
    //
    // La lecture du disque et le `setSnapshot` qui la suit étaient hors file.
    // Rien n'empêchait donc la lecture de partir avant qu'une écriture en
    // cours ne soit persistée et d'atterrir après : la page se retrouvait avec
    // un état ANTÉRIEUR à celui qu'elle venait d'appliquer, et le numéro de
    // version reculait. Le déclencheur est banal — `requireTask()` appelle
    // `init()`, donc le tout premier appel d'outil d'un agent suffisait à
    // défaire la contrainte que l'humain venait de poser.
    //
    // Sérialisée, la lecture ne peut plus voir un disque en retard sur la
    // mémoire : toute écriture appliquée a déjà été persistée dans le tour
    // précédent. Un état plus RÉCENT venu d'un autre onglet, lui, s'impose
    // toujours — c'est le comportement voulu.
    initPromise = enqueue(async () => {
      try {
        const task = taskId ? await loadTask(taskId) : await loadLastTask()
        if (task) {
          await setLastTaskId(task.id)
          setSnapshot({ status: 'ready', task, error: null, boundId: task.id })
        } else if (taskId) {
          // Nommée par l'adresse et introuvable : cas distinct du cahier
          // absent, et le seul où la substitution serait tentante.
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

export async function createAndOpenTask(title: string, next?: string): Promise<TaskState> {
  const task = createTask({ title, next })
  await saveTask(task)
  setSnapshot({ status: 'ready', task, error: null, boundId: task.id })
  return task
}

/** Ouvre un cahier déjà constitué. Sert au cahier de démonstration. */
export async function openPreparedTask(task: TaskState): Promise<TaskState> {
  await saveTask(task)
  setSnapshot({ status: 'ready', task, error: null, boundId: task.id })
  return task
}

/**
 * Supprime le cahier ouvert et rouvre le suivant s'il en reste un.
 *
 * Le protocole de mesure impose de repartir d'une base vide entre deux essais.
 * Sans ce chemin, cela n'était possible qu'en ouvrant les outils de
 * développement — ce que le protocole se reprochait à lui-même.
 *
 * Le lien suit la suppression : l'adresse et le `TASK ID` rendu par
 * `resume_task` changent tous les deux, donc l'agent VOIT qu'il a changé de
 * cahier au lieu de le découvrir dans le contenu.
 */
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

/** Cahier courant, ou `null` si aucun n'est ouvert. */
export function currentTask(): TaskState | null {
  return snapshot.task
}

/**
 * Panne de stockage, le cas échéant.
 *
 * Distinguer « aucun cahier » de « le stockage est cassé » n'est pas un détail :
 * en navigation privée, IndexedDB peut être restreint, et confondre les deux
 * ferait croire à un agent — et à un juge — que le cahier est simplement vide.
 */
export function storageFailure(): string | null {
  return snapshot.status === 'error' ? snapshot.error : null
}

/** L'identifiant lié dont le cahier a disparu, le cas échéant. */
export function missingTaskId(): string | null {
  return snapshot.status === 'missing' ? snapshot.boundId : null
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

  try {
    // La version lue est passée au stockage, qui arbitre : la file d'écriture
    // ne connaît que cet onglet, une autre page a pu écrire entre-temps.
    await saveTask(next, current.version)
  } catch (error) {
    if (error instanceof ConcurrentWriteError) {
      // Se resynchroniser avant de relancer : sans cela, l'écran et l'agent
      // continueraient de raisonner sur un état que le disque a dépassé.
      await resyncFromDisk(current.id)
    }
    throw error
  }

  setSnapshot({ status: 'ready', task: next, error: null, boundId: next.id })
  return next
}

/** Recharge l'état réel après un conflit. Silencieux en cas d'échec : l'erreur
 *  d'origine reste la plus utile à remonter. */
async function resyncFromDisk(id: string): Promise<void> {
  try {
    const fresh = await loadTask(id)
    if (fresh) setSnapshot({ status: 'ready', task: fresh, error: null, boundId: fresh.id })
  } catch {
    /* on garde l'erreur de conflit */
  }
}

/**
 * Applique une mutation pure, persiste, notifie. Toute écriture du produit
 * passe par ici : c'est ce qui garantit qu'aucune ne peut échapper à la
 * persistance, laisser l'écran désynchronisé, ou en écraser une autre.
 */
export async function mutate(fn: (state: TaskState) => TaskState): Promise<TaskState> {
  return enqueue(() => applyLocked(fn))
}

/** Une écriture d'agent, avec de quoi la rejouer à l'identique. */
export type AgentWrite = {
  operation: string
  basedOnVersion: number
  /**
   * Fourni par l'agent. Deux appels qui le partagent PRÉTENDENT être le même
   * appel ; c'est l'empreinte qui décide s'ils le sont.
   */
  mutationId: string
  /** Empreinte de l'intention validée. Voir `domain/intent.ts`. */
  fingerprint: string
  /** Le signal que WebMCP passe à toute exécution d'outil. */
  signal?: AbortSignal
  mutate: (state: TaskState) => TaskState
  /** Rend la réponse. Appelé une seule fois, sur l'état appliqué, et mémorisé. */
  render: (next: TaskState) => string
}

export type AgentWriteOutcome = {
  /** La réponse à rendre. Au rejeu, celle du premier appel, mot pour mot. */
  text: string
  replayed: boolean
  version: number
}

/**
 * Applique une écriture d'agent, une seule fois par `mutation_id`.
 *
 * Trois choses arrivent ici, dans cet ordre, et l'ordre est le fond du sujet :
 *
 * 1. **Le rejeu passe avant le contrôle de version.** Un réessai porte
 *    forcément une version périmée — l'appel d'origine l'a fait avancer.
 *    Contrôler d'abord rendrait STALE STATE à un agent qui ne demande rien de
 *    plus que la réponse qu'il n'a pas reçue, et l'idempotence ne servirait
 *    jamais.
 * 2. **L'annulation est constatée une fois la file obtenue**, pas à l'entrée :
 *    un appel annulé pendant qu'il attendait son tour ne doit pas écrire.
 * 3. **La trace est écrite dans la même transaction que la mutation.** Séparées,
 *    une panne entre les deux laisserait une écriture appliquée sans mémoire
 *    d'elle-même — et le réessai la referait.
 *
 * Un refus pour état périmé est journalisé puis relancé : le tableau de bord
 * doit pouvoir l'afficher, et l'agent doit recevoir l'instruction de rappeler
 * `resume_task`.
 */
export async function mutateAsAgent(
  write: AgentWrite,
  actor: Actor = 'agent',
): Promise<AgentWriteOutcome> {
  // Un seul passage dans la file pour la mutation ET la journalisation du
  // refus : deux passages laisseraient une autre écriture s'intercaler entre
  // l'échec et sa trace.
  return enqueue(async () => {
    const ouvert = snapshot.task
    if (!ouvert) {
      throw new Error('NO ACTIVE TASK\nNo watch log is open on this device.')
    }

    let rendu = ''
    try {
      // TOUS les refus vivent DANS le try, et c'est le fond du sujet.
      //
      // L'annulation et les collisions de `mutation_id` étaient contrôlées
      // au-dessus, si bien que ces refus-là ne laissaient aucune trace : ni au
      // journal d'audit, ni à l'écran qui le lit. L'agent recevait un message,
      // l'humain ne voyait rien.
      //
      // Ce sont pourtant les deux refus qu'il faut le plus voir passer. Une
      // annulation, l'agent lui-même ne saura pas forcément qu'elle a eu lieu.
      // Une collision, elle, dit à un agent que son travail n'a PAS été
      // consigné : si personne ne peut le constater après coup, il ne reste
      // aucune trace du travail perdu.
      if (write.signal?.aborted) throw new CancelledError(write.operation)

      const déjàFaite = findMutation(ouvert, write.mutationId)
      if (déjàFaite) {
        if (déjàFaite.operation !== write.operation) {
          // Le même jeton pour deux outils différents : rendre la première
          // réponse serait accuser réception d'un travail jamais fait.
          throw new ValidationError(
            'mutation_id',
            `was already used for ${déjàFaite.operation}; a mutation_id identifies one write and cannot be reused. ` +
              'Use a fresh one.',
            { code: 'mutation-id-reused', retryable: false },
          )
        }
        if (déjàFaite.fingerprint !== write.fingerprint) {
          // Même outil, mais pas le même travail. C'est le cas dangereux : sans
          // empreinte, il se lisait comme un rejeu et le second travail
          // repartait avec la réponse du premier, jamais écrit et pourtant
          // accusé réception. Un agent qui croit son travail consigné ne le
          // reconsigne pas.
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

      // La version rendue vient de l'état APPLIQUÉ, pas d'une relecture du
      // magasin : lire l'instantané après coup marcherait tant que rien ne
      // s'intercale, ce qui est précisément l'hypothèse que la file existe
      // pour ne pas avoir à faire.
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
        // « INVALID INPUT » ne dit rien à qui relit le journal. Le code d'un
        // refus de validation, lui, est court, stable, et nomme exactement la
        // règle qui a joué — c'est ce qui rend une collision de `mutation_id`
        // reconnaissable dans un export, des semaines plus tard.
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
        // Le refus n'incrémente pas la version : la comparaison porte donc
        // sur celle de l'état courant, resynchronisé le cas échéant.
        await saveTask(refused, current.version)
        setSnapshot({ status: 'ready', task: refused, error: null, boundId: refused.id })
      }
      throw error
    }
  })
}

/**
 * Consigne un refus qui n'a jamais atteint la mutation — entrée malformée,
 * version illisible. Sans cela, ces refus échapperaient au journal alors que
 * tous les autres y figurent, et la traçabilité aurait un trou.
 */
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

/** Remet le magasin à son état initial. Réservé aux tests. */
export function __resetStore(): void {
  listeners.clear()
  writeQueue = Promise.resolve()
  snapshot = { status: 'loading', task: null, error: null, boundId: null }
  initPromise = null
}
