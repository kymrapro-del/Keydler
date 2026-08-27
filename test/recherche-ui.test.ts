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

describe('le clavier ferme ce qui est ouvert', () => {
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
    await store.createAndOpenTask('Ship the issuer', 'Read the spec')
    await settled()
  })

  afterEach(() => {
    unmount()
    history.replaceState(null, '', '/')
  })

  function escape(from: Element = document.body) {
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    from.dispatchEvent(event)
    __renderNow()
    return event
  }

  it('referme le formulaire d’étape, sans avoir à viser le bouton Annuler', async () => {
    root.querySelector<HTMLButtonElement>('#log-step')!.click()
    await settled()
    expect(root.querySelector('#form-step')).not.toBeNull()

    escape(root.querySelector('#step-action')!)
    expect(root.querySelector('#form-step')).toBeNull()
  })

  it('referme la correction en cours d’édition', async () => {
    root.querySelector<HTMLButtonElement>('#edit-title')!.click()
    __renderNow()
    expect(root.querySelector('#edit-form')).not.toBeNull()

    escape(root.querySelector('#edit-value')!)
    expect(root.querySelector('#edit-form')).toBeNull()
  })

  it('referme la création d’une tâche', async () => {
    root.querySelector<HTMLButtonElement>('#new-task')!.click()
    __renderNow()
    expect(root.querySelector('#create-task')).not.toBeNull()

    escape(root.querySelector('#new-title')!)
    expect(root.querySelector('#create-task')).toBeNull()
  })

  it('ne ferme rien quand rien n’est ouvert, et laisse la touche passer', () => {
    const event = escape()
    expect(event.defaultPrevented).toBe(false)
  })

  it('ferme ce qui est à l’écran : la recherche masque le formulaire', async () => {
    root.querySelector<HTMLButtonElement>('#log-step')!.click()
    await settled()
    expect(root.querySelector('#form-step')).not.toBeNull()

    const field = root.querySelector<HTMLInputElement>('#search')!
    field.value = 'issuer'
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await settled()
    // Le formulaire n'est plus à l'écran : fermer « le formulaire » d'abord
    // donnerait l'impression que la touche ne fait rien.
    expect(root.querySelector('#form-step')).toBeNull()

    escape()
    expect(root.querySelector<HTMLInputElement>('#search')!.value).toBe('')
    expect(root.querySelector('#form-step')).not.toBeNull()

    escape(root.querySelector('#step-action')!)
    expect(root.querySelector('#form-step')).toBeNull()
  })
})

describe('le surlignage', () => {
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
    await store.createAndOpenTask('Ship the issuer', 'Read the spec')
    await store.mutate((s) =>
      addConstraint(
        s,
        {
          rule: 'The token issuer signs the token, and the token carries no token',
          basedOnVersion: null,
        },
        'human',
      ),
    )
    await settled()
  })

  afterEach(() => {
    unmount()
    history.replaceState(null, '', '/')
  })

  it('marque chaque occurrence, pas seulement la première', async () => {
    const field = root.querySelector<HTMLInputElement>('#search')!
    field.value = 'token'
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await settled()

    const row = [...root.querySelectorAll('[aria-labelledby="search-title"] li')].find((li) =>
      li.textContent!.includes('signs the token'),
    )!
    // Surligner la première seule laisse croire que le reste ne correspond pas.
    expect(row.querySelectorAll('mark').length).toBeGreaterThanOrEqual(4)
  })
})
