import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildCoreTask } from '../src/demo/seed'
import { logStep } from '../src/domain/task'
import * as store from '../src/store/taskStore'
import { __renderNow, mount } from '../src/ui/bench'
import type {
  ApprovalRequest,
  Constraint,
  OpenQuestion,
  Rejection,
  Step,
  TaskState,
} from '../src/domain/types'
import { clearDatabase, waitUntil } from './helpers'

let root: HTMLElement
let unmount: () => void

const text = () => root.textContent?.replace(/\s+/g, ' ') ?? ''

function card(labelledBy: string): HTMLElement {
  const found = root.querySelector<HTMLElement>(`[aria-labelledby="${labelledBy}"]`)
  if (!found) throw new Error(`carte « ${labelledBy} » absente`)
  return found
}

const cardText = (labelledBy: string) => card(labelledBy).textContent?.replace(/\s+/g, ' ') ?? ''

function button(label: string): HTMLButtonElement {
  const found = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === label,
  )
  if (!found) throw new Error(`bouton « ${label} » absent`)
  return found
}

function rules(n: number, active = true): Constraint[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `c${i}`,
    rule: `Never touch shard ${i} without a snapshot`,
    source: 'human',
    addedAtVersion: i,
    active,
    standing: 'accepted',
  }))
}

function rejections(n: number): Rejection[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `r${i}`,
    approach: `Streaming shard ${i}`,
    reason: 'Lost rows under retry',
    source: 'agent',
    addedAtVersion: i,
    standing: 'accepted',
    at: 1_700_000_000_000 + i,
  }))
}

function questions(n: number): OpenQuestion[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `q${i}`,
    question: `Which shard owns tenant ${i}?`,
    why: 'The mapping table disagrees with the router',
    source: 'agent',
    addedAtVersion: i,
    at: 1_700_000_000_000 + i,
    answer: null,
    answeredAt: null,
  }))
}

function approvals(n: number): ApprovalRequest[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `a${i}`,
    action: `Drop the staging table for shard ${i}`,
    why: 'It blocks the migration',
    source: 'agent',
    addedAtVersion: i,
    at: 1_700_000_000_000 + i,
    decision: null,
    decidedAt: null,
  }))
}

function steps(n: number): Step[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `s${i}`,
    action: `Ran the migration on shard ${i}`,
    result: `Shard ${i} moved cleanly`,
    evidence: null,
    dispute: null,
    confidence: 'evidence',
    basedOnVersion: i,
    source: 'agent',
    at: 1_700_000_000_000 + i,
  }))
}

async function open(task: Partial<TaskState>): Promise<void> {
  await store.openPreparedTask({ ...buildCoreTask(), constraints: [], ...task })
  __renderNow()
}

beforeEach(async () => {
  store.__resetStore()
  await clearDatabase()
  await store.init()
  history.replaceState(null, '', '/')
  document.body.innerHTML = '<div id="annonces"></div><div id="app"></div>'
  root = document.querySelector<HTMLElement>('#app')!
  unmount = mount(root)
})

afterEach(() => {
  unmount()
  history.replaceState(null, '', '/')
})

/**
 * Mesuré avant ces bornes : 2000 règles portaient un aller-retour de rendu de
 * 17 ms à 501 ms, pour 1,2 Mo de HTML et 10 000 nœuds — et la page se
 * redessine à chaque frappe dans la recherche. Le tableau de bord devenait
 * injouable sur un cahier qu'aucune règle n'interdisait de construire.
 */
describe('la page ne grandit pas avec les données', () => {
  it('garde le même ordre de grandeur avec cent fois plus de tout', async () => {
    await open({
      constraints: rules(500),
      rejected: rejections(500),
      questions: questions(500),
      approvals: approvals(500),
      steps: steps(500),
    })

    const nœuds = root.querySelectorAll('*').length
    const taille = root.innerHTML.length

    expect(nœuds).toBeLessThan(1200)
    expect(taille).toBeLessThan(300_000)
  })

  it('borne chaque liste séparément, pour qu’aucune ne passe entre les mailles', async () => {
    // Une seule liste laissée libre suffirait à faire tomber la page ; le
    // test les prend donc une par une, sans que les autres la masquent.
    for (const [nom, champ] of [
      ['règles', { constraints: rules(400) }],
      ['approches écartées', { rejected: rejections(400) }],
      ['questions', { questions: questions(400) }],
      ['autorisations', { approvals: approvals(400) }],
      ['étapes', { steps: steps(400) }],
    ] as const) {
      await open(champ)
      expect(root.querySelectorAll('li').length, nom).toBeLessThan(60)
    }
  })
})

