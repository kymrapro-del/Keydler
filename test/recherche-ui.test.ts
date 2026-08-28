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

describe('filtrer les résultats par nature', () => {
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

  const rows = () => [...root.querySelectorAll('[aria-labelledby="search-title"] .rows > li')]

  beforeEach(async () => {
    store.__resetStore()
    await clearDatabase()
    await store.init()
    document.body.innerHTML = '<div id="annonces"></div><div id="app"></div>'
    root = document.querySelector<HTMLElement>('#app')!
    unmount = mount(root)
    await store.openPreparedTask(buildDemoTask())
    await settled()
    type('token')
    await settled()
  })

  afterEach(() => {
    unmount()
    history.replaceState(null, '', '/')
  })

  it('ne propose que les natures réellement présentes dans les résultats', () => {
    const filters = [...root.querySelectorAll<HTMLButtonElement>('[data-filter]')]
    expect(filters.length).toBeGreaterThan(1)

    const kinds = filters.map((b) => b.dataset.filter)
    expect(kinds).toContain('all')
    // Aucun filtre pour une nature qui ne rendrait rien.
    for (const kind of kinds) {
      if (kind === 'all') continue
      expect(
        rows().some((li) => li.textContent!.length > 0),
        kind,
      ).toBe(true)
    }
  })

  /**
   * Les comptes portés par les filtres n'étaient vérifiés nulle part : deux
   * mutants les faussaient sans que la suite bronche. Ils disent pourtant à
   * l'utilisateur ce qu'il trouvera en cliquant.
   */
  it('porte le compte exact de chaque nature, et leur somme', () => {
    const trouvés = searchTask(store.currentTask()!, 'token')
    const attendu = new Map<string, number>()
    for (const m of trouvés) attendu.set(m.kind, (attendu.get(m.kind) ?? 0) + 1)

    const compte = (bouton: HTMLButtonElement) =>
      Number(/\((\d+)\)\s*$/.exec(bouton.textContent!.trim())![1])

    for (const bouton of root.querySelectorAll<HTMLButtonElement>('[data-filter]')) {
      const nature = bouton.dataset.filter!
      expect(compte(bouton), nature).toBe(
        nature === 'all' ? trouvés.length : (attendu.get(nature) ?? 0),
      )
    }

    // Et « All » est bien la somme des autres, pas un nombre à part.
    const parNature = [...root.querySelectorAll<HTMLButtonElement>('[data-filter]')]
      .filter((b) => b.dataset.filter !== 'all')
      .reduce((n, b) => n + compte(b), 0)
    expect(parNature).toBe(trouvés.length)
  })

  it('range les natures dans l’ordre où le cahier les présente', () => {
    // Une règle passe avant une étape parce que c'est l'ordre du cahier ; un
    // ordre tiré d'ailleurs ferait danser les boutons d'une frappe à l'autre.
    const ordre = [...root.querySelectorAll<HTMLButtonElement>('[data-filter]')]
      .map((b) => b.dataset.filter!)
      .filter((k) => k !== 'all')
    const attendu = [...new Set(searchTask(store.currentTask()!, 'token').map((m) => m.kind))]
    expect(ordre).toEqual(attendu)
  })

  it('réduit aux seules lignes de la nature choisie', async () => {
    const avant = rows().length
    const bouton = [...root.querySelectorAll<HTMLButtonElement>('[data-filter]')].find(
      (b) => b.dataset.filter === 'step',
    )!
    bouton.click()
    __renderNow()

    const après = rows().length
    expect(après).toBeGreaterThan(0)
    expect(après).toBeLessThan(avant)
    for (const li of rows()) {
      expect(li.textContent!.toUpperCase()).toContain('STEP')
    }
  })

  it('dit lequel est actif, pour le lecteur d’écran aussi', () => {
    const bouton = [...root.querySelectorAll<HTMLButtonElement>('[data-filter]')].find(
      (b) => b.dataset.filter === 'step',
    )!
    bouton.click()
    __renderNow()

    const actif = root.querySelector('[data-filter="step"]')!
    expect(actif.getAttribute('aria-pressed')).toBe('true')
    expect(root.querySelector('[data-filter="all"]')!.getAttribute('aria-pressed')).toBe('false')
  })

  it('revient à tout, et le compte du titre suit le filtre', async () => {
    const tout = rows().length
    root.querySelector<HTMLButtonElement>('[data-filter="step"]')!.click()
    __renderNow()
    const filtré = rows().length
    expect(root.querySelector('#search-title')!.textContent).toContain(String(filtré))

    root.querySelector<HTMLButtonElement>('[data-filter="all"]')!.click()
    __renderNow()
    expect(rows().length).toBe(tout)
  })

  it('oublie le filtre quand la recherche change', async () => {
    root.querySelector<HTMLButtonElement>('[data-filter="step"]')!.click()
    __renderNow()
    expect(root.querySelector('[data-filter="step"]')!.getAttribute('aria-pressed')).toBe('true')

    type('rotation')
    await settled()

    // Un filtre gardé d'une recherche à l'autre fait croire à un résultat vide.
    const actif = root.querySelector('[data-filter="all"]')
    expect(actif?.getAttribute('aria-pressed')).toBe('true')
  })
})
