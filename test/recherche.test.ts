import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildDemoTask } from '../src/demo/seed'
import { ValidationError } from '../src/domain/errors'
import { createTask, setArchived } from '../src/domain/task'
import { renderTaskState } from '../src/domain/render'
import { MIN_QUERY, matches, searchTask, searchTasks } from '../src/domain/search'
import { normalizeTask } from '../src/persistence/normalize'
import * as store from '../src/store/taskStore'
import { __renderNow, mount } from '../src/ui/bench'
import { clearDatabase } from './helpers'

describe('recherche dans un cahier', () => {
  const task = buildDemoTask()

  it('ne se déclenche pas sur une lettre isolée', () => {
    expect(searchTask(task, 'a')).toEqual([])
    expect(searchTasks([task], 'a')).toEqual([])
    expect(MIN_QUERY).toBe(2)
  })

  it('ignore la casse et les accents', () => {
    expect(matches('Ne jamais modifier le schéma', 'SCHEMA')).toBe(true)
    expect(matches('Refactor', 'refac')).toBe(true)
    expect(matches('Refactor', 'zzz')).toBe(false)
  })

  // `normalise` skips the folding on an ASCII string: the shortcut only holds
  // if it gives the same answer when only one of the two strings is accented.
  it('replie les accents dans les deux sens, quel que soit le côté accentué', () => {
    expect(matches('déjà migré', 'deja')).toBe(true)
    expect(matches('deja migre', 'déjà')).toBe(true)
    expect(matches('DÉJÀ MIGRÉ', 'deja')).toBe(true)
    expect(matches('naïve façade', 'naive facade')).toBe(true)
    expect(matches('crème brûlée', 'creme')).toBe(true)

    // And it does not draw together words that the accent alone does not separate.
    expect(matches('déjà', 'deta')).toBe(false)
  })

  it('replie un accent déjà décomposé, que NFD laisse tel quel', () => {
    // "é" written e + U+0301: the length does not change on decomposition, so
    // nothing signals that a diacritic is left to strip.
    const split = 'caf\u0065\u0301 ferme'
    expect(split.normalize('NFD')).toHaveLength(split.length)
    expect(matches(split, 'cafe')).toBe(true)
  })

  it('replie un caractère dont la MINUSCULE seule sort de l’ASCII', () => {
    // "İ" is ASCII-adjacent to the eye but its lowercase is i + combining dot
    // above: testing the original case rather than the lowercase would have
    // picked the wrong path.
    expect(matches('İstanbul', 'istanbul')).toBe(true)
  })

  it('trouve une règle et dit qui l’a posée', () => {
    const hits = searchTask(task, 'database schema')
    const rule = hits.find((h) => h.kind === 'rule')!
    expect(rule.text).toContain('Never modify the database schema')
    expect(rule.context).toBe('added by you')
  })

  it('trouve un rejet par son MOTIF, pas seulement par son nom', () => {
    // This is the case that matters: we look for "why", not "what".
    const hits = searchTask(task, 'concurrent logins')
    const rejection = hits.find((h) => h.kind === 'rejection')!
    expect(rejection.text).toBe('JWT approach B')
    expect(rejection.context).toContain('concurrent logins')
  })

  it('trouve une étape par le contenu de sa preuve, et le signale', () => {
    // "baseline p95" appears ONLY in the attached command output: not in the
    // action, not in the result. It is the only case that proves the evidence
    // itself is searched.
    const hits = searchTask(task, 'baseline p95')
    const hit = hits.find((h) => h.kind === 'evidence')!
    expect(hit.label).toContain('matched in its evidence')
    expect(hit.text).toContain('Benchmarked the session-bound refresh prototype')
  })

  it('classe en « step » quand le texte visible suffit', () => {
    const hits = searchTask(task, '183 passed')
    expect(hits.find((h) => h.kind === 'step')).toBeTruthy()
  })

  it('distingue une règle en vigueur d’une proposition et d’une règle levée', () => {
    const proposal = searchTask(task, 'Rotating refresh tokens')
    expect(proposal.some((h) => h.label.startsWith('Rejection ('))).toBe(true)
  })

  it('trouve une décision par sa justification', () => {
    const hits = searchTask(task, 'rotation intact')
    expect(hits.find((h) => h.kind === 'decision')!.text).toContain('Approach C')
  })

  it('ne rend rien pour ce qui n’existe pas', () => {
    expect(searchTask(task, 'kubernetes')).toEqual([])
  })
})