describe('ce qui est caché est dit, et reste atteignable', () => {
  it('annonce le nombre de règles et les déplie toutes', async () => {
    await open({ constraints: rules(40) })

    expect(card('rules-title').querySelectorAll('.rows li').length).toBe(12)
    button('Show all 40 rules').click()
    __renderNow()

    expect(card('rules-title').querySelectorAll('.rows li').length).toBe(40)
    expect(cardText('rules-title')).toContain('Show fewer')
  })

  it('avertit quand ce qui est hors de vue ENGAGE encore', async () => {
    await open({ constraints: rules(40) })
    expect(cardText('rules-title')).toContain('28 rules still in force are not shown')

    button('Show all 40 rules').click()
    __renderNow()
    // Une fois tout à l'écran, plus rien n'est caché : l'avertissement s'en va.
    expect(text()).not.toContain('still in force are not shown')
  })

  it('ne crie pas au loup pour des règles simplement levées', async () => {
    await open({
      constraints: [...rules(6), ...rules(40, false).map((c) => ({ ...c, id: `x${c.id}` }))],
    })

    expect(cardText('rules-title')).toContain('Show all 46 rules')
    expect(cardText('rules-title')).not.toContain('still in force are not shown')
  })

  it('n’offre pas de bouton quand tout tient déjà à l’écran', async () => {
    await open({ constraints: rules(5) })
    expect(cardText('rules-title')).not.toContain('Show all')
    expect(cardText('rules-title')).not.toContain('Show fewer')
  })

  it('déplie aussi les approches écartées, les questions et les autorisations', async () => {
    await open({
      rejected: rejections(30),
      questions: questions(30),
      approvals: approvals(30),
    })

    expect(text()).toContain('Show all 30 entries')
    expect(text()).toContain('Show all 30 questions')
    expect(text()).toContain('Show all 30 requests')
  })
})

/**
 * Le rendu est réveillé par le magasin, par les appels d'outil et par les
 * enregistrements ; beaucoup de ces réveils ne changent rien. Mesuré sur la
 * suite d'interface : 30 % des rendus produisaient un HTML identique.
 */
describe('ne redessine pas ce qui n’a pas changé', () => {
  it('garde les mêmes nœuds quand rien ne bouge', async () => {
    await open({ constraints: rules(3) })
    const avant = card('rules-title')

    __renderNow()
    __renderNow()

    // Le même objet DOM, pas seulement le même texte : c'est la preuve que
    // rien n'a été reconstruit.
    expect(card('rules-title')).toBe(avant)
  })

  it('redessine dès que l’état change vraiment', async () => {
    await open({ constraints: rules(3) })
    const avant = card('rules-title')

    await store.mutate((s) => ({ ...s, version: s.version + 1, constraints: rules(4) }))
    __renderNow()

    expect(card('rules-title')).not.toBe(avant)
    expect(cardText('rules-title')).toContain('shard 3')
  })

  it('peint une racine neuve, même si l’état est resté le même', async () => {
    // Le piège de l'optimisation : se souvenir du HTML déjà peint sans
    // remarquer que la racine, elle, a été remplacée — et laisser une page
    // blanche.
    await open({ constraints: rules(3) })
    const attendu = root.innerHTML
    expect(attendu).not.toBe('')

    unmount()
    document.body.innerHTML = '<div id="annonces"></div><div id="app"></div>'
    root = document.querySelector<HTMLElement>('#app')!
    unmount = mount(root)
    __renderNow()

    expect(root.innerHTML).not.toBe('')
    expect(cardText('rules-title')).toContain('shard 0')
  })

  it('ne fait pas perdre le curseur dans un champ pendant un rendu à vide', async () => {
    await open({ constraints: rules(3) })
    const champ = root.querySelector<HTMLInputElement>('#new-constraint')!
    champ.value = 'Never deploy on a Friday'
    champ.dispatchEvent(new Event('input', { bubbles: true }))
    __renderNow()

    root.querySelector<HTMLInputElement>('#new-constraint')!.focus()
    root.querySelector<HTMLInputElement>('#new-constraint')!.setSelectionRange(6, 6)
    __renderNow()

    const après = root.querySelector<HTMLInputElement>('#new-constraint')!
    expect(document.activeElement).toBe(après)
    expect(après.selectionStart).toBe(6)
  })
})

