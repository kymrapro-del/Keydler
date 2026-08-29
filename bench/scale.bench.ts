import { describe, it } from 'vitest'
import { buildCoreTask } from '../src/demo/seed'
import { addConstraint, logStep } from '../src/domain/task'
import { needsYou } from '../src/domain/attention'
import { estimateTokens, renderTaskState, TOKEN_BUDGET } from '../src/domain/render'
import { searchTask } from '../src/domain/search'
import { normalizeTask } from '../src/persistence/normalize'
import { listTasks, putTask } from '../src/persistence/taskRepository'
import * as store from '../src/store/taskStore'
import { __renderNow, mount } from '../src/ui/bench'
import type {
  ApprovalRequest,
  Constraint,
  MutationContext,
  OpenQuestion,
  Rejection,
  Step,
  TaskState,
} from '../src/domain/types'
import { getDb } from '../src/persistence/db'

/**
 * The bench that produced the figures in `docs/scale.md`.
 *
 * npm run bench
 *
 * It runs under jsdom and fake-indexeddb, like the test suite, so render times
 * here are pessimistic: the jsdom HTML parser is far slower than a browser's.
 * Carrying over unchanged: HTML sizes, node counts, token counts, and the
 * timings of pure functions, which run on the same V8 here and in Chrome.
 */

const ctx = (n: number): MutationContext => ({
  now: 1_700_000_000_000 + n * 1000,
  newId: () => `id-${n}`,
})

function steps(n: number): Step[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `s${i}`,
    action: `Ran the migration on shard ${i} and checked the row count matched`,
    result: `Shard ${i} moved, 4211 rows, no drift detected in the checksum`,
    evidence:
      i % 3 === 0
        ? { kind: 'command_output' as const, content: 'ok '.repeat(120), verifiedAt: null }
        : null,
    dispute: null,
    confidence: i % 5 === 0 ? ('claimed' as const) : ('evidence' as const),
    basedOnVersion: i,
    source: 'agent' as const,
    at: 1_700_000_000_000 + i,
  }))
}

function rules(n: number): Constraint[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `c${i}`,
    rule: `Never touch shard ${i} without taking a snapshot of the routing table first`,
    source: 'human' as const,
    addedAtVersion: i,
    active: true,
    standing: 'accepted' as const,
  }))
}

function rejections(n: number): Rejection[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `r${i}`,
    approach: `Streaming shard ${i} through the old router`,
    reason: 'Lost rows whenever a retry landed on a moved range',
    source: 'agent' as const,
    addedAtVersion: i,
    standing: 'accepted' as const,
    at: 1_700_000_000_000 + i,
  }))
}

function questions(n: number): OpenQuestion[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `q${i}`,
    question: `Which shard owns tenant ${i}?`,
    why: 'The mapping table disagrees with the router',
    source: 'agent' as const,
    addedAtVersion: i,
    at: 1_700_000_000_000 + i,
    answer: null,
    answeredAt: null,
  }))
}

function approvals(n: number): ApprovalRequest[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `a${i}`,
    action: `Drop the staging table for shard ${i}`,
    why: 'It blocks the migration',
    source: 'agent' as const,
    addedAtVersion: i,
    at: 1_700_000_000_000 + i,
    decision: null,
    decidedAt: null,
  }))
}

function median(times: number[]): number {
  const sorted = [...times].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function bench(label: string, fn: () => unknown, runs = 7): void {
  fn()
  const times: number[] = []
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now()
    fn()
    times.push(performance.now() - t0)
  }
  console.log(`  ${label.padEnd(46)} ${median(times).toFixed(2)} ms`)
}

async function freshPage(task: TaskState): Promise<{ root: HTMLElement; unmount: () => void }> {
  store.__resetStore()
  const db = await getDb()
  const tx = db.transaction(['tasks', 'meta', 'secrets'], 'readwrite')
  await Promise.all([
    tx.objectStore('tasks').clear(),
    tx.objectStore('meta').clear(),
    tx.objectStore('secrets').clear(),
    tx.done,
  ])
  await store.init()
  document.body.innerHTML = '<div id="announcements"></div><div id="app"></div>'
  const root = document.querySelector<HTMLElement>('#app')!
  const unmount = mount(root)
  await store.openPreparedTask(task)
  __renderNow()
  return { root, unmount }
}

