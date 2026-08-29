import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildCoreTask } from '../src/demo/seed'
import { logStep } from '../src/domain/task'
import * as store from '../src/store/taskStore'
import { __renderNow, mount } from '../src/ui/bench'
import type {
  ApprovalRequest,
  Constraint,
  OpenQuestion,
  Rejection,
  Step,
  TaskState,
} from '../src/domain/types'
import { clearDatabase, waitUntil } from './helpers'

let root: HTMLElement
let unmount: () => void

const text = () => root.textContent?.replace(/\s+/g, ' ') ?? ''

function card(labelledBy: string): HTMLElement {
  const found = root.querySelector<HTMLElement>(`[aria-labelledby="${labelledBy}"]`)
  if (!found) throw new Error(`card “${labelledBy}” is missing`)
  return found
}

const cardText = (labelledBy: string) => card(labelledBy).textContent?.replace(/\s+/g, ' ') ?? ''

function button(label: string): HTMLButtonElement {
  const found = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === label,
  )
  if (!found) throw new Error(`button “${label}” is missing`)
  return found
}

function rules(n: number, active = true): Constraint[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `c${i}`,
    rule: `Never touch shard ${i} without a snapshot`,
    source: 'human',
    addedAtVersion: i,
    active,
    standing: 'accepted',
  }))
}

function rejections(n: number): Rejection[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `r${i}`,
    approach: `Streaming shard ${i}`,
    reason: 'Lost rows under retry',
    source: 'agent',
    addedAtVersion: i,
    standing: 'accepted',
    at: 1_700_000_000_000 + i,
  }))
}

function questions(n: number): OpenQuestion[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `q${i}`,
    question: `Which shard owns tenant ${i}?`,
    why: 'The mapping table disagrees with the router',
    source: 'agent',
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
    source: 'agent',
    addedAtVersion: i,
    at: 1_700_000_000_000 + i,
    decision: null,
    decidedAt: null,
  }))
}

function steps(n: number): Step[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `s${i}`,
    action: `Ran the migration on shard ${i}`,
    result: `Shard ${i} moved cleanly`,
    evidence: null,
    dispute: null,
    confidence: 'evidence',
    basedOnVersion: i,
    source: 'agent',
    at: 1_700_000_000_000 + i,
  }))
}

async function open(task: Partial<TaskState>): Promise<void> {
  await store.openPreparedTask({ ...buildCoreTask(), constraints: [], ...task })
  __renderNow()
}

beforeEach(async () => {
  store.__resetStore()
  await clearDatabase()
  await store.init()
  history.replaceState(null, '', '/')
  document.body.innerHTML = '<div id="announcements"></div><div id="app"></div>'
  root = document.querySelector<HTMLElement>('#app')!
  unmount = mount(root)
})

afterEach(() => {
  unmount()
  history.replaceState(null, '', '/')
})

// Measured before these caps: 2000 rules took a render round trip from 17 ms to
// 501 ms, for 1.2 MB of HTML and 10,000 nodes, and the page repaints on every
// keystroke in the search field.
describe('the page does not grow with the data', () => {
  it('keeps the same order of magnitude with a hundred times more of everything', async () => {
    await open({
      constraints: rules(500),
      rejected: rejections(500),
      questions: questions(500),
      approvals: approvals(500),
      steps: steps(500),
    })

    const nodes = root.querySelectorAll('*').length
    const size = root.innerHTML.length

    expect(nodes).toBeLessThan(1200)
    expect(size).toBeLessThan(300_000)
  })

  it('bounds each list separately, so that none slips through the net', async () => {
    // A single unbounded list would be enough to bring the page down; the test
    // therefore takes them one at a time, with no other list masking it.
    for (const [name, field] of [
      ['rules', { constraints: rules(400) }],
      ['rejected approaches', { rejected: rejections(400) }],
      ['questions', { questions: questions(400) }],
      ['approvals', { approvals: approvals(400) }],
      ['steps', { steps: steps(400) }],
    ] as const) {
      await open(field)
      expect(root.querySelectorAll('li').length, name).toBeLessThan(60)
    }
  })
})