describe('recherche entre cahiers', () => {
  const a = { ...buildDemoTask(), id: 'a', title: 'Refactor the authentication module' }
  const b = { ...buildDemoTask(), id: 'b', title: 'Ship the invoice export', next: 'List columns' }

  it('cherche dans le titre et dans la prochaine action', () => {
    expect(searchTasks([a, b], 'invoice').map((t) => t.id)).toEqual(['b'])
    expect(searchTasks([a, b], 'List col').map((t) => t.where)).toEqual(['next'])
  })

  it('reporte l’état, archivage compris', () => {
    const archived = { ...b, archived: true }
    expect(searchTasks([a, archived], 'invoice')[0].archived).toBe(true)
  })
})

describe('archivage', () => {
  it('range une tâche sans la supprimer, et sait la ramener', () => {
    const task = createTask({ title: 'Old work' })
    const away = setArchived(task, true)

    expect(away.archived).toBe(true)
    expect(away.version).toBe(task.version + 1)
    expect(away.audit.at(-1)).toMatchObject({ operation: 'archive_task', actor: 'human' })

    const back = setArchived(away, false)
    expect(back.archived).toBe(false)
    expect(back.audit.at(-1)!.operation).toBe('unarchive_task')
  })

  it('refuse d’archiver deux fois', () => {
    const task = createTask({ title: 'Old work' })
    expect(() => setArchived(task, false)).toThrow(ValidationError)
    expect(() => setArchived(setArchived(task, true), true)).toThrow(ValidationError)
  })

  it('le dit à l’agent : une tâche rangée par l’humain n’est pas une tâche ordinaire', () => {
    const task = setArchived(createTask({ title: 'Old work', next: 'x' }), true)
    expect(renderTaskState(task)).toContain('archived by the human')
    expect(renderTaskState(createTask({ title: 'Live', next: 'x' }))).not.toContain('archived')
  })

  it('relit un enregistrement d’avant comme non archivé', () => {
    const older = { ...createTask({ title: 'From v3' }), archived: undefined, schemaVersion: 3 }
    expect(normalizeTask(older as never)!.archived).toBe(false)
  })
})

describe('à l’écran', () => {
  let root: HTMLElement
  let unmount: () => void

  async function settled(turns = 6) {
    for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0))
    __renderNow()
  }

  async function waitFor(condition: () => boolean, label: string, timeout = 5_000) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      await settled(2)
      if (condition()) return
    }
    throw new Error(`délai dépassé : ${label}`)
  }

  async function search(value: string) {
    const field = root.querySelector<HTMLInputElement>('#search')!
    field.value = value
    field.dispatchEvent(new Event('input', { bubbles: true }))
    // No forced render: it is the keystroke itself that must redraw. Forcing
    // it, the cases passed while nothing at all was happening in a real
    // browser.
    await waitFor(
      () => (root.querySelector('[aria-labelledby="search-title"]') !== null) === value.length >= 2,
      `résultats pour « ${value} »`,
    )
  }

  let demoId = ''

  beforeEach(async () => {
    store.__resetStore()
    await clearDatabase()
    await store.init()
    document.body.innerHTML = '<div id="annonces"></div><div id="app"></div>'
    root = document.querySelector<HTMLElement>('#app')!
    unmount = mount(root)
    // `buildDemoTask()` draws a fresh id on every call: what has to be kept is
    // THE one that was opened, not a second one built here.
    demoId = (await store.openPreparedTask(buildDemoTask())).id
    await settled()
  })

  afterEach(() => {
    unmount()
    history.replaceState(null, '', '/')
  })

  const text = () => root.textContent?.replace(/\s+/g, ' ') ?? ''

  it('laisse le tableau de bord intact tant qu’on n’a rien tapé', () => {
    expect(root.querySelector('#search')).not.toBeNull()
    expect(text()).toContain('Completed work')
    expect(root.querySelector('[aria-labelledby="search-title"]')).toBeNull()
  })

  it('remplace le tableau de bord par les résultats, et le rend', async () => {
    await search('concurrent logins')

    const results = root.querySelector('[aria-labelledby="search-title"]')!
    expect(results.textContent).toContain('JWT approach B')
    expect(results.querySelector('mark')!.textContent).toBe('concurrent logins')

    // During a search the sections give way: what is wanted is results, not a
    // dashboard to scroll past.
    expect(root.querySelector('[aria-labelledby="work-title"]')).toBeNull()
    expect(root.querySelector('[aria-labelledby="rules-title"]')).toBeNull()
  })

  it('garde l’en-tête et le champ, pour ne pas perdre le fil', async () => {
    await search('schema')
    expect(root.querySelector('h1')!.textContent).toContain('Refactor the authentication module')
    expect(root.querySelector<HTMLInputElement>('#search')!.value).toBe('schema')
  })

  it('revient au tableau de bord quand on efface', async () => {
    await search('schema')
    expect(root.querySelector('[aria-labelledby="search-title"]')).not.toBeNull()

    root.querySelector<HTMLButtonElement>('#clear-search')!.click()
    await waitFor(
      () => root.querySelector('[aria-labelledby="search-title"]') === null,
      'retour au tableau de bord',
    )

    expect(root.querySelector('[aria-labelledby="search-title"]')).toBeNull()
    expect(text()).toContain('Completed work')
  })

  it('dit franchement quand rien ne correspond', async () => {
    await search('kubernetes')
    const results = root.querySelector('[aria-labelledby="search-title"]')!
    expect(results.textContent).toContain('0 matches')
    expect(results.textContent).toContain('Nothing in this task.')
  })

  it('n’injecte pas de HTML depuis la requête', async () => {
    await search('<img src=x onerror=alert(1)>')
    expect(root.querySelector('img')).toBeNull()
    expect(root.innerHTML).toContain('&lt;img')
  })

  it('trouve une autre tâche et l’ouvre depuis les résultats', async () => {
    // No render in between: this is the case that left the list stale, the cache
    // being keyed on the open task and not on the whole set.
    const other = await store.createAndOpenTask('Ship the invoice export', 'List the columns')
    await store.openTask(demoId)
    await waitFor(() => store.currentTask()?.id === demoId, 'retour au cahier de démo')
    await waitFor(() => root.querySelector('[data-open]') !== null, 'liste des autres tâches')

    await search('invoice')
    const results = root.querySelector('[aria-labelledby="search-title"]')!
    expect(results.textContent).toContain('Ship the invoice export')

    results.querySelector<HTMLButtonElement>(`[data-open="${other.id}"]`)!.click()
    await waitFor(() => store.currentTask()?.id === other.id, 'ouverture')
    expect(store.currentTask()!.title).toBe('Ship the invoice export')
  })
})

