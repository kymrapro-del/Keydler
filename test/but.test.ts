import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildCoreTask } from '../src/demo/seed'
import {
  completeTask,
  createTask,
  setGoal,
  undoable,
  undoLastSupervision,
} from '../src/domain/task'
import { renderTaskState, TOKEN_BUDGET, estimateTokens } from '../src/domain/render'
import { ValidationError } from '../src/domain/errors'
import { completeTaskTool } from '../src/webmcp/tools'
import * as store from '../src/store/taskStore'
import { __renderNow, mount } from '../src/ui/bench'
import { taskUrl } from '../src/webmcp/location'
import { call, clearDatabase, currentTask, textOf, waitUntil, writeArgs } from './helpers'
import type { TaskState } from '../src/domain/types'

let task: TaskState

beforeEach(() => {
  task = buildCoreTask()
})

const BUT = 'Every session expires in under 30 minutes, with no change to the schema.'

describe('ce que « terminé » veut dire', () => {
  it('n’existe pas tant que personne ne l’a écrit', () => {
    expect(createTask({ title: 'X' }).goal).toBeNull()
  })

  it('s’écrit, et reste attribué à l’humain', () => {
    const next = setGoal(task, BUT)
    expect(next.goal).toBe(BUT)
    expect(next.audit.at(-1)).toMatchObject({ operation: 'set_goal', actor: 'human' })
  })

  it('se retire, sans que ce soit une erreur', () => {
    const installed = setGoal(task, BUT)
    expect(setGoal(installed, '   ').goal).toBeNull()
  })

  it('refuse d’être réécrit à l’identique', () => {
    const installed = setGoal(task, BUT)
    expect(() => setGoal(installed, BUT)).toThrow(ValidationError)
  })

  it('s’annule comme les autres corrections d’un champ', () => {
    const installed = setGoal(task, 'A first attempt')
    const changed = setGoal(installed, BUT)
    expect(undoable(changed)).toContain('what done')
    expect(undoLastSupervision(changed).goal).toBe('A first attempt')
  })
})

describe('ce que l’agent en lit', () => {
  it('le place avec la prochaine action, pas au fond', () => {
    const rendered = renderTaskState(setGoal(task, BUT))
    expect(rendered).toContain('DONE WHEN')
    expect(rendered).toContain('with no change to the schema')
    expect(rendered.indexOf('DONE WHEN')).toBeLessThan(rendered.indexOf('CONSTRAINTS'))
    expect(estimateTokens(rendered)).toBeLessThanOrEqual(TOKEN_BUDGET)
  })

  it('se tait quand personne ne l’a écrit', () => {
    expect(renderTaskState(task)).not.toContain('DONE WHEN')
  })

  it('reste lisible sur une tâche close, à côté du résumé', () => {
    const closed = completeTask(setGoal(task, BUT), { summary: 'S', basedOnVersion: null }, 'human')
    const rendered = renderTaskState(closed)
    expect(rendered).toContain('DONE WHEN')
    expect(rendered).toContain('SUMMARY')
  })
})

describe('clore une tâche qui avait un but', () => {
  beforeEach(async () => {
    store.__resetStore()
    await clearDatabase()
    await store.init()
  })

  afterEach(() => store.__resetStore())

  it('rappelle le but à l’agent, pour que son résumé y réponde', async () => {
    await store.openPreparedTask(setGoal(buildCoreTask(), BUT))
    const result = await call(completeTaskTool, writeArgs(currentTask(), { summary: 'Done.' }))

    expect(result.isError).toBeFalsy()
    const text = textOf(result)
    expect(text).toContain('DONE WHEN')
    expect(text).toContain(BUT)
    expect(text.toLowerCase()).toContain('say whether')
  })

  it('ne rappelle rien quand aucun but n’avait été posé', async () => {
    await store.openPreparedTask(buildCoreTask())
    const result = await call(completeTaskTool, writeArgs(currentTask(), { summary: 'Done.' }))
    expect(textOf(result)).not.toContain('DONE WHEN')
  })
})

describe('depuis la page', () => {
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

  it('invite à dire ce que « terminé » veut dire quand rien n’est écrit', () => {
    const bouton = root.querySelector('#edit-goal')!
    expect(bouton).not.toBeNull()
    expect(bouton.textContent).toMatch(/done/i)
  })

  it('l’écrit, et l’affiche sous la prochaine action', async () => {
    root.querySelector<HTMLButtonElement>('#edit-goal')!.click()
    __renderNow()

    const field = root.querySelector<HTMLInputElement>('#edit-value')!
    field.value = BUT
    field.dispatchEvent(new Event('input', { bubbles: true }))
    root.querySelector<HTMLFormElement>('#edit-form')!.requestSubmit()

    await waitUntil(() => store.currentTask()?.goal === BUT, 'le but écrit', 3000)
    __renderNow()

    expect(root.querySelector('.hero')!.textContent).toContain(BUT)
  })
})

describe('pour un agent qui n’a pas WebMCP', () => {
  let root: HTMLElement
  let unmount: () => void
  let copied: string | null

  async function settled(turns = 8) {
    for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0))
    __renderNow()
  }

  beforeEach(async () => {
    copied = null
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (t: string) => {
          copied = t
          return Promise.resolve()
        },
      },
    })
    store.__resetStore()
    await clearDatabase()
    await store.init()
    document.body.innerHTML = '<div id="annonces"></div><div id="app"></div>'
    root = document.querySelector<HTMLElement>('#app')!
    unmount = mount(root)
    await store.openPreparedTask(setGoal(buildCoreTask(), BUT))
    await settled()
  })

  afterEach(() => {
    unmount()
    history.replaceState(null, '', '/')
  })

  it('copie le cahier en texte, tel que l’agent l’aurait reçu', async () => {
    root.querySelector<HTMLButtonElement>('#copy-state')!.click()
    await waitUntil(() => copied !== null, 'la copie', 3000)

    // The same text as resume_task, down to the same options: that is the
    // whole point, the agent reads exactly what the tool would have returned.
    const attendu = renderTaskState(store.currentTask()!, {
      url: taskUrl(store.currentTask()!.id),
      credentials: [],
    })
    expect(copied).toContain(attendu)
  })

  it('l’encadre d’une consigne, pour que ce ne soit pas un mur de texte anonyme', async () => {
    root.querySelector<HTMLButtonElement>('#copy-state')!.click()
    await waitUntil(() => copied !== null, 'la copie', 3000)

    expect(copied!.toLowerCase()).toContain('continue this task')
    expect(copied!.toLowerCase()).toContain('read this before')
  })

  it('ne porte aucune valeur d’identifiant', async () => {
    root.querySelector<HTMLButtonElement>('#copy-state')!.click()
    await waitUntil(() => copied !== null, 'la copie', 3000)

    for (const mot of ['ciphertext', 'passphrase', 'sealed:']) {
      expect(copied, mot).not.toContain(mot)
    }
  })

  it('dit ce qu’il vient de copier', async () => {
    root.querySelector<HTMLButtonElement>('#copy-state')!.click()
    await waitUntil(() => !!root.querySelector('.notice--ok'), 'le message', 3000)
    __renderNow()
    expect(root.querySelector('.notice--ok')!.textContent!.toLowerCase()).toContain('paste')
  })
})
