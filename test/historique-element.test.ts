import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildCoreTask } from '../src/demo/seed'
import {
  activeConstraints,
  addConstraint,
  editConstraint,
  logStep,
  setConstraintActive,
} from '../src/domain/task'
import { MAX_AUDIT_ENTRIES } from '../src/domain/types'
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
    expect(historyOf(task, 'nope').entries).toEqual([])
  })

  it('rassemble tout ce qui a touché cette règle, dans l’ordre', () => {
    const rule = activeConstraints(task)[0]
    let next = editConstraint(task, rule.id, 'A reworded rule')
    next = setConstraintActive(next, rule.id, false)
    next = setConstraintActive(next, rule.id, true)

    const trail = historyOf(next, rule.id).entries
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

    expect(historyOf(next, un.id).entries).toHaveLength(1)
    expect(historyOf(next, deux.id).entries).toHaveLength(1)
  })

  it('porte ce qui a été remplacé, quand il y en a un', () => {
    const rule = activeConstraints(task)[0]
    const next = editConstraint(task, rule.id, 'A reworded rule')
    expect(historyOf(next, rule.id).entries[0].previous).toBe(rule.rule)
  })

  it('n’oublie pas une règle proposée puis acceptée', () => {
    const proposée = addConstraint(task, { rule: 'A proposed rule', basedOnVersion: null }, 'agent')
    const id = proposée.constraints.at(-1)!.id
    // La proposition elle-même n'a pas de cible : c'est la décision qui en a une.
    expect(historyOf(proposée, id).entries).toEqual([])
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

describe('une histoire élaguée le dit', () => {
  function saturé(): { task: TaskState; ruleId: string } {
    let next = buildCoreTask()
    const rule = activeConstraints(next)[0]
    next = setConstraintActive(next, rule.id, false)

    for (let i = 0; i < MAX_AUDIT_ENTRIES + 20; i++) {
      next = logStep(next, { action: `step ${i}`, result: 'x', basedOnVersion: null }, 'agent')
    }
    return { task: next, ruleId: rule.id }
  }

  it('ne prétend pas être complète quand le journal a été élagué', () => {
    const { task, ruleId } = saturé()
    const trail = historyOf(task, ruleId)

    // Les entrées de cette règle sont tombées hors du journal borné : ne rien
    // dire reviendrait à affirmer qu'il ne s'est rien passé.
    expect(trail.entries).toHaveLength(0)
    expect(trail.mayBeIncomplete).toBe(true)
  })

  it('se dit complète tant que rien n’a été élagué', () => {
    const rule = activeConstraints(task)[0]
    const trail = historyOf(setConstraintActive(task, rule.id, false), rule.id)
    expect(trail.entries).toHaveLength(1)
    expect(trail.mayBeIncomplete).toBe(false)
  })

  it('avertit même quand il reste des entrées à montrer', () => {
    const { task: avant, ruleId } = saturé()
    const saturée = setConstraintActive(avant, ruleId, true)

    const trail = historyOf(saturée, ruleId)
    expect(trail.entries.length).toBeGreaterThan(0)
    expect(trail.mayBeIncomplete).toBe(true)
  })
})

describe('l’avertissement à l’écran', () => {
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

    let base = buildCoreTask()
    const rule = activeConstraints(base)[0]
    base = setConstraintActive(base, rule.id, false)
    base = setConstraintActive(base, rule.id, true)
    for (let i = 0; i < MAX_AUDIT_ENTRIES + 20; i++) {
      base = logStep(base, { action: `step ${i}`, result: 'x', basedOnVersion: null }, 'agent')
    }
    base = setConstraintActive(base, rule.id, false)

    await store.openPreparedTask(base)
    await settled()
  })

  afterEach(() => {
    unmount()
    history.replaceState(null, '', '/')
  })

  it('dit que des entrées plus anciennes ont été écartées', () => {
    root.querySelector<HTMLButtonElement>('[data-trail]')!.click()
    __renderNow()

    const trail = root.querySelector('.trail')!
    expect(trail.textContent).toMatch(/older|dropped|earlier/i)
  })

  it('propose encore l’histoire même quand tout a été élagué', async () => {
    // Sans entrée survivante, cacher le bouton reviendrait à taire l'élagage.
    const task = store.currentTask()!
    const oubliée = task.constraints[1]
    expect(root.querySelector(`[data-trail="${oubliée.id}"]`)).not.toBeNull()

    root.querySelector<HTMLButtonElement>(`[data-trail="${oubliée.id}"]`)!.click()
    __renderNow()
    expect(root.querySelector('.trail')!.textContent).toMatch(/older|dropped|earlier/i)
  })
})
