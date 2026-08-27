import {
  CancelledError,
  ConcurrentWriteError,
  StaleStateError,
  ValidationError,
} from '../domain/errors'
import {
  addConstraint,
  addDecision,
  completeTask,
  logStep,
  rejectApproach,
  requireVersion,
} from '../domain/task'
import { parseDetailQuery, renderDetail } from '../domain/detail'
import { fingerprintIntent } from '../domain/intent'
import { renderMissingTask, renderNoTask, renderTaskState } from '../domain/render'
import type { TaskState } from '../domain/types'
import * as store from '../store/taskStore'
import { failure, text, type ModelContextTool, type ToolResult } from './adapter'
import { recordCall } from './witness'
import { taskUrl } from './location'
import {
  ADD_CONSTRAINT_SCHEMA,
  ADD_DECISION_SCHEMA,
  COMPLETE_TASK_SCHEMA,
  LOG_STEP_SCHEMA,
  READ_DETAIL_SCHEMA,
  REJECT_APPROACH_SCHEMA,
  RESUME_TASK_SCHEMA,
} from './schemas'
import {
  ADD_CONSTRAINT_DESCRIPTION,
  ADD_DECISION_DESCRIPTION,
  COMPLETE_TASK_DESCRIPTION,
  LOG_STEP_DESCRIPTION,
  READ_DETAIL_DESCRIPTION,
  REJECT_APPROACH_DESCRIPTION,
  RESUME_TASK_DESCRIPTION,
} from './descriptions'

/**
 * Les outils.
 *
 * Deux en lecture, cinq en écriture. Le compte n'est pas un objectif : chaque
 * outil dilue la lisibilité de l'ensemble pour l'agent, donc chacun doit se
 * payer. `read_task_detail` se paie parce que `resume_task` COUPE — il tient
 * sous 400 tokens en réduisant une preuve à un degré et une tâche entière à
 * cinq lignes. Sans lui, ce qui est coupé n'existe que dans un export
 * Markdown, c'est-à-dire nulle part pour un agent.
 *
 * Le jeu enregistré dépend de l'état du cahier AU CHARGEMENT, et le retrait en
 * cours de vie dépend du navigateur : voir `register.ts` et `lifecycle.ts`.
 * Quel que soit le mode, un outil d'écriture qui reste posé sans pouvoir
 * aboutir refuse en disant pourquoi — c'est ce qui rend le mode sûr
 * supportable.
 */

/**
 * Convertit une erreur de domaine en réponse lisible par l'agent.
 *
 * Un refus n'est pas une panne : c'est une instruction, et elle doit se lire
 * comme telle. On renvoie donc un résultat marqué en erreur plutôt que de lever
 * — l'agent doit voir le texte, pas une trace de pile.
 */
function toToolError(error: unknown, retryVersion?: number): ToolResult {
  if (
    error instanceof StaleStateError ||
    error instanceof ConcurrentWriteError ||
    error instanceof CancelledError
  ) {
    // Ces messages sont déjà écrits pour être lus par un agent : ils portent
    // l'instruction à suivre. Les préfixer d'un ERROR les affaiblirait.
    return failure(error.message)
  }

  if (error instanceof ValidationError) {
    // Rien n'a bougé : autant le dire et rendre la version, sinon l'agent
    // dépense un aller-retour de resume_task pour réapprendre ce qu'il sait.
    // Mais seulement si un réessai peut aboutir : le suggérer sur un cahier
    // clos inviterait à une boucle infinie.
    const utile = error.retryable && retryVersion !== undefined
    return failure(
      utile
        ? `${error.message}\nNothing was written. Retry with based_on_version: ${retryVersion}`
        : error.message,
    )
  }

  if (error instanceof Error) return failure(`ERROR\n${error.message}`)
  return failure(`ERROR\n${String(error)}`)
}

/**
 * Panne de stockage : à ne jamais confondre avec un cahier vide. L'agent doit
 * savoir que ce qu'il lit n'est pas fiable, plutôt que de conclure qu'il n'y a
 * rien à reprendre.
 */
function storageError(detail: string): Error {
  return new Error(
    [
      'STORAGE UNAVAILABLE',
      'This page could not read its own task state, so it cannot tell you',
      'what the current task is. Do NOT assume there is no task.',
      `Cause: ${detail}`,
      'Tell the human: browser storage is blocked or unavailable here',
      '(private browsing and blocked site data are the usual causes).',
    ].join('\n'),
  )
}

/**
 * Charge l'état et exige qu'un cahier soit réellement ouvert.
 *
 * Le cas `missing` — la page est liée à un cahier qui n'existe plus — est
 * distingué du cas « aucun cahier ». Rendre un autre cahier à sa place serait
 * la pire réponse possible : l'agent reprendrait le travail d'une autre tâche
 * sans qu'aucune ligne ne l'indique.
 */
