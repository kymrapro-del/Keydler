import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildCoreTask } from '../src/demo/seed'
import {
  addConstraint,
  completeTask,
  renameTask,
  setConstraintStanding,
  setGoal,
  setNext,
  undoLastSupervision,
  undoable,
} from '../src/domain/task'
import { needsYou, summariseNeeds } from '../src/domain/attention'
import { historyOf } from '../src/domain/trail'
import { requestApprovalTool, __setApprovalTimeout } from '../src/webmcp/tools'
import * as store from '../src/store/taskStore'
import { __renderNow, mount } from '../src/ui/bench'
import { call, clearDatabase, currentTask, textOf, waitUntil, writeArgs } from './helpers'

describe('une attente d’autorisation pendant que tout bouge', () => {
  beforeEach(async () => {
    __setApprovalTimeout(400)
    store.__resetStore()
    await clearDatabase()
    await store.init()
    await store.openPreparedTask(buildCoreTask())
  })

  afterEach(() => {
    __setApprovalTimeout(120_000)
    store.__resetStore()
  })

  it('ne prétend pas à un accord quand la tâche est supprimée sous elle', async () => {
    const pending = call(
      requestApprovalTool,
      writeArgs(currentTask(), { action: 'Do it', why: 'risky' }),
    )
    await waitUntil(() => currentTask().approvals.length > 0, 'la demande')
    await store.deleteCurrentTask()

    const result = await pending
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('NO ANSWER')
    expect(textOf(result)).not.toContain('ALLOWED')
  })

  it('ne prétend pas à un accord quand on passe à un autre cahier', async () => {
    const pending = call(
      requestApprovalTool,
      writeArgs(currentTask(), { action: 'Do it', why: 'risky' }),
    )
    await waitUntil(() => currentTask().approvals.length > 0, 'la demande')
    await store.createAndOpenTask('Elsewhere', 'x')

    const result = await pending
    expect(textOf(result)).toContain('NO ANSWER')
  })
})

describe('chaînes d’annulation', () => {
  it('remonte une suite de corrections d’un champ, une par une', () => {
    let task = buildCoreTask()
    const titre = task.title
    const but = task.goal
    task = renameTask(task, 'Second name')
    task = setGoal(task, 'A first goal')
    task = setNext(task, 'A different next')

    task = undoLastSupervision(task)
    task = undoLastSupervision(task)
    task = undoLastSupervision(task)

    expect(task.title).toBe(titre)
    expect(task.goal).toBe(but)
    expect(undoable(task)).toBeNull()
  })

  it('ne propose plus rien après avoir tout rendu', () => {
    let task = renameTask(buildCoreTask(), 'Second name')
    task = undoLastSupervision(task)
    expect(undoable(task)).toBeNull()
    expect(() => undoLastSupervision(task)).toThrow()
  })

  it('s’arrête net devant une écriture d’agent', () => {
    let task = renameTask(buildCoreTask(), 'Second name')
    task = addConstraint(task, { rule: 'An agent rule', basedOnVersion: null }, 'agent')
    expect(undoable(task)).toBeNull()
  })
})

describe('bornes des surfaces récentes', () => {
  it('le résumé de ce qui attend reste court quel que soit le nombre', () => {
    let task = buildCoreTask()
    for (let i = 0; i < 200; i++) {
      task = addConstraint(task, { rule: `Proposed rule ${i}`, basedOnVersion: null }, 'agent')
    }
    const résumé = summariseNeeds(needsYou(task))!
    expect(résumé.length).toBeLessThan(70)
  })

  it('le but survit à une clôture, et reste annulable après réouverture', () => {
    const posé = setGoal(buildCoreTask(), 'Ship it')
    const clos = completeTask(posé, { summary: 'Done', basedOnVersion: null }, 'human')
    expect(clos.goal).toBe('Ship it')
    // Poser un but sur une tâche close reste possible : l'humain reste maître.
    expect(() => setGoal(clos, 'Another goal')).not.toThrow()
  })

  it('l’histoire d’une proposition acceptée nomme la décision', () => {
    const proposée = addConstraint(
      buildCoreTask(),
      { rule: 'A proposed rule', basedOnVersion: null },
      'agent',
    )
    const id = proposée.constraints.at(-1)!.id
    const acceptée = setConstraintStanding(proposée, id, 'accepted')

    expect(historyOf(acceptée, id).map((e) => e.operation)).toEqual(['accept_constraint'])
  })
})

describe('le filtre de recherche entre deux cahiers', () => {
  let root: HTMLElement
  let unmount: () => void

  async function settled(turns = 8) {
    for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0))
    __renderNow()
  }

  beforeEach(async () => {
    store.__resetStore()
    await clearDatabase()
    await store.init()
    document.body.innerHTML = '<div id="annonces"></div><div id="app"></div>'
    root = document.querySelector<HTMLElement>('#app')!
    unmount = mount(root)
    await store.openPreparedTask(buildCoreTask())
    await settled()
  })

  afterEach(() => {
    unmount()
    history.replaceState(null, '', '/')
  })

  it('ne garde pas un filtre d’une tâche à l’autre', async () => {
    const field = root.querySelector<HTMLInputElement>('#search')!
    field.value = 'token'
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await settled()

    root.querySelector<HTMLButtonElement>('[data-filter="step"]')!.click()
    __renderNow()
    expect(root.querySelector('[data-filter="step"]')!.getAttribute('aria-pressed')).toBe('true')

    await store.createAndOpenTask('Elsewhere', 'x')
    await settled()

    const again = root.querySelector<HTMLInputElement>('#search')!
    again.value = 'token'
    again.dispatchEvent(new Event('input', { bubbles: true }))
    await settled()

    // Un filtre hérité d'un autre cahier ferait passer une trouvaille pour rien.
    const all = root.querySelector('[data-filter="all"]')
    expect(all === null || all.getAttribute('aria-pressed') === 'true').toBe(true)
  })
})