describe('what is hidden is said, and stays reachable', () => {
  it('announces how many rules there are and unfolds them all', async () => {
    await open({ constraints: rules(40) })

    expect(card('rules-title').querySelectorAll('.rows li').length).toBe(12)
    button('Show all 40 rules').click()
    __renderNow()

    expect(card('rules-title').querySelectorAll('.rows li').length).toBe(40)
    expect(cardText('rules-title')).toContain('Show fewer')
  })

  it('warns when what is out of sight STILL BINDS', async () => {
    await open({ constraints: rules(40) })
    expect(cardText('rules-title')).toContain('28 rules still in force are not shown')

    button('Show all 40 rules').click()
    __renderNow()
    // Once everything is on screen nothing is hidden: the warning goes away.
    expect(text()).not.toContain('still in force are not shown')
  })

  it('does not cry wolf over rules that were merely lifted', async () => {
    await open({
      constraints: [...rules(6), ...rules(40, false).map((c) => ({ ...c, id: `x${c.id}` }))],
    })

    expect(cardText('rules-title')).toContain('Show all 46 rules')
    expect(cardText('rules-title')).not.toContain('still in force are not shown')
  })

  it('offers no button when everything already fits on screen', async () => {
    await open({ constraints: rules(5) })
    expect(cardText('rules-title')).not.toContain('Show all')
    expect(cardText('rules-title')).not.toContain('Show fewer')
  })

  it('unfolds the rejected approaches, the questions and the permission requests too', async () => {
    await open({
      rejected: rejections(30),
      questions: questions(30),
      approvals: approvals(30),
    })

    expect(text()).toContain('Show all 30 entries')
    expect(text()).toContain('Show all 30 questions')
    expect(text()).toContain('Show all 30 requests')
  })
})

/**
 * The render is woken by the store, by tool calls and by writes; many of those
 * wakeups change nothing. Measured on the interface suite: 30% of the renders
 * produced identical HTML.
 */
describe('does not repaint what has not changed', () => {
  it('keeps the same nodes when nothing moves', async () => {
    await open({ constraints: rules(3) })
    const beforeState = card('rules-title')

    __renderNow()
    __renderNow()

    // The same DOM object, not just the same text: that is the proof that
    // nothing was rebuilt.
    expect(card('rules-title')).toBe(beforeState)
  })

  it('repaints as soon as the state really changes', async () => {
    await open({ constraints: rules(3) })
    const beforeState = card('rules-title')

    await store.mutate((s) => ({ ...s, version: s.version + 1, constraints: rules(4) }))
    __renderNow()

    expect(card('rules-title')).not.toBe(beforeState)
    expect(cardText('rules-title')).toContain('shard 3')
  })

  it('paints a fresh root, even when the state stayed the same', async () => {
    // The trap: remembering the HTML already painted without noticing the root
    // itself was replaced, leaving a blank page.
    await open({ constraints: rules(3) })
    const expected = root.innerHTML
    expect(expected).not.toBe('')

    unmount()
    document.body.innerHTML = '<div id="announcements"></div><div id="app"></div>'
    root = document.querySelector<HTMLElement>('#app')!
    unmount = mount(root)
    __renderNow()

    expect(root.innerHTML).not.toBe('')
    expect(cardText('rules-title')).toContain('shard 0')
  })

  it('does not lose the cursor in a field during a render that changes nothing', async () => {
    await open({ constraints: rules(3) })
    const field = root.querySelector<HTMLInputElement>('#new-constraint')!
    field.value = 'Never deploy on a Friday'
    field.dispatchEvent(new Event('input', { bubbles: true }))
    __renderNow()

    root.querySelector<HTMLInputElement>('#new-constraint')!.focus()
    root.querySelector<HTMLInputElement>('#new-constraint')!.setSelectionRange(6, 6)
    __renderNow()

    const after = root.querySelector<HTMLInputElement>('#new-constraint')!
    expect(document.activeElement).toBe(after)
    expect(after.selectionStart).toBe(6)
  })
})

