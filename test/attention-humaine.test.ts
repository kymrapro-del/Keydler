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

describe('ce qui attend l’humain', () => {
  it('ne signale rien sur une tâche neuve', () => {
    const fresh = addConstraint(buildCoreTask(), { rule: 'A rule', basedOnVersion: null }, 'human')
    const items = needsYou({
      ...fresh,
      constraints: fresh.constraints.filter((c) => c.standing !== 'proposed'),
      rejected: fresh.rejected.filter((r) => r.standing !== 'proposed'),
      steps: [],
    })
    expect(items).toEqual([])
  })

  it('compte chaque sorte de chose à faire, sans les mélanger', () => {
    const items = needsYou(buildDemoTask())
    const kinds = items.map((i) => i.kind)

    expect(kinds).toContain('proposal')
    expect(kinds).toContain('evidence')
    expect(new Set(kinds).size).toBe(kinds.length)
  })

  it('met une demande d’autorisation en premier : un agent y est bloqué', () => {
    let task: TaskState = buildCoreTask()
    task = askHuman(task, { question: 'q?', why: 'w', basedOnVersion: null }, 'agent')
    task = requestApproval(task, { action: 'a', why: 'w', basedOnVersion: null }, 'agent')

    const items = needsYou(task)
    expect(items[0].kind).toBe('approval')
    expect(items[1].kind).toBe('question')
  })

  it('donne un libellé au singulier comme au pluriel', () => {
    let task = buildCoreTask()
    task = askHuman(task, { question: 'q1?', why: 'w', basedOnVersion: null }, 'agent')
    expect(needsYou(task).find((i) => i.kind === 'question')!.label).toContain('1 question')

    task = askHuman(task, { question: 'q2?', why: 'w', basedOnVersion: null }, 'agent')
    expect(needsYou(task).find((i) => i.kind === 'question')!.label).toContain('2 questions')
  })

  it('cesse de compter une preuve une fois qu’elle est tranchée', () => {
    const task = buildCoreTask()
    const attente = task.steps.filter(
      (s) => s.evidence !== null && s.confidence === 'evidence',
    ).length
    expect(needsYou(task).find((i) => i.kind === 'evidence')!.count).toBe(attente)

    const step = task.steps.find((s) => s.confidence === 'evidence')!
    const après = verifyEvidence(task, step.id, step.evidence!.content)
    expect(needsYou(après).find((i) => i.kind === 'evidence')!.count).toBe(attente - 1)

    const autre = après.steps.find((s) => s.confidence === 'evidence')!
    const contesté = disputeStep(après, autre.id, 'wrong branch')
    expect(needsYou(contesté).find((i) => i.kind === 'evidence')).toBeUndefined()
  })

  it('ne signale rien sur une tâche close', () => {
    const closed: TaskState = { ...buildDemoTask(), status: 'completed' }
    expect(needsYou(closed)).toEqual([])
  })

  it('compte une proposition de règle et une proposition de rejet ensemble', () => {
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

  it('signale le travail affirmé sans la moindre preuve', () => {
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

describe('la barre à l’écran', () => {
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
    document.body.innerHTML = '<div id="annonces"></div><div id="app"></div>'
    root = document.querySelector<HTMLElement>('#app')!
    unmount = mount(root)
    await store.openPreparedTask(buildDemoTask())
    await settled()
  })

  afterEach(() => {
    unmount()
    history.replaceState(null, '', '/')
  })

  it('résume en haut ce qui vous attend, avant d’avoir à lire dix cartes', () => {
    expect(bar()).not.toBeNull()
    expect(bar()!.textContent).toMatch(/needs you/i)
  })

  it('emmène à la carte concernée d’un clic', async () => {
    const link = bar()!.querySelector<HTMLAnchorElement>('a[href="#evidence-title"]')
    expect(link).not.toBeNull()
    expect(root.querySelector('#evidence-title')).not.toBeNull()
  })

  it('disparaît quand il n’y a plus rien à faire', async () => {
    await store.openPreparedTask({ ...buildDemoTask(), status: 'completed' })
    await waitUntil(() => store.currentTask()?.status === 'completed', 'la clôture')
    __renderNow()
    expect(bar()).toBeNull()
  })
})
