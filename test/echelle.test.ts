import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildCoreTask } from '../src/demo/seed'
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
import { clearDatabase } from './helpers'

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
