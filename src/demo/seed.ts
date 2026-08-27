import {
  addConstraint,
  addDecision,
  createTask,
  logStep,
  rejectApproach,
  setConstraintStanding,
  setRejectionStanding,
  verifyEvidence,
} from '../domain/task'
import type { TaskState } from '../domain/types'

export function buildDemoTask(): TaskState {
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
      choice: 'Approach C — session-bound refresh tokens',
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
      evidence: { kind: 'test_report', content: 'auth suite — 183 passed, 0 failed, 0 skipped' },
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
      next: 'Implement approach C — session-bound refresh tokens',
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