describe('le poste entier ne fait pas grandir la page non plus', () => {
  async function poser(nombre: number): Promise<void> {
    for (let i = 0; i < nombre; i++) {
      await store.openPreparedTask({
        ...buildCoreTask(),
        id: `t${i}`,
        title: `Task ${i}`,
        constraints: [],
        steps: steps(50),
      })
    }
    __renderNow()
    // La liste des cahiers est relue de façon asynchrone après le rendu.
    await waitUntil(
      () => (root.textContent ?? '').includes(`${nombre} tasks on this device`),
      'la liste des cahiers',
    )
    __renderNow()
  }

  it('borne le sélecteur de cahiers, qui balaie chaque cahier du poste', async () => {
    // `needsYou` parcourt les étapes de CHAQUE cahier pour sa pastille : la
    // page coûtait donc le poste entier, et pas seulement le cahier ouvert.
    await poser(40)

    const switcher = root.querySelector<HTMLElement>('.switcher')!
    expect(switcher.querySelectorAll('.rows li').length).toBe(12)
    expect(switcher.textContent).toContain('Show all 39 tasks')
  })
})

/**
 * Le sélecteur gardait les cahiers ENTIERS en mémoire — tout le poste, en
 * permanence, pour une liste déroulante repliée. Mesuré : 1,5 Mo en tas pour
 * un cahier de 1000 étapes, 29,6 Mo pour 20 000.
 */
describe('la liste des cahiers ne retient pas les cahiers', () => {
  it('ne rend que ce que le sélecteur affiche', async () => {
    await store.openPreparedTask({
      ...buildCoreTask(),
      id: 'gros',
      title: 'Gros cahier',
      steps: steps(300),
      questions: questions(2),
    })

    const cards = await store.allTaskCards()
    const carte = cards.find((c) => c.id === 'gros')!

    expect(carte.title).toBe('Gros cahier')
    // Ce qui pèse n'est pas là. Un test de mémoire clignoterait ; celui-ci dit
    // la même chose et ne clignote pas.
    for (const lourd of ['steps', 'audit', 'mutations', 'decisions', 'rejected', 'constraints']) {
      expect(Object.keys(carte), lourd).not.toContain(lourd)
    }
    // Et ce qui doit survivre à la réduction survit : la pastille est calculée
    // avant que le cahier ne soit relâché.
    expect(carte.needs.some((n) => n.kind === 'question')).toBe(true)
  })
})

/**
 * Le panneau technique montre exactement ce que `resume_task` rendrait —
 * 5 ms sur un cahier de 20 000 étapes, recalculé à chaque frappe. Il est
 * maintenant mémorisé ; une mémorisation qui rate son invalidation montre un
 * état périmé, ce qui est pire que lent dans un produit dont c'est le sujet.
 */
describe('l’aperçu de ce que lit l’agent reste à jour', () => {
  function apercu(): string {
    const pre = [...root.querySelectorAll('pre')].find((p) => p.textContent?.includes('TASK ID'))
    return pre?.textContent ?? ''
  }

  it('suit la moindre écriture', async () => {
    await open({ steps: steps(3) })
    expect(apercu()).toContain('3 steps logged')

    const before = store.currentTask()!.version
    await store.mutate((s) =>
      logStep(s, {
        action: 'Ran one more shard',
        result: 'moved',
        evidence: null,
        basedOnVersion: s.version,
      }),
    )
    expect(store.currentTask()!.version).toBeGreaterThan(before)
    __renderNow()

    expect(apercu()).toContain('4 steps logged')
    expect(apercu()).toContain('Ran one more shard')
  })

  it('suit un changement de cahier', async () => {
    await open({ id: 'un', title: 'Premier', steps: steps(1) })
    expect(apercu()).toContain('Premier')

    await open({ id: 'deux', title: 'Second', steps: steps(2) })
    expect(apercu()).toContain('Second')
    expect(apercu()).not.toContain('Premier')
  })
})
