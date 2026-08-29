import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildCoreTask, buildDemoTask } from '../src/demo/seed'
import { needsYou } from '../src/domain/attention'
import {
  addConstraint,
  askHuman,
  disputeStep,
  logStep,
  rejectApproach,
  requestApproval,
  verifyEvidence,
} from '../src/domain/task'
import * as store from '../src/store/taskStore'
import { __renderNow, mount } from '../src/ui/bench'
import { clearDatabase, waitUntil } from './helpers'
import type { TaskState } from '../src/domain/types'

describe('what is waiting on the human', () => {
  it('flags nothing on a fresh task', () => {
    const fresh = addConstraint(buildCoreTask(), { rule: 'A rule', basedOnVersion: null }, 'human')
    const items = needsYou({
      ...fresh,
      constraints: fresh.constraints.filter((c) => c.standing !== 'proposed'),
      rejected: fresh.rejected.filter((r) => r.standing !== 'proposed'),
      steps: [],
    })
    expect(items).toEqual([])
  })

  it('counts each kind of thing to do, without mixing them', () => {
    const items = needsYou(buildDemoTask())
    const kinds = items.map((i) => i.kind)

    expect(kinds).toContain('proposal')
    expect(kinds).toContain('evidence')
    expect(new Set(kinds).size).toBe(kinds.length)
  })

  it('puts an approval request first: an agent is blocked on it', () => {
    let task: TaskState = buildCoreTask()
    task = askHuman(task, { question: 'q?', why: 'w', basedOnVersion: null }, 'agent')
    task = requestApproval(task, { action: 'a', why: 'w', basedOnVersion: null }, 'agent')

    const items = needsYou(task)
    expect(items[0].kind).toBe('approval')
    expect(items[1].kind).toBe('question')
  })

  it('gives a label in the singular as in the plural', () => {
    let task = buildCoreTask()
    task = askHuman(task, { question: 'q1?', why: 'w', basedOnVersion: null }, 'agent')
    expect(needsYou(task).find((i) => i.kind === 'question')!.label).toContain('1 question')

    task = askHuman(task, { question: 'q2?', why: 'w', basedOnVersion: null }, 'agent')
    expect(needsYou(task).find((i) => i.kind === 'question')!.label).toContain('2 questions')
  })

  it('stops counting a piece of evidence once it is settled', () => {
    const task = buildCoreTask()
    const pending = task.steps.filter(
      (s) => s.evidence !== null && s.confidence === 'evidence',
    ).length
    expect(needsYou(task).find((i) => i.kind === 'evidence')!.count).toBe(pending)

    const step = task.steps.find((s) => s.confidence === 'evidence')!
    const after = verifyEvidence(task, step.id, step.evidence!.content)
    expect(needsYou(after).find((i) => i.kind === 'evidence')!.count).toBe(pending - 1)

    const other = after.steps.find((s) => s.confidence === 'evidence')!
    const disputed = disputeStep(after, other.id, 'wrong branch')
    expect(needsYou(disputed).find((i) => i.kind === 'evidence')).toBeUndefined()
  })

  it('flags nothing on a closed task', () => {
    const closed: TaskState = { ...buildDemoTask(), status: 'completed' }
    expect(needsYou(closed)).toEqual([])
  })

  it('counts a proposed rule and a proposed rejection together', () => {
    let task = buildCoreTask()
    task = addConstraint(task, { rule: 'Proposed rule', basedOnVersion: null }, 'agent')
    task = rejectApproach(
      task,
      { approach: 'Proposed rejection', reason: 'because', basedOnVersion: null },
      'agent',
    )
    const proposals = needsYou(task).find((i) => i.kind === 'proposal')!
    expect(proposals.count).toBeGreaterThanOrEqual(2)
  })

  it('flags work claimed without a shred of evidence', () => {
    const task = logStep(
      buildCoreTask(),
      { action: 'Something', result: 'done', basedOnVersion: null },
      'agent',
    )
    const claimed = needsYou(task).find((i) => i.kind === 'claimed')!
    expect(claimed.count).toBeGreaterThanOrEqual(2)
    expect(claimed.label.toLowerCase()).toContain('no evidence')
  })
})

describe('the bar on screen', () => {
  let root: HTMLElement
  let unmount: () => void

  async function settled(turns = 8) {
    for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0))
    __renderNow()
  }

  const bar = () => root.querySelector('.needs')

  beforeEach(async () => {
    store.__resetStore()
    await clearDatabase()
    await store.init()
    document.body.innerHTML = '<div id="announcements"></div><div id="app"></div>'
    root = document.querySelector<HTMLElement>('#app')!
    unmount = mount(root)
    await store.openPreparedTask(buildDemoTask())
    await settled()
  })

  afterEach(() => {
    unmount()
    history.replaceState(null, '', '/')
  })

  it('sums up at the top what is waiting on you, before you have to read ten cards', () => {
    expect(bar()).not.toBeNull()
    expect(bar()!.textContent).toMatch(/needs you/i)
  })

  it('takes you to the card in question in one click', async () => {
    const link = bar()!.querySelector<HTMLAnchorElement>('a[href="#evidence-title"]')
    expect(link).not.toBeNull()
    expect(root.querySelector('#evidence-title')).not.toBeNull()
  })

  it('disappears when there is nothing left to do', async () => {
    await store.openPreparedTask({ ...buildDemoTask(), status: 'completed' })
    await waitUntil(() => store.currentTask()?.status === 'completed', 'the closing')
    __renderNow()
    expect(bar()).toBeNull()
  })
})
