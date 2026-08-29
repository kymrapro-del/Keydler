import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildCoreTask } from '../src/demo/seed'
import { activeConstraints, copyRulesInto, createTask } from '../src/domain/task'
import { sinceThen } from '../src/domain/elapsed'
import { renderTaskState, TOKEN_BUDGET, estimateTokens } from '../src/domain/render'
import * as store from '../src/store/taskStore'
import { __renderNow, mount } from '../src/ui/bench'
import { clearDatabase, waitUntil } from './helpers'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe('dire le temps écoulé', () => {
  const now = 1_700_000_000_000

  it('reste vague à la minute près, sans fausse précision', () => {
    expect(sinceThen(now - 5_000, now)).toBe('just now')
    expect(sinceThen(now - 90_000, now)).toBe('1 minute ago')
    expect(sinceThen(now - 40 * MINUTE, now)).toBe('40 minutes ago')
  })

  it('passe aux heures, puis aux jours', () => {
    expect(sinceThen(now - 2 * HOUR, now)).toBe('2 hours ago')
    expect(sinceThen(now - 25 * HOUR, now)).toBe('1 day ago')
    expect(sinceThen(now - 9 * DAY, now)).toBe('9 days ago')
  })

  it('ne prétend rien pour une date à venir', () => {
    expect(sinceThen(now + HOUR, now)).toBe('just now')
  })

  it('ne prétend rien pour un horodatage illisible', () => {
    expect(sinceThen(Number.NaN, now)).toBeNull()
    expect(sinceThen(0, now)).toBeNull()
  })
})

describe('ce que l’agent lit du temps', () => {
  it('signale un cahier resté longtemps sans écriture', () => {
    const vieux = { ...buildCoreTask(), updatedAt: Date.now() - 30 * DAY }
    const rendered = renderTaskState(vieux)

    expect(rendered).toMatch(/LAST WRITE\s+30 days ago/)
    expect(estimateTokens(rendered)).toBeLessThanOrEqual(TOKEN_BUDGET)
  })

  it('se tait quand le cahier vient d’être touché', () => {
    const frais = { ...buildCoreTask(), updatedAt: Date.now() - MINUTE }
    expect(renderTaskState(frais)).not.toContain('LAST WRITE')
  })

  it('se tait quand l’horodatage n’est pas lisible', () => {
    const cassé = { ...buildCoreTask(), updatedAt: 0 }
    expect(renderTaskState(cassé)).not.toContain('LAST WRITE')
  })
})

describe('reprendre les règles d’un cahier', () => {
  it('copie les règles en vigueur, et rien d’autre', () => {
    const source = buildCoreTask()
    const cible = copyRulesInto(createTask({ title: 'New task' }), source)

    const attendues = activeConstraints(source).map((c) => c.rule)
    expect(activeConstraints(cible).map((c) => c.rule)).toEqual(attendues)

    // Not the work, not the rejections, not the other one's write log.
    expect(cible.steps).toHaveLength(0)
    expect(cible.rejected).toHaveLength(0)
    expect(cible.decisions).toHaveLength(0)
    expect(cible.questions).toHaveLength(0)
  })

  it('les rend opposables d’emblée, et attribuées à l’humain', () => {
    const cible = copyRulesInto(createTask({ title: 'New task' }), buildCoreTask())
    for (const rule of cible.constraints) {
      expect(rule.standing, rule.rule).toBe('accepted')
      expect(rule.source, rule.rule).toBe('human')
      expect(rule.active, rule.rule).toBe(true)
    }
  })

  it('laisse une trace de leur provenance dans le journal', () => {
    const source = buildCoreTask()
    const cible = copyRulesInto(createTask({ title: 'New task' }), source)
    const entrée = cible.audit.at(-1)!
    expect(entrée.operation).toBe('copy_rules')
    expect(entrée.detail).toContain(source.title)
  })

  it('n’écrit rien quand il n’y a aucune règle à reprendre', () => {
    const vide = createTask({ title: 'No rules here' })
    const cible = createTask({ title: 'New task' })
    expect(copyRulesInto(cible, vide)).toBe(cible)
  })

  it('ne recopie pas une règle levée', () => {
    const source = buildCoreTask()
    const levée = source.constraints[0]
    const avecLevée = {
      ...source,
      constraints: source.constraints.map((c) => (c.id === levée.id ? { ...c, active: false } : c)),
    }
    const cible = copyRulesInto(createTask({ title: 'New' }), avecLevée)
    expect(cible.constraints.some((c) => c.rule === levée.rule)).toBe(false)
  })
})

describe('depuis la page', () => {
  let root: HTMLElement
  let unmount: () => void

  async function settled(turns = 8) {
    for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0))
    __renderNow()
  }

  function fill(id: string, value: string) {
    const field = root.querySelector<HTMLInputElement>(`#${id}`)!
    field.value = value
    field.dispatchEvent(new Event('input', { bubbles: true }))
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

  it('propose de reprendre les règles en créant une tâche', async () => {
    root.querySelector<HTMLButtonElement>('#new-task')!.click()
    __renderNow()

    const box = root.querySelector<HTMLInputElement>('#carry-rules')
    expect(box).not.toBeNull()
    expect(root.querySelector('label[for="carry-rules"]')!.textContent).toMatch(/rule/i)
  })

  it('crée la tâche avec les règles reprises quand la case est cochée', async () => {
    const attendues = activeConstraints(store.currentTask()!).map((c) => c.rule)

    root.querySelector<HTMLButtonElement>('#new-task')!.click()
    __renderNow()

    fill('new-title', 'Second task')
    fill('new-next', 'Start it')
    const box = root.querySelector<HTMLInputElement>('#carry-rules')!
    box.checked = true
    box.dispatchEvent(new Event('change', { bubbles: true }))

    root.querySelector<HTMLFormElement>('#create-task')!.requestSubmit()
    // Creating and carrying the rules over are two writes: wait for the second,
    // not the first.
    await waitUntil(
      () =>
        store.currentTask()?.title === 'Second task' && store.currentTask()!.constraints.length > 0,
      'les règles reprises',
      3000,
    )
    __renderNow()

    expect(activeConstraints(store.currentTask()!).map((c) => c.rule)).toEqual(attendues)
    expect(store.currentTask()!.steps).toHaveLength(0)
  })

  it('n’en reprend aucune quand la case reste décochée', async () => {
    root.querySelector<HTMLButtonElement>('#new-task')!.click()
    __renderNow()

    fill('new-title', 'Plain task')
    fill('new-next', 'Start it')
    root.querySelector<HTMLFormElement>('#create-task')!.requestSubmit()
    await waitUntil(() => store.currentTask()?.title === 'Plain task', 'la nouvelle tâche', 3000)
    await settled()

    expect(store.currentTask()!.constraints).toHaveLength(0)
  })

  it('montre depuis quand le cahier n’a pas bougé', async () => {
    await store.updateTask(store.currentTask()!.id, (s) => ({
      ...s,
      updatedAt: Date.now() - 3 * DAY,
    }))
    await settled()

    expect(root.textContent).toContain('3 days ago')
  })
})