describe('archivage à l’écran', () => {
  let root: HTMLElement
  let unmount: () => void

  async function settled(turns = 6) {
    for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0))
    __renderNow()
  }

  async function waitFor(condition: () => boolean, label: string, timeout = 5_000) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      await settled(2)
      if (condition()) return
    }
    throw new Error(`délai dépassé : ${label}`)
  }

  beforeEach(async () => {
    store.__resetStore()
    await clearDatabase()
    await store.init()
    document.body.innerHTML = '<div id="annonces"></div><div id="app"></div>'
    root = document.querySelector<HTMLElement>('#app')!
    unmount = mount(root)
  })

  afterEach(() => {
    unmount()
    history.replaceState(null, '', '/')
  })

  it('retire une tâche archivée de la liste, sans la perdre', async () => {
    const old = await store.createAndOpenTask('Finished last month', 'nothing')
    await store.createAndOpenTask('Current work', 'Keep going')
    await waitFor(() => root.querySelector(`[data-archive="${old.id}"]`) !== null, 'liste')

    root.querySelector<HTMLButtonElement>(`[data-archive="${old.id}"]`)!.click()
    await waitFor(() => root.querySelector(`[data-open="${old.id}"]`) === null, 'archivage')

    // Filed away, not deleted: it is still on the device.
    expect((await store.allTasks()).map((t) => t.id)).toContain(old.id)
    expect(root.textContent).toContain('Show 1 archived')
  })

  it('les montre sur demande, et sait les ramener', async () => {
    const old = await store.createAndOpenTask('Finished last month', 'nothing')
    await store.createAndOpenTask('Current work', 'Keep going')
    await waitFor(() => root.querySelector(`[data-archive="${old.id}"]`) !== null, 'liste')
    root.querySelector<HTMLButtonElement>(`[data-archive="${old.id}"]`)!.click()
    await waitFor(() => root.querySelector('#toggle-archived') !== null, 'bascule')

    root.querySelector<HTMLButtonElement>('#toggle-archived')!.click()
    __renderNow()
    expect(root.querySelector(`[data-open="${old.id}"]`)).not.toBeNull()

    root.querySelector<HTMLButtonElement>(`[data-archive="${old.id}"]`)!.click()
    await waitFor(
      () => root.querySelector(`[data-archive="${old.id}"]`)?.textContent?.trim() === 'Archive',
      'retour dans la liste ordinaire',
    )

    const back = (await store.allTasks()).find((t) => t.id === old.id)!
    expect(back.archived).toBe(false)
  })

  it('archive le cahier ouvert, et le dit à l’agent', async () => {
    await store.createAndOpenTask('Current work', 'Keep going')
    await waitFor(() => root.querySelector('#archive-current') !== null, 'bouton')

    root.querySelector<HTMLButtonElement>('#archive-current')!.click()
    await waitFor(() => store.currentTask()?.archived === true, 'archivage')

    expect(renderTaskState(store.currentTask()!)).toContain('archived by the human')
    await settled()
    expect(root.querySelector('#archive-current')!.textContent).toContain('Bring this task back')
  })
})
