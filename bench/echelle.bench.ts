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
 * Le banc d'essai qui a produit les chiffres de `docs/echelle-2026-08-28.md`.
 *
 *   npm run bench
 *
 * Il tourne sous jsdom et fake-indexeddb, comme la suite de tests. Les durées
 * de RENDU y sont donc pessimistes — l'analyseur HTML de jsdom est bien plus
 * lent que celui d'un navigateur. Ce qui se transporte tel quel : les tailles
 * de HTML, les nombres de nœuds, les comptes de tokens, et les durées des
 * fonctions pures, qui tournent sur le même V8 ici et dans Chrome.
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
  document.body.innerHTML = '<div id="annonces"></div><div id="app"></div>'
  const root = document.querySelector<HTMLElement>('#app')!
  const unmount = mount(root)
  await store.openPreparedTask(task)
  __renderNow()
  return { root, unmount }
}

describe('échelle', () => {
  it('ce que resume_task rend, face au budget annoncé', () => {
    console.log(`\nbudget annoncé : ${TOKEN_BUDGET} tokens`)
    for (const n of [0, 10, 100, 1000, 2000]) {
      for (const [label, task] of [
        ['règles', { ...buildCoreTask(), constraints: rules(n) }],
        ['écartés', { ...buildCoreTask(), rejected: rejections(n) }],
      ] as const) {
        const text = renderTaskState(task)
        console.log(
          `  ${label.padEnd(8)} n=${String(n).padEnd(5)} ${String(estimateTokens(text)).padEnd(6)} tokens  ${text.length} caractères`,
        )
      }
    }
  })

  it('taille de la page selon ce que le cahier porte', async () => {
    console.log('')
    for (const [label, champ] of [
      ['règles', (n: number) => ({ constraints: rules(n) })],
      ['écartés', (n: number) => ({ rejected: rejections(n) })],
      ['questions', (n: number) => ({ questions: questions(n) })],
      ['autorisations', (n: number) => ({ approvals: approvals(n) })],
      ['étapes', (n: number) => ({ steps: steps(n) })],
    ] as const) {
      for (const n of [10, 2000]) {
        const { root, unmount } = await freshPage({ ...buildCoreTask(), ...champ(n) })
        const t0 = performance.now()
        __renderNow()
        const dt = performance.now() - t0
        console.log(
          `  ${label.padEnd(14)} n=${String(n).padEnd(5)} html=${String(root.innerHTML.length).padEnd(8)} nœuds=${String(root.querySelectorAll('*').length).padEnd(6)} ${dt.toFixed(1)} ms`,
        )
        unmount()
      }
    }
  }, 300_000)

  it('fonctions pures selon la taille du cahier', () => {
    for (const n of [1000, 20000]) {
      const task: TaskState = { ...buildCoreTask(), steps: steps(n) }
      console.log(`\n  --- ${n} étapes ---`)
      bench('searchTask (mot rare)', () => searchTask(task, 'zzzznotfound'))
      bench('searchTask (mot fréquent)', () => searchTask(task, 'shard'))
      bench('renderTaskState', () => renderTaskState(task))
      bench('needsYou', () => needsYou(task))
      const cloné = structuredClone(task)
      bench('normalizeTask', () => normalizeTask(cloné), 3)
    }
  }, 300_000)

  it('coût marginal d’une écriture selon ce qui est déjà posé', () => {
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
          `  logStep à ${String(i).padEnd(5)} étapes : ${((performance.now() - lot) / 1000).toFixed(3)} ms`,
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
          `  addConstraint à ${String(i).padEnd(5)} règles : ${((performance.now() - lot) / 500).toFixed(3)} ms`,
        )
        lot = performance.now()
      }
    }
  }, 300_000)

  it('débit réel à travers la file d’écriture et IndexedDB', async () => {
    console.log('')
    for (const départ of [0, 2000]) {
      await freshPage({ ...buildCoreTask(), steps: steps(départ) })
      const N = 100
      const t0 = performance.now()
      for (let i = 0; i < N; i++) {
        await store.mutate((s) => ({ ...s, version: s.version + 1, next: `tour ${i}` }))
      }
      const parÉcriture = (performance.now() - t0) / N
      console.log(
        `  départ ${String(départ).padEnd(5)} étapes : ${parÉcriture.toFixed(2)} ms par écriture, ${(1000 / parÉcriture).toFixed(0)} écritures/s`,
      )
    }
  }, 300_000)

  it('lecture de tous les cahiers du poste', async () => {
    console.log('')
    for (const [nombre, taille] of [
      [5, 200],
      [20, 200],
      [20, 5000],
      [50, 2000],
    ] as const) {
      store.__resetStore()
      const db = await getDb()
      const tx = db.transaction(['tasks'], 'readwrite')
      await Promise.all([tx.objectStore('tasks').clear(), tx.done])
      for (let i = 0; i < nombre; i++) {
        await putTask({ ...buildCoreTask(), id: `t${i}`, title: `Task ${i}`, steps: steps(taille) })
      }
      const t0 = performance.now()
      const all = await listTasks()
      console.log(
        `  listTasks : ${String(nombre).padEnd(3)} cahiers × ${String(taille).padEnd(5)} étapes → ${(performance.now() - t0).toFixed(1)} ms (${all.length} lus)`,
      )
    }
  }, 300_000)
})
