import { describe, it } from 'vitest'
import { buildCoreTask } from '../src/demo/seed'
import { getDb } from '../src/persistence/db'
import { normalizeTask, toStored } from '../src/persistence/normalize'
import { loadTask, putTask, saveTask } from '../src/persistence/taskRepository'
import * as store from '../src/store/taskStore'
import { __renderNow, mount } from '../src/ui/bench'
import type { Step, TaskState } from '../src/domain/types'

/** Where the time goes inside a path, rather than what the whole path costs. */

function steps(n: number, withEvidence = true): Step[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `s${i}`,
    action: `Ran the migration on shard ${i} and checked the row count matched`,
    result: `Shard ${i} moved, 4211 rows, no drift detected in the checksum`,
    evidence:
      withEvidence && i % 3 === 0
        ? { kind: 'command_output' as const, content: 'ok '.repeat(120), verifiedAt: null }
        : null,
    dispute: null,
    confidence: 'evidence' as const,
    basedOnVersion: i,
    source: 'agent' as const,
    at: 1_700_000_000_000 + i,
  }))
}

function median(times: number[]): number {
  const sorted = [...times].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

async function timed(label: string, fn: () => Promise<unknown>, runs = 9): Promise<void> {
  await fn()
  const times: number[] = []
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now()
    await fn()
    times.push(performance.now() - t0)
  }
  console.log(`  ${label.padEnd(52)} ${median(times).toFixed(2)} ms`)
}

function sync(label: string, fn: () => unknown, runs = 9): void {
  fn()
  const times: number[] = []
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now()
    fn()
    times.push(performance.now() - t0)
  }
  console.log(`  ${label.padEnd(52)} ${median(times).toFixed(2)} ms`)
}

async function wipe(): Promise<void> {
  const db = await getDb()
  const tx = db.transaction(['tasks', 'meta', 'secrets'], 'readwrite')
  await Promise.all([
    tx.objectStore('tasks').clear(),
    tx.objectStore('meta').clear(),
    tx.objectStore('secrets').clear(),
    tx.done,
  ])
}

