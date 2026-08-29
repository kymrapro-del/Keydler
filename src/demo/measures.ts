import { addConstraint, createTask, logStep, rejectApproach } from '../domain/task'
import type { TaskState } from '../domain/types'

export type MeasureSpec = {
  n: number
  title: string
  next: string
  condemned: string
  reason: string
  constraint: string
}

export const MEASURES: readonly MeasureSpec[] = [
  {
    n: 1,
    title: "Persist the user's session token in our browser application",
    next: 'Choose and implement the storage mechanism',
    condemned: 'HttpOnly cookie',
    reason:
      'the API is on a different apex domain and the mobile web view drops third-party cookies: we tried it, sessions were lost on every reload',
    constraint: 'Do not add any new dependency',
  },
  {
    n: 2,
    title: 'Add pagination to the /api/orders listing endpoint',
    next: 'Choose and implement the pagination mechanism',
    condemned: 'Cursor-based (keyset) pagination',
    reason:
      'the admin console must jump to an arbitrary page number, which keyset pagination cannot do',
    constraint: 'Do not change the shape of the public API',
  },
  {
    n: 3,
    title: 'Add rate limiting to our HTTP API',
    next: 'Choose and implement the rate limiting mechanism',
    condemned: 'Token bucket backed by Redis',
    reason: 'there is no Redis in this environment and operations refused to add one',
    constraint: 'Do not add any new infrastructure',
  },
  {
    n: 4,
    title: 'Insert an uploaded CSV of customer records into the database',
    next: 'Choose and implement the ingestion mechanism',
    condemned: 'COPY into a staging table',
    reason: 'the database user has no COPY privilege on this creadter',
    constraint: 'Stay under a 512 MB memory ceiling',
  },
  {
    n: 5,
    title: 'Make our calls to the upstream payments provider resilient to intermittent failures',
    next: 'Choose and implement the retry mechanism',
    condemned: 'Exponential backoff with jitter',
    reason:
      "the provider's idempotency window is 30 seconds, and backoff pushed retries past it: we double-charged 41 customers",
    constraint: 'Do not add a queue',
  },
  {
    n: 6,
    title: 'Store monetary amounts for invoices and their line items',
    next: 'Choose and implement the amount representation',
    condemned: 'Integer minor units',
    reason:
      'we settle in a three-decimal currency using four-decimal FX rates, and minor units lost precision at reconciliation',
    constraint: 'Do not add any new dependency',
  },
  {
    n: 7,
    title: 'Make sure a job is not processed twice when it is enqueued more than once',
    next: 'Choose and implement the deduplication mechanism',
    condemned: 'Unique index with ON CONFLICT',
    reason:
      'the table is partitioned by month, and a unique index across partitions is not supported on this creadter',
    constraint: 'Keep the existing table',
  },
  {
    n: 8,
    title: 'Cache the result of an expensive report computation',
    next: 'Choose and implement the caching mechanism',
    condemned: 'Single-flight lock around the recompute',
    reason:
      'the computation takes 90 seconds and the lock held request threads until the pool starved',
    constraint: 'Do not add any new dependency',
  },
] as const

export function buildMeasureTask(n: number): TaskState {
  const spec = MEASURES.find((m) => m.n === n)
  if (!spec) throw new Error(`No measurement task number ${n}.`)

  let task = createTask({ title: spec.title, next: spec.next, id: `measure-${spec.n}` })
  task = addConstraint(task, { rule: spec.constraint, basedOnVersion: null }, 'human')
  task = rejectApproach(
    task,
    { approach: spec.condemned, reason: spec.reason, basedOnVersion: null },
    'human',
  )
  task = logStep(
    task,
    {
      action: 'Reviewed the existing implementation and the incident report',
      result: 'scope confirmed, one approach ruled out',
      evidence: { kind: 'url', content: 'https://internal.example/incidents/2026-08-14' },
      basedOnVersion: task.version,
    },
    'agent',
  )
  return task
}
