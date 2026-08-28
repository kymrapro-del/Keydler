import {
  CancelledError,
  ConcurrentWriteError,
  StaleStateError,
  ValidationError,
} from '../domain/errors'
import {
  addConstraint,
  addDecision,
  askHuman,
  attachEvidence,
  openQuestions,
  pendingApprovals,
  proposedConstraints,
  proposedRejections,
  requestApproval,
  completeTask,
  logStep,
  rejectApproach,
  requireVersion,
  setNext,
} from '../domain/task'
import { requireText } from '../domain/validate'
import { parseDetailQuery, renderDetail } from '../domain/detail'
import { MAX_MATCHES, renderSearch } from '../domain/searchResult'
import { renderChanges } from '../domain/changes'
import { MIN_QUERY } from '../domain/search'
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
  ASK_HUMAN_SCHEMA,
  ATTACH_EVIDENCE_SCHEMA,
  COMPLETE_TASK_SCHEMA,
  LOG_STEP_SCHEMA,
  READ_DETAIL_SCHEMA,
  REJECT_APPROACH_SCHEMA,
  REQUEST_APPROVAL_SCHEMA,
  RESUME_TASK_SCHEMA,
  SEARCH_TASK_SCHEMA,
  SET_NEXT_ACTION_SCHEMA,
  WHAT_CHANGED_SCHEMA,
} from './schemas'
import {
  ADD_CONSTRAINT_DESCRIPTION,
  ADD_DECISION_DESCRIPTION,
  ASK_HUMAN_DESCRIPTION,
  ATTACH_EVIDENCE_DESCRIPTION,
  COMPLETE_TASK_DESCRIPTION,
  LOG_STEP_DESCRIPTION,
  READ_DETAIL_DESCRIPTION,
  REJECT_APPROACH_DESCRIPTION,
  REQUEST_APPROVAL_DESCRIPTION,
  RESUME_TASK_DESCRIPTION,
  SEARCH_TASK_DESCRIPTION,
  SET_NEXT_ACTION_DESCRIPTION,
  WHAT_CHANGED_DESCRIPTION,
} from './descriptions'

const EMPTY_CREDENTIALS: SecretName[] = []

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

async function credentialNames(taskId: string): Promise<SecretName[]> {
  try {
    return await listSecretNames(taskId)
  } catch {
    return []
  }
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
      'NO ACTIVE TASK\nNo log is open on this device. Ask the human to start a task in the dashboard.',
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

      const credentials = await credentialNames(task.id)
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
      const credentials =
        query.section === 'credentials' ? await credentialNames(task.id) : EMPTY_CREDENTIALS

      recordCall('read_task_detail', false)
      return text(renderDetail(task, query, credentials))
    } catch (error) {
      recordCall('read_task_detail', true)
      return toToolError(error)
    }
  },
}

function requireQuery(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ValidationError('query', 'expected a string.', { code: 'not-a-string' })
  }
  const trimmed = value.trim()
  if (trimmed.length < MIN_QUERY) {
    throw new ValidationError('query', `must be at least ${MIN_QUERY} characters.`, {
      code: 'too-short',
    })
  }
  if (trimmed.length > 200) {
    throw new ValidationError('query', 'must be at most 200 characters.', {
      code: 'too-long',
      max: 200,
    })
  }
  return trimmed
}

function requireLimit(value: unknown): number {
  if (value === undefined || value === null) return MAX_MATCHES
  const parsed = typeof value === 'string' ? Number(value.trim()) : value
  if (
    typeof parsed !== 'number' ||
    !Number.isInteger(parsed) ||
    parsed < 1 ||
    parsed > MAX_MATCHES
  ) {
    throw new ValidationError('limit', `expected an integer between 1 and ${MAX_MATCHES}.`, {
      code: 'out-of-range',
    })
  }
  return parsed
}

export const searchTaskTool: ModelContextTool = {
  name: 'search_task',
  title: 'Search this task',
  description: SEARCH_TASK_DESCRIPTION,
  inputSchema: SEARCH_TASK_SCHEMA,
  annotations: { readOnlyHint: true, untrustedContentHint: true },
  async execute(input, options) {
    try {
      if (options?.signal?.aborted) throw new CancelledError('search_task')

      const query = requireQuery(input.query)
      const limit = requireLimit(input.limit)
      const task = await requireTask()

      recordCall('search_task', false)
      return text(renderSearch(task, query, limit))
    } catch (error) {
      recordCall('search_task', true)
      return toToolError(error)
    }
  },
}

