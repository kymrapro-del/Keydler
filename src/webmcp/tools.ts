import { ConcurrentWriteError, StaleStateError, ValidationError } from '../domain/errors'
import {
  addConstraint,
  addDecision,
  completeTask,
  logStep,
  rejectApproach,
  requireVersion,
} from '../domain/task'
import { renderNoTask, renderTaskState } from '../domain/render'
import type { TaskState } from '../domain/types'
import * as store from '../store/taskStore'
import { failure, text, type ModelContextTool, type ToolResult } from './adapter'
import { recordCall } from './witness'
import {
  ADD_CONSTRAINT_DESCRIPTION,
  ADD_DECISION_DESCRIPTION,
  BASED_ON_VERSION_DESCRIPTION,
  COMPLETE_TASK_DESCRIPTION,
  LOG_STEP_DESCRIPTION,
  REJECT_APPROACH_DESCRIPTION,
  RESUME_TASK_DESCRIPTION,
} from './descriptions'

/**
 * Les six primitives.
 *
 * Six, et pas une de plus : chaque outil supplémentaire dilue la lisibilité de
 * l'ensemble pour l'agent, qui choisit d'autant moins bien qu'il a plus à lire.
 */

const versionProperty = {
  type: 'integer',
  description: BASED_ON_VERSION_DESCRIPTION,
} as const

/**
 * Convertit une erreur de domaine en réponse lisible par l'agent.
 *
 * Un refus n'est pas une panne : c'est une instruction, et elle doit se lire
 * comme telle. On renvoie donc un résultat marqué en erreur plutôt que de lever
 * — l'agent doit voir le texte, pas une trace de pile.
 */
function toToolError(error: unknown, retryVersion?: number): ToolResult {
  if (error instanceof StaleStateError || error instanceof ConcurrentWriteError) {
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

async function requireTask(): Promise<TaskState> {
  await store.init()
  const failure = store.storageFailure()
  if (failure) throw storageError(failure)

  const task = store.currentTask()
  if (!task) {
    throw new Error(
      'NO ACTIVE TASK\nNo watch log is open on this device. Ask the human to start a task in the dashboard.',
    )
  }
  return task
}

/**
 * Exécute une écriture d'agent de bout en bout : version revendiquée, mutation,
 * persistance, journalisation du refus le cas échéant.
 */
async function runWrite(
  operation: string,
  input: Record<string, unknown>,
  mutate: (state: TaskState, basedOnVersion: number) => TaskState,
): Promise<ToolResult> {
  let atteintLeMagasin = false
  try {
    await requireTask()
    const basedOnVersion = requireVersion('based_on_version', input.based_on_version)
    atteintLeMagasin = true
    const next = await store.mutateAsAgent(operation, basedOnVersion, (state) =>
      mutate(state, basedOnVersion),
    )
    recordCall(operation, false)
    return text(
      [
        `OK — ${operation} recorded.`,
        `VERSION     ${next.version}`,
        'Use this version for your next write.',
      ].join('\n'),
    )
  } catch (error) {
    recordCall(operation, true)

    // Un refus survenu avant le magasin n'y a laissé aucune trace : on la pose
    // ici. Après le magasin, elle existe déjà — la reposer ferait un doublon.
    if (!atteintLeMagasin && store.currentTask()) {
      const detail = error instanceof Error ? error.message.split('\n')[1] ?? error.message : String(error)
      await store.recordAgentRefusal(operation, null, detail)
    }

    return toToolError(error, store.currentTask()?.version)
  }
}

export const resumeTaskTool: ModelContextTool = {
  name: 'resume_task',
  title: 'Resume task',
  description: RESUME_TASK_DESCRIPTION,
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true, openWorldHint: false, untrustedContentHint: true },
  async execute() {
    try {
      await store.init()
      const failure = store.storageFailure()
      if (failure) throw storageError(failure)

      const task = store.currentTask()
      recordCall('resume_task', false)
      return text(task ? renderTaskState(task) : renderNoTask())
    } catch (error) {
      recordCall('resume_task', true)
      return toToolError(error)
    }
  },
}

export const logStepTool: ModelContextTool = {
  name: 'log_step',
  title: 'Log a completed step',
  description: LOG_STEP_DESCRIPTION,
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', description: 'What was done, in one line.' },
      result: { type: 'string', description: 'What came of it, in one line.' },
      evidence: {
        type: 'object',
        description:
          'Proof of the result. Omit only when you genuinely have none — the step is then recorded as claimed.',
        properties: {
          kind: { type: 'string', enum: ['command_output', 'diff', 'url', 'hash', 'test_report'] },
          content: { type: 'string', description: 'The evidence itself, verbatim.' },
        },
        required: ['kind', 'content'],
      },
      next: {
        type: 'string',
        description: 'The next action, in one sentence. Set it whenever it changes.',
      },
      based_on_version: versionProperty,
    },
    required: ['action', 'result', 'based_on_version'],
  },
  annotations: { readOnlyHint: false, idempotentHint: false },
  async execute(input) {
    return runWrite('log_step', input, (state, basedOnVersion) =>
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
  title: 'Record a constraint',
  description: ADD_CONSTRAINT_DESCRIPTION,
  inputSchema: {
    type: 'object',
    properties: {
      rule: {
        type: 'string',
        description: 'The rule, stated so it can be checked against later work.',
      },
      based_on_version: versionProperty,
    },
    required: ['rule', 'based_on_version'],
  },
  annotations: { readOnlyHint: false },
  async execute(input) {
    return runWrite('add_constraint', input, (state, basedOnVersion) =>
      addConstraint(state, { rule: input.rule, basedOnVersion }, 'agent'),
    )
  },
}

export const rejectApproachTool: ModelContextTool = {
  name: 'reject_approach',
  title: 'Rule out an approach',
  description: REJECT_APPROACH_DESCRIPTION,
  inputSchema: {
    type: 'object',
    properties: {
      approach: { type: 'string', description: 'The approach that must not be retried.' },
      reason: { type: 'string', description: 'Why it failed. Mandatory.' },
      based_on_version: versionProperty,
    },
    required: ['approach', 'reason', 'based_on_version'],
  },
  annotations: { readOnlyHint: false },
  async execute(input) {
    return runWrite('reject_approach', input, (state, basedOnVersion) =>
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
  inputSchema: {
    type: 'object',
    properties: {
      choice: { type: 'string', description: 'What was chosen.' },
      rationale: { type: 'string', description: 'Why, including what it was chosen over.' },
      based_on_version: versionProperty,
    },
    required: ['choice', 'rationale', 'based_on_version'],
  },
  annotations: { readOnlyHint: false },
  async execute(input) {
    return runWrite('add_decision', input, (state, basedOnVersion) =>
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
  inputSchema: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description: 'Final hand-over summary, written for someone who was not present.',
      },
      based_on_version: versionProperty,
    },
    required: ['summary', 'based_on_version'],
  },
  annotations: { readOnlyHint: false, destructiveHint: false },
  async execute(input) {
    return runWrite('complete_task', input, (state, basedOnVersion) =>
      completeTask(state, { summary: input.summary, basedOnVersion }, 'agent'),
    )
  },
}

/** L'ordre compte : `resume_task` en tête, c'est celui qu'on veut voir appelé. */
export const ALL_TOOLS: readonly ModelContextTool[] = [
  resumeTaskTool,
  logStepTool,
  addConstraintTool,
  rejectApproachTool,
  addDecisionTool,
  completeTaskTool,
] as const
