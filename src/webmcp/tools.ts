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
import { listSecretNames } from '../persistence/vault'
import type { SecretName } from '../domain/secret'
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

function toToolError(error: unknown, retryVersion?: number): ToolResult {
  if (
    error instanceof StaleStateError ||
    error instanceof ConcurrentWriteError ||
    error instanceof CancelledError
  ) {
    return failure(error.message)
  }

  if (error instanceof ValidationError) {
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

function okText(operation: string, version: number): string {
  return [
    `OK — ${operation} recorded.`,
    `VERSION     ${version}`,
    'Use this version for your next write.',
  ].join('\n')
}

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

async function runWrite(
  tool: ModelContextTool,
  input: Record<string, unknown>,
  signal: AbortSignal | undefined,
  mutate: (state: TaskState, basedOnVersion: number) => TaskState,
): Promise<ToolResult> {
  const operation = tool.name
  let atteintLeMagasin = false
  try {
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
        ? `${outcome.text}\n\n(Replay of an earlier call with this mutation_id. Nothing was written twice.)`
        : outcome.text,
    )
  } catch (error) {
    recordCall(operation, true)

    if (!atteintLeMagasin && store.currentTask()) {
      const detail =
        error instanceof Error ? (error.message.split('\n')[1] ?? error.message) : String(error)
      await store.recordAgentRefusal(operation, null, detail)
    }

    return toToolError(error, store.currentTask()?.version)
  }
}

export const resumeTaskTool: ModelContextTool = {
  name: 'resume_task',
  title: 'Resume task',
  description: RESUME_TASK_DESCRIPTION,
  inputSchema: RESUME_TASK_SCHEMA,
  annotations: { readOnlyHint: true, untrustedContentHint: true },
  async execute(_input, options) {
    try {
      if (options?.signal?.aborted) throw new CancelledError('resume_task')

      await store.init()
      const panne = store.storageFailure()
      if (panne) throw storageError(panne)

      const manquante = store.missingTaskId()
      if (manquante) {
        recordCall('resume_task', true)
        return failure(renderMissingTask(manquante))
      }

      const task = store.currentTask()
      recordCall('resume_task', false)
      if (!task) return text(renderNoTask())

      let credentials: SecretName[] = []
      try {
        credentials = await listSecretNames(task.id)
      } catch {
        credentials = []
      }

      return text(renderTaskState(task, { url: taskUrl(task.id), credentials }))
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

export const READ_TOOLS: readonly ModelContextTool[] = [resumeTaskTool, readTaskDetailTool] as const

export const WRITE_TOOLS: readonly ModelContextTool[] = [
  logStepTool,
  addConstraintTool,
  rejectApproachTool,
  addDecisionTool,
  completeTaskTool,
] as const

export const ALL_TOOLS: readonly ModelContextTool[] = [...READ_TOOLS, ...WRITE_TOOLS] as const