describe('the whole device does not grow the page either', () => {
  async function populate(count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
      await store.openPreparedTask({
        ...buildCoreTask(),
        id: `t${i}`,
        title: `Task ${i}`,
        constraints: [],
        steps: steps(50),
      })
    }
    __renderNow()
    // The task list is re-read asynchronously after the render.
    await waitUntil(
      () => (root.textContent ?? '').includes(`${count} tasks on this device`),
      'the task list',
    )
    __renderNow()
  }

  it('bounds the task switcher, which sweeps every task on the device', async () => {
    // `needsYou` walks the steps of every task for its badge, so the page cost
    // the whole device, not just the open one.
    await populate(40)

    const switcher = root.querySelector<HTMLElement>('.switcher')!
    expect(switcher.querySelectorAll('.rows li').length).toBe(12)
    expect(switcher.textContent).toContain('Show all 39 tasks')
  })
})

/**
 * The switcher kept whole tasks in memory, the entire device, for a collapsed
 * dropdown. 1.5 MB on the heap for a 1000 step task, 29.6 MB for 20,000.
 */
describe('the task list does not hold on to the tasks', () => {
  it('returns only what the switcher shows', async () => {
    await store.openPreparedTask({
      ...buildCoreTask(),
      id: 'large',
      title: 'Large task',
      steps: steps(300),
      questions: questions(2),
    })

    const cards = await store.allTaskCards()
    const card = cards.find((c) => c.id === 'large')!

    expect(card.title).toBe('Large task')
    // What weighs is not there. A memory test would flake; this one says the
    // same thing and does not flake.
    for (const heavyField of [
      'steps',
      'audit',
      'mutations',
      'decisions',
      'rejected',
      'constraints',
    ]) {
      expect(Object.keys(card), heavyField).not.toContain(heavyField)
    }
    // And what must survive the trimming survives: the badge is computed before
    // the task is released.
    expect(card.needs.some((n) => n.kind === 'question')).toBe(true)
  })
})

// The technical panel shows what `resume_task` would return: 5 ms on a 20,000
// step task, recomputed on every keystroke, hence memoized. A memo that misses
// its invalidation shows stale state, which is worse than slow here.
describe('the preview of what the agent reads stays current', () => {
  function preview(): string {
    const pre = [...root.querySelectorAll('pre')].find((p) => p.textContent?.includes('TASK ID'))
    return pre?.textContent ?? ''
  }

  it('follows the slightest write', async () => {
    await open({ steps: steps(3) })
    expect(preview()).toContain('3 steps logged')

    const before = store.currentTask()!.version
    await store.mutate((s) =>
      logStep(s, {
        action: 'Ran one more shard',
        result: 'moved',
        evidence: null,
        basedOnVersion: s.version,
      }),
    )
    expect(store.currentTask()!.version).toBeGreaterThan(before)
    __renderNow()

    expect(preview()).toContain('4 steps logged')
    expect(preview()).toContain('Ran one more shard')
  })

  it('follows a change of task', async () => {
    await open({ id: 'one', title: 'First', steps: steps(1) })
    expect(preview()).toContain('First')

    await open({ id: 'two', title: 'Second', steps: steps(2) })
    expect(preview()).toContain('Second')
    expect(preview()).not.toContain('First')
  })
})

/**
 * The export carries the evidence as it is. The README said so, the screen did
 * not, and the screen is what gets read before clicking.
 */
describe('the export says what it carries away', () => {
  it('names the evidence, and what cannot leave', async () => {
    await open({ steps: steps(2) })

    const panneau = [...root.querySelectorAll('details')]
      .map((d) => d.textContent?.replace(/\s+/g, ' ') ?? '')
      .find((t) => t.includes('Export this task'))

    expect(panneau).toContain('carries the evidence exactly as pasted')
    expect(panneau).toContain('Sealed credentials are never included')
    expect(panneau).toContain('kept outside the log')
  })
})