async function requireTask(): Promise<TaskState> {
  await store.init()
  const panne = store.storageFailure()
  if (panne) throw storageError(panne)

  const manquante = store.missingTaskId()
  if (manquante) throw new Error(renderMissingTask(manquante))

  const task = store.currentTask()
  if (!task) {
    throw new Error(
      'NO ACTIVE TASK\nNo watch log is open on this device. Ask the human to start a task in the dashboard.',
    )
  }
  return task
}

/** La réponse d'une écriture appliquée. Mémorisée telle quelle pour le rejeu. */
function okText(operation: string, version: number): string {
  return [
    `OK — ${operation} recorded.`,
    `VERSION     ${version}`,
    'Use this version for your next write.',
  ].join('\n')
}

/**
 * Exige un `mutation_id` utilisable.
 *
 * Le motif est celui du schéma. Le revalider ici n'est pas une redondance :
 * rien n'oblige un client MCP à valider le schéma avant d'appeler, et un jeton
 * vide ou fantaisiste ferait échouer l'idempotence en silence — c'est-à-dire
 * exactement le doublon qu'elle existe pour empêcher.
 */
function requireMutationId(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ValidationError('mutation_id', 'expected a string.', { code: 'not-a-string' })
  }
  const trimmed = value.trim()
  if (!/^[A-Za-z0-9_.:-]{8,64}$/.test(trimmed)) {
    throw new ValidationError(
      'mutation_id',
      'expected 8 to 64 characters, using letters, digits, and any of _ . : - (a UUID works).',
      { code: 'bad-mutation-id' },
    )
  }
  return trimmed
}

/**
 * Les arguments qui constituent l'intention, par opposition au protocole.
 *
 * La liste est LUE DANS LE SCHÉMA de l'outil, moins `based_on_version` et
 * `mutation_id`. Recopier les noms à la main aurait créé une seconde
 * déclaration à tenir d'accord avec la première : un champ ajouté au schéma et
 * oublié ici serait sorti de l'empreinte en silence, et deux appels qui n'en
 * diffèrent que par lui se seraient de nouveau confondus.
 */
