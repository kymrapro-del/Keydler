import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildDemoTask } from '../src/demo/seed'
import { addConstraint } from '../src/domain/task'
import { searchTask } from '../src/domain/search'
import * as store from '../src/store/taskStore'
import { __renderNow, mount } from '../src/ui/bench'
import { clearDatabase, waitUntil } from './helpers'

describe('la recherche à l’écran', () => {
  let root: HTMLElement
  let unmount: () => void

  async function settled(turns = 8) {
    for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0))
    __renderNow()
  }

  function type(value: string) {
    const field = root.querySelector<HTMLInputElement>('#search')!
    field.value = value
    field.dispatchEvent(new Event('input', { bubbles: true }))
  }

  const results = () => root.querySelector('[aria-labelledby="search-title"]')

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

  it('compte les résultats de chaque section, pas seulement le total', async () => {
    type('token')
    await settled()

    const here = searchTask(store.currentTask()!, 'token').length
    expect(here).toBeGreaterThan(0)

    const headings = [...results()!.querySelectorAll('h3')].map((h) => h.textContent ?? '')
    // Un sous-titre sans compte oblige à compter les lignes soi-même pour
    // savoir si la réponse est ici ou ailleurs.
    expect(headings[0]).toContain(String(here))
    expect(headings[1]).toMatch(/\d/)
  })

  it('emmène au champ de recherche sur « / », sans écrire la barre oblique', async () => {
    const field = root.querySelector<HTMLInputElement>('#search')!
    field.blur()

    const event = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true })
    document.body.dispatchEvent(event)

    expect(document.activeElement).toBe(field)
    expect(event.defaultPrevented).toBe(true)
  })

  it('ne détourne pas « / » pendant que l’on écrit ailleurs', async () => {
    root.querySelector<HTMLButtonElement>('#log-step')!.click()
    await settled()

    const action = root.querySelector<HTMLInputElement>('#step-action')!
    action.focus()
    const event = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true })
    action.dispatchEvent(event)

    expect(document.activeElement).toBe(action)
    expect(event.defaultPrevented).toBe(false)
  })

  it('vide la recherche sur Échap et rend le focus au champ', async () => {
    type('token')
    await settled()
    expect(results()).not.toBeNull()

    const field = root.querySelector<HTMLInputElement>('#search')!
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settled()

    expect(results()).toBeNull()
    expect(root.querySelector<HTMLInputElement>('#search')!.value).toBe('')
  })

  it('reste utilisable quand tout correspond, sans tout déverser', async () => {
    for (let i = 0; i < 60; i++) {
      await store.mutate((s) =>
        addConstraint(s, { rule: `Rule about widgets number ${i}`, basedOnVersion: null }, 'human'),
      )
    }
    await waitUntil(() => (store.currentTask()?.constraints.length ?? 0) >= 60, 'les 60 règles')
    type('widgets')
    await settled()

    const rows = results()!.querySelectorAll('.rows > li').length
    expect(rows).toBeLessThanOrEqual(41)
    expect(results()!.textContent).toContain('more not shown')
  })
})
