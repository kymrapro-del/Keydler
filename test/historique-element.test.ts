import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildCoreTask } from '../src/demo/seed'
import {
  activeConstraints,
  addConstraint,
  editConstraint,
  setConstraintActive,
} from '../src/domain/task'
import { historyOf } from '../src/domain/trail'
import * as store from '../src/store/taskStore'
import { __renderNow, mount } from '../src/ui/bench'
import { clearDatabase, waitUntil } from './helpers'
import type { TaskState } from '../src/domain/types'

let task: TaskState

beforeEach(() => {
  task = buildCoreTask()
})

describe('suivre ce qui est arrivé à une seule règle', () => {
  it('ne rend rien pour un identifiant inconnu', () => {
    expect(historyOf(task, 'nope')).toEqual([])
  })

  it('rassemble tout ce qui a touché cette règle, dans l’ordre', () => {
    const rule = activeConstraints(task)[0]
    let next = editConstraint(task, rule.id, 'A reworded rule')
    next = setConstraintActive(next, rule.id, false)
    next = setConstraintActive(next, rule.id, true)

    const trail = historyOf(next, rule.id)
    expect(trail.map((e) => e.operation)).toEqual([
      'edit_constraint',
      'deactivate_constraint',
      'reactivate_constraint',
    ])
    expect(trail.map((e) => e.versionAfter)).toEqual(
      [...trail.map((e) => e.versionAfter)].sort((a, b) => a - b),
    )
  })

  it('ne mélange pas deux règles', () => {
    const [un, deux] = activeConstraints(task)
    let next = setConstraintActive(task, un.id, false)
    next = setConstraintActive(next, deux.id, false)

    expect(historyOf(next, un.id)).toHaveLength(1)
    expect(historyOf(next, deux.id)).toHaveLength(1)
  })

  it('porte ce qui a été remplacé, quand il y en a un', () => {
    const rule = activeConstraints(task)[0]
    const next = editConstraint(task, rule.id, 'A reworded rule')
    expect(historyOf(next, rule.id)[0].previous).toBe(rule.rule)
  })

  it('n’oublie pas une règle proposée puis acceptée', () => {
    const proposée = addConstraint(task, { rule: 'A proposed rule', basedOnVersion: null }, 'agent')
    const id = proposée.constraints.at(-1)!.id
    // La proposition elle-même n'a pas de cible : c'est la décision qui en a une.
    expect(historyOf(proposée, id)).toEqual([])
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

    // Un seul cahier : deux appels donneraient des identifiants différents.
    const base = buildCoreTask()
    const rule = activeConstraints(base)[0]
    await store.openPreparedTask(
      setConstraintActive(editConstraint(base, rule.id, 'A reworded rule'), rule.id, false),
    )
    await settled()
  })

  afterEach(() => {
    unmount()
    history.replaceState(null, '', '/')
  })

  it('ne montre rien tant qu’on ne demande pas', () => {
    expect(root.querySelector('.trail')).toBeNull()
    expect(root.querySelector('[data-trail]')).not.toBeNull()
  })

  it('déplie l’histoire de cette règle, en langage humain', async () => {
    const bouton = root.querySelector<HTMLButtonElement>('[data-trail]')!
    bouton.click()
    __renderNow()

    const trail = root.querySelector('.trail')!
    expect(trail).not.toBeNull()
    expect(trail.textContent).toContain('reworded a rule')
    // Aucun nom d'opération machine à l'écran.
    expect(trail.textContent).not.toContain('edit_constraint')
  })

  it('se replie au second clic', async () => {
    const bouton = root.querySelector<HTMLButtonElement>('[data-trail]')!
    bouton.click()
    __renderNow()
    expect(root.querySelector('.trail')).not.toBeNull()

    root.querySelector<HTMLButtonElement>('[data-trail]')!.click()
    __renderNow()
    expect(root.querySelector('.trail')).toBeNull()
  })

  it('n’ouvre qu’une histoire à la fois', async () => {
    const boutons = [...root.querySelectorAll<HTMLButtonElement>('[data-trail]')]
    expect(boutons.length).toBeGreaterThan(1)

    boutons[0].click()
    __renderNow()
    root.querySelectorAll<HTMLButtonElement>('[data-trail]')[1].click()
    __renderNow()

    expect(root.querySelectorAll('.trail')).toHaveLength(1)
  })

  it('suit la règle quand elle est levée depuis l’écran', async () => {
    const rules = activeConstraints(store.currentTask()!)
    const before = store.currentTask()!.version

    root.querySelector<HTMLButtonElement>(`[data-toggle="${rules[0].id}"]`)!.click()
    await waitUntil(() => (store.currentTask()?.version ?? 0) > before, 'la levée')
    __renderNow()

    root.querySelector<HTMLButtonElement>(`[data-trail="${rules[0].id}"]`)!.click()
    __renderNow()
    expect(root.querySelector('.trail')!.textContent).toContain('lifted a rule')
  })
})