function intentionDe(
  tool: ModelContextTool,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const propriétés = (tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {}
  const intention: Record<string, unknown> = {}
  for (const clé of Object.keys(propriétés)) {
    if (clé === 'based_on_version' || clé === 'mutation_id') continue
    if (clé in input) intention[clé] = input[clé]
  }
  return intention
}

/**
 * Exécute une écriture d'agent de bout en bout : annulation, version
 * revendiquée, idempotence, mutation, persistance, journalisation du refus.
 */
async function runWrite(
  tool: ModelContextTool,
  input: Record<string, unknown>,
  signal: AbortSignal | undefined,
  mutate: (state: TaskState, basedOnVersion: number) => TaskState,
): Promise<ToolResult> {
  const operation = tool.name
  let atteintLeMagasin = false
  try {
    // Constatée avant tout travail : inutile de lire le stockage pour un appel
    // dont personne n'attend plus la réponse.
    if (signal?.aborted) throw new CancelledError(operation)

    await requireTask()
    const basedOnVersion = requireVersion('based_on_version', input.based_on_version)
    const mutationId = requireMutationId(input.mutation_id)
    atteintLeMagasin = true

    const outcome = await store.mutateAsAgent({
      operation,
      basedOnVersion,
      mutationId,
      fingerprint: fingerprintIntent(operation, intentionDe(tool, input)),
      signal,
      mutate: (state) => mutate(state, basedOnVersion),
      render: (next) => okText(operation, next.version),
    })

    recordCall(operation, false)
    return text(
      outcome.replayed
        ? // Le dire plutôt que de le taire : un agent qui reçoit deux fois la
          // même réponse doit pouvoir distinguer « c'était déjà fait » de
          // « ça vient d'être fait une seconde fois ».
          `${outcome.text}\n\n(Replay of an earlier call with this mutation_id. Nothing was written twice.)`
        : outcome.text,
    )
  } catch (error) {
    recordCall(operation, true)

    // Un refus survenu avant le magasin n'y a laissé aucune trace : on la pose
    // ici. Après le magasin, elle existe déjà — la reposer ferait un doublon.
    if (!atteintLeMagasin && store.currentTask()) {
      const detail =
        error instanceof Error ? (error.message.split('\n')[1] ?? error.message) : String(error)
      await store.recordAgentRefusal(operation, null, detail)
    }

    return toToolError(error, store.currentTask()?.version)
  }
}

/* -------------------------------------------------------------------------- */
/* Lecture                                                                     */
/* -------------------------------------------------------------------------- */

export const resumeTaskTool: ModelContextTool = {
  name: 'resume_task',
  title: 'Resume task',
  description: RESUME_TASK_DESCRIPTION,
  inputSchema: RESUME_TASK_SCHEMA,
  // `untrustedContentHint` : ce que rend cet outil a été écrit par un agent
  // précédent, dans des champs de texte libre, et revient dans le contexte d'un
  // autre agent. C'est la définition même d'un contenu non fiable.
  annotations: { readOnlyHint: true, untrustedContentHint: true },
  async execute(_input, options) {
    try {
      if (options?.signal?.aborted) throw new CancelledError('resume_task')

      await store.init()
      const panne = store.storageFailure()
      if (panne) throw storageError(panne)

      // Marqué en erreur, et non rendu comme un état ordinaire : un agent qui
      // lit « TASK NOT FOUND » dans une réponse réussie a toutes les chances
      // de continuer quand même.
      const manquante = store.missingTaskId()
      if (manquante) {
        recordCall('resume_task', true)
        return failure(renderMissingTask(manquante))
      }

      const task = store.currentTask()
      recordCall('resume_task', false)
      return text(task ? renderTaskState(task, { url: taskUrl(task.id) }) : renderNoTask())
    } catch (error) {
      recordCall('resume_task', true)
      return toToolError(error)
    }
  },
}

export const readTaskDetailTool: ModelContextTool = {
  name: 'read_task_detail',
  title: 'Read task detail',
  description: READ_DETAIL_DESCRIPTION,
  inputSchema: READ_DETAIL_SCHEMA,
  annotations: { readOnlyHint: true, untrustedContentHint: true },
  async execute(input, options) {
    try {
      if (options?.signal?.aborted) throw new CancelledError('read_task_detail')

      // La requête est analysée AVANT le stockage : une section inconnue se
      // refuse sans qu'on ait à ouvrir la base.
      const query = parseDetailQuery(input)
      const task = await requireTask()

      recordCall('read_task_detail', false)
      return text(renderDetail(task, query))
    } catch (error) {
      recordCall('read_task_detail', true)
      return toToolError(error)
    }
  },
}

/* -------------------------------------------------------------------------- */
/* Écriture                                                                    */
/* -------------------------------------------------------------------------- */

export const logStepTool: ModelContextTool = {
  name: 'log_step',
  title: 'Log a completed step',
  description: LOG_STEP_DESCRIPTION,
  inputSchema: LOG_STEP_SCHEMA,
  annotations: { readOnlyHint: false },
  async execute(input, options) {
    return runWrite(logStepTool, input, options?.signal, (state, basedOnVersion) =>
      logStep(
        state,
        {
          action: input.action,
          result: input.result,
          evidence: (input.evidence as { kind?: unknown; content?: unknown } | null) ?? null,
          next: input.next,
          basedOnVersion,
        },
        'agent',
      ),
    )
  },
}

export const addConstraintTool: ModelContextTool = {
  name: 'add_constraint',
  title: 'Propose a constraint',
  description: ADD_CONSTRAINT_DESCRIPTION,
  inputSchema: ADD_CONSTRAINT_SCHEMA,
  annotations: { readOnlyHint: false },
  async execute(input, options) {
    return runWrite(addConstraintTool, input, options?.signal, (state, basedOnVersion) =>
      addConstraint(state, { rule: input.rule, basedOnVersion }, 'agent'),
    )
  },
}

export const rejectApproachTool: ModelContextTool = {
  name: 'reject_approach',
  title: 'Propose ruling out an approach',
  description: REJECT_APPROACH_DESCRIPTION,
  inputSchema: REJECT_APPROACH_SCHEMA,
  annotations: { readOnlyHint: false },
  async execute(input, options) {
    return runWrite(rejectApproachTool, input, options?.signal, (state, basedOnVersion) =>
      rejectApproach(
        state,
        { approach: input.approach, reason: input.reason, basedOnVersion },
        'agent',
      ),
    )
  },
}

export const addDecisionTool: ModelContextTool = {
  name: 'add_decision',
  title: 'Record a decision',
  description: ADD_DECISION_DESCRIPTION,
  inputSchema: ADD_DECISION_SCHEMA,
  annotations: { readOnlyHint: false },
  async execute(input, options) {
    return runWrite(addDecisionTool, input, options?.signal, (state, basedOnVersion) =>
      addDecision(
        state,
        { choice: input.choice, rationale: input.rationale, basedOnVersion },
        'agent',
      ),
    )
  },
}

export const completeTaskTool: ModelContextTool = {
  name: 'complete_task',
  title: 'Complete the task',
  description: COMPLETE_TASK_DESCRIPTION,
  inputSchema: COMPLETE_TASK_SCHEMA,
  annotations: { readOnlyHint: false },
  async execute(input, options) {
    return runWrite(completeTaskTool, input, options?.signal, (state, basedOnVersion) =>
      completeTask(state, { summary: input.summary, basedOnVersion }, 'agent'),
    )
  },
}

/** Toujours enregistrés : ils répondent quel que soit l'état du cahier. */
export const READ_TOOLS: readonly ModelContextTool[] = [resumeTaskTool, readTaskDetailTool] as const

/** Enregistrés seulement quand une écriture peut aboutir. */
export const WRITE_TOOLS: readonly ModelContextTool[] = [
  logStepTool,
  addConstraintTool,
  rejectApproachTool,
  addDecisionTool,
  completeTaskTool,
] as const

export const ALL_TOOLS: readonly ModelContextTool[] = [...READ_TOOLS, ...WRITE_TOOLS] as const
