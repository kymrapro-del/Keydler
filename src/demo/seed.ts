import {
  addConstraint,
  addDecision,
  answerQuestion,
  askHuman,
  createTask,
  decideApproval,
  disputeStep,
  logStep,
  openQuestions,
  pendingApprovals,
  rejectApproach,
  requestApproval,
  setConstraintStanding,
  setRejectionStanding,
  verifyEvidence,
} from '../domain/task'
import type { TaskState } from '../domain/types'

/**
 * Le socle : règles, rejets, décisions, travail avec preuves. Sans question,
 * ni autorisation, ni contestation. C'est sur lui que s'appuient les cas qui
 * ont besoin d'une page blanche pour ces trois-là.
 */
export function buildCoreTask(): TaskState {
  let task = createTask({
    title: 'Refactor the authentication module',
    next: 'Map the existing entry points',
  })

  task = addConstraint(
    task,
    { rule: 'Never modify the database schema', basedOnVersion: null },
    'human',
  )
  task = addConstraint(
    task,
    { rule: 'Do not add any new dependency', basedOnVersion: null },
    'human',
  )

  task = addConstraint(
    task,
    { rule: 'Keep the public API unchanged', basedOnVersion: task.version },
    'agent',
  )
  task = setConstraintStanding(task, task.constraints[task.constraints.length - 1].id, 'accepted')

  task = rejectApproach(
    task,
    {
      approach: 'JWT approach B',
      reason: 'breaks refresh token rotation under concurrent logins',
      basedOnVersion: null,
    },
    'human',
  )

  task = rejectApproach(
    task,
    {
      approach: 'Partial index on sessions',
      reason: 'benchmarked 3x slower than the full index',
      basedOnVersion: task.version,
    },
    'agent',
  )
  task = setRejectionStanding(task, task.rejected[task.rejected.length - 1].id, 'accepted')

  task = rejectApproach(
    task,
    {
      approach: 'Rotating refresh tokens on every request',
      reason: 'assumed to conflict with the mobile client, not measured',
      basedOnVersion: task.version,
    },
    'agent',
  )

  task = addDecision(
    task,
    {
      choice: 'Approach C, session-bound refresh tokens',
      rationale: 'keeps rotation intact without touching the schema, unlike approach B',
      basedOnVersion: task.version,
    },
    'agent',
  )

  task = logStep(
    task,
    {
      action: 'Ran the authentication test suite',
      result: '183 passed, 0 failed',
      evidence: { kind: 'test_report', content: 'auth suite: 183 passed, 0 failed, 0 skipped' },
      basedOnVersion: task.version,
    },
    'agent',
  )

  const relue = task.steps[task.steps.length - 1]
  task = verifyEvidence(task, relue.id, relue.evidence!.content)

  task = logStep(
    task,
    {
      action: 'Benchmarked the session-bound refresh prototype',
      result: 'p95 latency unchanged, no schema change required',
      evidence: {
        kind: 'command_output',
        content: 'bench --auth-refresh\np50 12ms  p95 41ms  (baseline p95 43ms)',
      },
      next: 'Implement approach C, session-bound refresh tokens',
      basedOnVersion: task.version,
    },
    'agent',
  )

  task = logStep(
    task,
    {
      action: 'Extracted the token issuer behind an interface',
      result: 'public API unchanged, 2 files touched',
      evidence: {
        kind: 'diff',
        content: [
          '--- a/auth/issuer.ts',
          '+++ b/auth/issuer.ts',
          '@@',
          ' export function issue(userId) {',
          '-  return sign({ sub: userId })',
          '+  return getIssuer().issue(userId)',
          ' }',
          '--- a/auth/issuerFactory.ts',
          '+++ b/auth/issuerFactory.ts',
          '@@',
          '+export function getIssuer() {',
          '+  return { issue: (userId) => sign({ sub: userId }) }',
          '+}',
        ].join('\n'),
      },
      basedOnVersion: task.version,
    },
    'agent',
  )

  task = logStep(
    task,
    {
      action: 'Reduced token TTL to 15 minutes',
      result: 'applied in the prototype, not yet measured',
      basedOnVersion: task.version,
    },
    'agent',
  )

  return task
}

/**
 * La démonstration livrée au bouton « Try the demo » : le socle, plus une
 * question répondue, une autorisation refusée et une étape contestée. Sans
 * cela, un juré verrait un produit d'il y a trois lots.
 */
export function buildDemoTask(): TaskState {
  let task = buildCoreTask()

  task = askHuman(
    task,
    {
      question: 'Should mobile sessions expire on the same 15-minute window as web?',
      why: 'It is a product call, not a technical one, and it changes the rollout.',
      basedOnVersion: task.version,
    },
    'agent',
  )
  task = answerQuestion(
    task,
    openQuestions(task)[0].id,
    'No. Mobile keeps 24 hours. Only web moves to 15 minutes.',
  )

  task = requestApproval(
    task,
    {
      action: 'Drop the legacy sessions table from staging',
      why: 'It is not reversible and nothing here has a backup of it.',
      basedOnVersion: task.version,
    },
    'agent',
  )
  task = decideApproval(task, pendingApprovals(task)[0].id, 'denied')

  const douteuse = task.steps.find((s) => s.action.startsWith('Benchmarked'))!
  task = disputeStep(
    task,
    douteuse.id,
    'That run came from the other branch: the issuer had not been extracted yet.',
  )

  // Le cahier se termine sur une écriture d'AGENT : à l'ouverture, « Undo that »
  // ne doit pas proposer de révoquer une décision que personne ne vient de
  // prendre. Et l'agent répondant à la contestation, la démonstration montre
  // la boucle entière.
  task = logStep(
    task,
    {
      action: 'Re-ran the benchmark on the extracted issuer',
      result: 'p95 39ms, still under the 43ms baseline',
      next: 'Implement approach C, session-bound refresh tokens',
      basedOnVersion: task.version,
    },
    'agent',
  )

  return task
}