describe('detail', () => {
  it('where the time goes in a write', async () => {
    for (const n of [500, 4000]) {
      const task: TaskState = { ...buildCoreTask(), id: 'w', steps: steps(n) }
      await wipe()
      await putTask(task)
      const db = await getDb()
      console.log(`\n  --- ${n} steps ---`)

      await timed('full db.get (used by the version check)', () => db.get('tasks', 'w'))
      await timed('full db.put', () => db.put('tasks', toStored(task)))
      await timed('saveTask WITH version check', () => saveTask(task, task.version))
      await timed('saveTask WITHOUT version check', () => saveTask(task))
      await timed('loadTask (get + normalize)', () => loadTask('w'))
      // The clone was inside the measurement: normalizeTask read as 26.34 ms
      // where it costs 1.18, a factor of 22, pointing at the wrong fix. It now
      // happens once, outside the timer.
      const cloned = structuredClone(toStored(task))
      sync('normalizeTask alone', () => normalizeTask(cloned), 5)
      sync('structuredClone alone', () => structuredClone(toStored(task)), 5)
    }
  }, 300_000)

  it('where the time goes in a render', async () => {
    await wipe()
    store.__resetStore()
    await store.init()
    document.body.innerHTML = '<div id="announcements"></div><div id="app"></div>'
    const root = document.querySelector<HTMLElement>('#app')!
    mount(root)
    await store.openPreparedTask({ ...buildCoreTask(), steps: steps(2000) })
    __renderNow()

    const html = root.innerHTML
    console.log(
      `\n  rendered HTML : ${html.length} characters, ${root.querySelectorAll('*').length} nodes`,
    )
    sync('full render() (identical string : skips everything)', () => __renderNow())
    sync('innerHTML = same string (HTML parsing only)', () => {
      root.innerHTML = html
    })
    sync('querySelectorAll over every button', () => root.querySelectorAll('button').length)
  }, 300_000)

  it('a render that actually changes, on a large task', async () => {
    await wipe()
    store.__resetStore()
    await store.init()
    document.body.innerHTML = '<div id="announcements"></div><div id="app"></div>'
    const root = document.querySelector<HTMLElement>('#app')!
    mount(root)
    await store.openPreparedTask({ ...buildCoreTask(), steps: steps(20000) })
    __renderNow()

    const durations: number[] = []
    for (let i = 0; i < 12; i++) {
      await store.mutate((st) => ({ ...st, version: st.version + 1, next: `round ${i}` }))
      const t0 = performance.now()
      __renderNow()
      durations.push(performance.now() - t0)
    }
    console.log(`\n  changing render (the task changes)   : ${median(durations).toFixed(2)} ms`)

    // The case that matters: the task does not move but the screen does, a
    // keystroke in the search box, a list unfolded. Everything depending on the
    // task alone can be reused.
    const field = root.querySelector<HTMLInputElement>('#search')
    const interactiveTimes: number[] = []
    for (let i = 0; i < 12; i++) {
      if (field) {
        field.value = 'shard'.slice(0, (i % 5) + 1)
        field.dispatchEvent(new Event('input', { bubbles: true }))
      }
      const t0 = performance.now()
      __renderNow()
      interactiveTimes.push(performance.now() - t0)
    }
    console.log(
      `  interactive render (the task is unchanged) : ${median(interactiveTimes).toFixed(2)} ms${field ? '' : '  [NO FIELD]'}`,
    )
  }, 300_000)

  it('startup', async () => {
    for (const [count, size] of [
      [1, 200],
      [1, 20000],
      [30, 500],
    ] as const) {
      await wipe()
      for (let i = 0; i < count; i++) {
        await putTask({ ...buildCoreTask(), id: `t${i}`, title: `T${i}`, steps: steps(size) })
      }
      const db = await getDb()
      await db.put('meta', 't0', 'lastTaskId')

      store.__resetStore()
      const t0 = performance.now()
      await store.init()
      const withLastTaskId = performance.now() - t0

      // The fallback path: no lastTaskId left, so a full listTasks().
      await db.delete('meta', 'lastTaskId')
      store.__resetStore()
      const t1 = performance.now()
      await store.init()
      const withoutLastTaskId = performance.now() - t1

      console.log(
        `  ${String(count).padEnd(3)} tasks × ${String(size).padEnd(6)} steps : init ${withLastTaskId.toFixed(1)} ms, without lastTaskId ${withoutLastTaskId.toFixed(1)} ms`,
      )
    }
  }, 300_000)

  it('memory retained by the task list', async () => {
    const megabytes = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`
    await wipe()
    for (let i = 0; i < 20; i++) {
      await putTask({ ...buildCoreTask(), id: `t${i}`, title: `T${i}`, steps: steps(2000) })
    }

    // A worker heap is too noisy to decide anything here, so retention is
    // measured by serialised size: deterministic, and proportional to what the
    // page holds open.
    const fullTasks = JSON.stringify(await store.allTasks()).length
    const cards = JSON.stringify(await store.allTaskCards()).length

    console.log('\n  20 tasks × 2000 steps, retained by the picker :')
    console.log(`    full tasks (before) : ${megabytes(fullTasks)}`)
    console.log(
      `    cards (after)      : ${megabytes(cards)}  (${(fullTasks / cards).toFixed(0)}× less)`,
    )
  }, 300_000)

  it('memory held by one task', async () => {
    const megabytes = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`
    for (const n of [1000, 20000]) {
      global.gc?.()
      const before = process.memoryUsage().heapUsed
      const task: TaskState = { ...buildCoreTask(), steps: steps(n) }
      const json = JSON.stringify(task).length
      global.gc?.()
      const after = process.memoryUsage().heapUsed
      console.log(
        `  ${String(n).padEnd(6)} steps : ${megabytes(after - before)} on the heap, ${megabytes(json)} as JSON`,
      )
      void task
    }
  }, 300_000)
})