export const whatChangedTool: ModelContextTool = {
  name: 'what_changed',
  title: 'What changed since I read this',
  description: WHAT_CHANGED_DESCRIPTION,
  inputSchema: WHAT_CHANGED_SCHEMA,
  annotations: { readOnlyHint: true, untrustedContentHint: true },
  async execute(input, options) {
    try {
      if (options?.signal?.aborted) throw new CancelledError('what_changed')

      const since = requireVersion('since_version', input.since_version)
      const task = await requireTask()

      recordCall('what_changed', false)
      return text(renderChanges(task, since))
    } catch (error) {
      recordCall('what_changed', true)
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

export const askHumanTool: ModelContextTool = {
  name: 'ask_human',
  title: 'Ask the human a blocking question',
  description: ASK_HUMAN_DESCRIPTION,
  inputSchema: ASK_HUMAN_SCHEMA,
  annotations: { readOnlyHint: false },
  async execute(input, options) {
    return runWrite(askHumanTool, input, options?.signal, (state, basedOnVersion) =>
      askHuman(state, { question: input.question, why: input.why, basedOnVersion }, 'agent'),
    )
  },
}

export const attachEvidenceTool: ModelContextTool = {
  name: 'attach_evidence',
  title: 'Attach evidence to a logged step',
  description: ATTACH_EVIDENCE_DESCRIPTION,
  inputSchema: ATTACH_EVIDENCE_SCHEMA,
  annotations: { readOnlyHint: false },
  async execute(input, options) {
    return runWrite(attachEvidenceTool, input, options?.signal, (state, basedOnVersion) =>
      attachEvidence(
        state,
        {
          stepId: input.step_id,
          evidence: (input.evidence ?? {}) as { kind?: unknown; content?: unknown },
          basedOnVersion,
        },
        'agent',
      ),
    )
  },
}

export const setNextActionTool: ModelContextTool = {
  name: 'set_next_action',
  title: 'Change the next action',
  description: SET_NEXT_ACTION_DESCRIPTION,
  inputSchema: SET_NEXT_ACTION_SCHEMA,
  annotations: { readOnlyHint: false },
  async execute(input, options) {
    return runWrite(setNextActionTool, input, options?.signal, (state, basedOnVersion) =>
      // L'humain peut vider ce champ ; un agent ne le peut pas. Le schéma
      // déclare minLength: 1, et effacer la prochaine action par mégarde
      // priverait la conversation suivante de son point de départ.
      setNext(state, { next: requireText('next', input.next, 400), basedOnVersion }, 'agent'),
    )
  },
}

export const APPROVAL_TIMEOUT = 120_000

let approvalTimeout = APPROVAL_TIMEOUT

export function __setApprovalTimeout(ms: number): void {
  approvalTimeout = ms
}

type Decided = { decision: 'allowed' | 'denied'; action: string }

/**
 * Attendre qu'un humain tranche. C'est le seul endroit du produit où un appel
 * d'outil bloque : sans page ouverte devant quelqu'un, cette attente n'aurait
 * aucun sens — et c'est précisément ce que WebMCP rend possible.
 */
function waitForDecision(
  approvalId: string,
  signal: AbortSignal | undefined,
): Promise<Decided | null> {
  return new Promise((resolve) => {
    let done = false

    const finish = (value: Decided | null) => {
      if (done) return
      done = true
      clearTimeout(timer)
      unsubscribe()
      signal?.removeEventListener('abort', onAbort)
      resolve(value)
    }

    const look = () => {
      const task = store.currentTask()
      const found = task?.approvals.find((a) => a.id === approvalId)
      if (found && found.decision !== null) {
        finish({ decision: found.decision, action: found.action })
      }
    }

    const onAbort = () => finish(null)
    const timer = setTimeout(() => finish(null), approvalTimeout)
    const unsubscribe = store.subscribe(look)
    signal?.addEventListener('abort', onAbort, { once: true })

    if (signal?.aborted) finish(null)
    else look()
  })
}

export const requestApprovalTool: ModelContextTool = {
  name: 'request_approval',
  title: 'Ask the human for permission to act',
  description: REQUEST_APPROVAL_DESCRIPTION,
  inputSchema: REQUEST_APPROVAL_SCHEMA,
  annotations: { readOnlyHint: false },
  async execute(input, options) {
    const written = await runWrite(
      requestApprovalTool,
      input,
      options?.signal,
      (state, basedOnVersion) =>
        requestApproval(state, { action: input.action, why: input.why, basedOnVersion }, 'agent'),
    )
    if (written.isError) return written

    // La PLUS RÉCENTE, jamais la première : deux demandes peuvent porter le même
    // libellé, et rendre la décision d'hier autoriserait une action que personne
    // n'a validée.
    const task = store.currentTask()
    const matching = (task?.approvals ?? []).filter(
      (a) => a.action === String(input.action) && a.why === String(input.why),
    )
    const mine = matching[matching.length - 1]
    if (!mine) return written

    if (mine.decision !== null) {
      return decisionResult(mine.decision, mine.action)
    }

    if (options?.signal?.aborted) return toToolError(new CancelledError('request_approval'))

    const decided = await waitForDecision(mine.id, options?.signal)
    if (decided) return decisionResult(decided.decision, decided.action)

    if (options?.signal?.aborted) return toToolError(new CancelledError('request_approval'))

    const stillWaiting = pendingApprovals(store.currentTask() ?? task!).some(
      (a) => a.id === mine.id,
    )
    return failure(
      [
        'NO ANSWER',
        `Nobody decided within ${Math.round(approvalTimeout / 1000)} seconds:`,
        `  ${mine.action}`,
        '',
        'NO ANSWER IS NOT APPROVAL. Nobody was there — treat this exactly as a',
        'refusal. Do not do it. Say plainly that you asked and got no answer.',
        stillWaiting
          ? 'The request is still on the page; the human will see it when they return.'
          : 'The request has since been decided — call resume_task to read it.',
      ].join('\n'),
    )
  },
}

function decisionResult(decision: 'allowed' | 'denied', action: string): ToolResult {
  if (decision === 'allowed') {
    return text(
      [
        'ALLOWED by the human.',
        `  ${action}`,
        '',
        'They allowed exactly this. Do not widen it, and log what you did with',
        'log_step once it is done.',
      ].join('\n'),
    )
  }
  return failure(
    [
      'DENIED by the human.',
      `  ${action}`,
      '',
      'Do not do it, and do not look for another way to do the same thing.',
      'Say so, and ask what they would like instead.',
    ].join('\n'),
  )
}

function leftUnresolved(state: TaskState): string[] {
  const items: string[] = []
  const questions = openQuestions(state).length
  const approvals = pendingApprovals(state).length
  const proposals = proposedConstraints(state).length + proposedRejections(state).length
  const claimed = state.steps.filter((s) => s.confidence === 'claimed').length
  const disputed = state.steps.filter((s) => s.confidence === 'disputed').length

  const line = (n: number, one: string, many: string) => `  ${n} ${n === 1 ? one : many}`
  if (questions > 0)
    items.push(line(questions, 'question nobody answered', 'questions nobody answered'))
  if (approvals > 0)
    items.push(
      line(
        approvals,
        'request for permission left undecided',
        'requests for permission left undecided',
      ),
    )
  if (proposals > 0)
    items.push(
      line(
        proposals,
        'proposal nobody accepted or declined',
        'proposals nobody accepted or declined',
      ),
    )
  if (claimed > 0)
    items.push(
      line(claimed, 'step still claimed with no evidence', 'steps still claimed with no evidence'),
    )
  if (disputed > 0)
    items.push(line(disputed, 'step the human says is wrong', 'steps the human says are wrong'))

  return items
}

export const completeTaskTool: ModelContextTool = {
  name: 'complete_task',
  title: 'Complete the task',
  description: COMPLETE_TASK_DESCRIPTION,
  inputSchema: COMPLETE_TASK_SCHEMA,
  annotations: { readOnlyHint: false },
  async execute(input, options) {
    const result = await runWrite(
      completeTaskTool,
      input,
      options?.signal,
      (state, basedOnVersion) =>
        completeTask(state, { summary: input.summary, basedOnVersion }, 'agent'),
    )
    if (result.isError) return result

    const closed = store.currentTask()
    const goal = closed?.goal ?? null
    const remaining = leftUnresolved(closed ?? ({ steps: [] } as unknown as TaskState))
    if (remaining.length === 0 && goal === null) return result

    if (goal !== null) {
      return text(
        [
          ...result.content.map((c) => c.text),
          '',
          `DONE WHEN   ${goal}`,
          'Say whether that was reached, in the summary, in as many words.',
          ...(remaining.length === 0
            ? []
            : [
                '',
                'LEFT UNRESOLVED — say this in your hand-over, do not imply it was settled:',
                ...remaining,
              ]),
        ].join('\n'),
      )
    }

    // Clore n'est pas régler. L'agent doit le dire dans sa passation plutôt
    // que de laisser croire que tout a été traité.
    return text(
      [
        ...result.content.map((c) => c.text),
        '',
        'LEFT UNRESOLVED — say this in your hand-over, do not imply it was settled:',
        ...remaining,
      ].join('\n'),
    )
  },
}

export const READ_TOOLS: readonly ModelContextTool[] = [
  resumeTaskTool,
  whatChangedTool,
  readTaskDetailTool,
  searchTaskTool,
] as const

export const WRITE_TOOLS: readonly ModelContextTool[] = [
  logStepTool,
  attachEvidenceTool,
  setNextActionTool,
  addConstraintTool,
  rejectApproachTool,
  addDecisionTool,
  askHumanTool,
  requestApprovalTool,
  completeTaskTool,
] as const

export const ALL_TOOLS: readonly ModelContextTool[] = [...READ_TOOLS, ...WRITE_TOOLS] as const