describe('scale', () => {
  it('what resume_task returns, against the advertised budget', () => {
    console.log(`\nadvertised budget : ${TOKEN_BUDGET} tokens`)
    for (const n of [0, 10, 100, 1000, 2000]) {
      for (const [label, task] of [
        ['rules', { ...buildCoreTask(), constraints: rules(n) }],
        ['rejected', { ...buildCoreTask(), rejected: rejections(n) }],
      ] as const) {
        const text = renderTaskState(task)
        console.log(
          `  ${label.padEnd(8)} n=${String(n).padEnd(5)} ${String(estimateTokens(text)).padEnd(6)} tokens  ${text.length} characters`,
        )
      }
    }
  })

  it('page size against what the task carries', async () => {
    console.log('')
    for (const [label, field] of [
      ['rules', (n: number) => ({ constraints: rules(n) })],
      ['rejected', (n: number) => ({ rejected: rejections(n) })],
      ['questions', (n: number) => ({ questions: questions(n) })],
      ['approvals', (n: number) => ({ approvals: approvals(n) })],
      ['steps', (n: number) => ({ steps: steps(n) })],
    ] as const) {
      for (const n of [10, 2000]) {
        const { root, unmount } = await freshPage({ ...buildCoreTask(), ...field(n) })
        const t0 = performance.now()
        __renderNow()
        const dt = performance.now() - t0
        console.log(
          `  ${label.padEnd(14)} n=${String(n).padEnd(5)} html=${String(root.innerHTML.length).padEnd(8)} nodes=${String(root.querySelectorAll('*').length).padEnd(6)} ${dt.toFixed(1)} ms`,
        )
        unmount()
      }
    }
  }, 300_000)

  it('pure functions against task size', () => {
    for (const n of [1000, 20000]) {
      const task: TaskState = { ...buildCoreTask(), steps: steps(n) }
      console.log(`\n  --- ${n} steps ---`)
      bench('searchTask (rare word)', () => searchTask(task, 'zzzznotfound'))
      bench('searchTask (frequent word)', () => searchTask(task, 'shard'))
      bench('renderTaskState', () => renderTaskState(task))
      bench('needsYou', () => needsYou(task))
      const cloned = structuredClone(task)
      bench('normalizeTask', () => normalizeTask(cloned), 3)
    }
  }, 300_000)

  it('marginal cost of a write against what is already there', () => {
    console.log('')
    let task: TaskState = buildCoreTask()
    let lot = performance.now()
    for (let i = 1; i <= 4000; i++) {
      task = logStep(
        task,
        {
          action: `Ran the migration on shard ${i}`,
          result: 'moved cleanly',
          evidence: null,
          basedOnVersion: task.version,
        },
        'agent',
        ctx(i),
      )
      if (i % 1000 === 0) {
        console.log(
          `  logStep at ${String(i).padEnd(5)} steps : ${((performance.now() - lot) / 1000).toFixed(3)} ms`,
        )
        lot = performance.now()
      }
    }

    task = buildCoreTask()
    lot = performance.now()
    for (let i = 1; i <= 2000; i++) {
      task = addConstraint(
        task,
        { rule: `Never touch shard ${i} without a snapshot`, basedOnVersion: task.version },
        'human',
        ctx(i),
      )
      if (i % 500 === 0) {
        console.log(
          `  addConstraint at ${String(i).padEnd(5)} rules : ${((performance.now() - lot) / 500).toFixed(3)} ms`,
        )
        lot = performance.now()
      }
    }
  }, 300_000)

  it('real throughput through the write queue and IndexedDB', async () => {
    console.log('')
    for (const startSize of [0, 2000]) {
      await freshPage({ ...buildCoreTask(), steps: steps(startSize) })
      const N = 100
      const t0 = performance.now()
      for (let i = 0; i < N; i++) {
        await store.mutate((s) => ({ ...s, version: s.version + 1, next: `round ${i}` }))
      }
      const perWrite = (performance.now() - t0) / N
      console.log(
        `  starting at ${String(startSize).padEnd(5)} steps : ${perWrite.toFixed(2)} ms per write, ${(1000 / perWrite).toFixed(0)} writes/s`,
      )
    }
  }, 300_000)

  it('reading every task on the device', async () => {
    console.log('')
    for (const [count, size] of [
      [5, 200],
      [20, 200],
      [20, 5000],
      [50, 2000],
    ] as const) {
      store.__resetStore()
      const db = await getDb()
      const tx = db.transaction(['tasks'], 'readwrite')
      await Promise.all([tx.objectStore('tasks').clear(), tx.done])
      for (let i = 0; i < count; i++) {
        await putTask({ ...buildCoreTask(), id: `t${i}`, title: `Task ${i}`, steps: steps(size) })
      }
      const t0 = performance.now()
      const all = await listTasks()
      console.log(
        `  listTasks : ${String(count).padEnd(3)} tasks × ${String(size).padEnd(5)} steps, ${(performance.now() - t0).toFixed(1)} ms (${all.length} read)`,
      )
    }
  }, 300_000)
})
