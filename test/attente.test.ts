import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { askHuman, logStep, openQuestions } from '../src/domain/task'
import { SECRET_KINDS } from '../src/domain/secret'
import * as store from '../src/store/taskStore'
import { __renderNow, mount } from '../src/ui/bench'
import { clearDatabase, waitUntil } from './helpers'

let root: HTMLElement
let unmount: () => void

async function settled(turns = 8) {
  for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0))
  __renderNow()
}

async function written(before: number) {
  await waitUntil(() => (store.currentTask()?.version ?? 0) > before, 'l’écriture')
  __renderNow()
}

function type(id: string, value: string) {
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
  await store.createAndOpenTask('Ship the issuer', 'Read the spec')
  await settled()
})

afterEach(() => {
  unmount()
  history.replaceState(null, '', '/')
})

const waitingCard = () =>
  [...root.querySelectorAll('.card')].find((c) =>
    c.querySelector('h2')?.textContent?.includes('Waiting on you'),
  )

describe('ce que l’agent attend de vous', () => {
  async function ask() {
    const before = store.currentTask()!.version
    await store.mutate((s) =>
      askHuman(
        s,
        {
          question: 'Which of the five telemetry baselines should the gate use?',
          why: 'The thresholds are relative to them and I cannot measure them here.',
          basedOnVersion: null,
        },
        'agent',
      ),
    )
    await written(before)
  }

  it('ne montre rien tant que personne n’a demandé', () => {
    expect(waitingCard()).toBeUndefined()
  })

  it('montre la question et son motif, dès qu’elle est posée', async () => {
    await ask()
    const card = waitingCard()!
    expect(card).toBeDefined()
    expect(card.textContent).toContain('Which of the five telemetry baselines')
    expect(card.textContent).toContain('The thresholds are relative to them')
  })

  it('répond depuis la page, et la question se ferme', async () => {
    await ask()
    const id = openQuestions(store.currentTask()!)[0].id

    root.querySelector<HTMLButtonElement>(`[data-answer="${id}"]`)!.click()
    __renderNow()
    const before = store.currentTask()!.version
    type('answer-text', 'Use the p95 baselines from the release dashboard.')
    root.querySelector<HTMLFormElement>('#form-answer')!.requestSubmit()
    await written(before)

    expect(openQuestions(store.currentTask()!)).toHaveLength(0)
    expect(waitingCard()!.textContent).toContain('Use the p95 baselines')
  })

  it('refuse une réponse vide plutôt que de fermer la question pour rien', async () => {
    await ask()
    const id = openQuestions(store.currentTask()!)[0].id
    root.querySelector<HTMLButtonElement>(`[data-answer="${id}"]`)!.click()
    __renderNow()

    type('answer-text', '   ')
    root.querySelector<HTMLFormElement>('#form-answer')!.requestSubmit()
    await settled()

    expect(openQuestions(store.currentTask()!)).toHaveLength(1)
  })

  it('appelle l’attention : une question ouverte se voit avant le travail', async () => {
    await ask()
    const cards = [...root.querySelectorAll('.card')]
    const waiting = cards.indexOf(waitingCard()!)
    const work = cards.findIndex((c) => c.querySelector('h2')?.textContent?.includes('Completed'))
    expect(waiting).toBeGreaterThanOrEqual(0)
    expect(waiting).toBeLessThan(work)
  })
})

describe('joindre une preuve après coup', () => {
  async function claimed() {
    const before = store.currentTask()!.version
    await store.mutate((s) =>
      logStep(
        s,
        { action: 'Ran the migration', result: 'no error', basedOnVersion: null },
        'agent',
      ),
    )
    await written(before)
    return store.currentTask()!.steps.at(-1)!.id
  }

  it('propose de joindre une preuve à une étape restée sans', async () => {
    const id = await claimed()
    expect(root.querySelector(`[data-attach="${id}"]`)).not.toBeNull()
  })

  it('ne le propose pas quand une preuve est déjà là', async () => {
    const before = store.currentTask()!.version
    await store.mutate((s) =>
      logStep(
        s,
        {
          action: 'Ran the suite',
          result: 'green',
          evidence: { kind: 'test_report', content: '148 passed' },
          basedOnVersion: null,
        },
        'human',
      ),
    )
    await written(before)
    const id = store.currentTask()!.steps.at(-1)!.id
    expect(root.querySelector(`[data-attach="${id}"]`)).toBeNull()
  })

  it('dit, au moment de joindre, où la preuve ira', async () => {
    const id = await claimed()
    root.querySelector<HTMLButtonElement>(`[data-attach="${id}"]`)!.click()
    __renderNow()

    const note = root
      .querySelector('#attach-content')!
      .parentElement!.textContent!.replace(/\s+/g, ' ')
    expect(note).toContain('Kept exactly as pasted')
    expect(note).toContain('travels with every export and shared link')
  })

  it('joint une preuve multiligne, validée par vous puisque vous l’avez lue', async () => {
    const id = await claimed()
    root.querySelector<HTMLButtonElement>(`[data-attach="${id}"]`)!.click()
    __renderNow()

    const before = store.currentTask()!.version
    type('attach-content', 'ALTER TABLE\nCOMMIT')
    root.querySelector<HTMLFormElement>('#form-attach')!.requestSubmit()
    await written(before)

    const step = store.currentTask()!.steps.find((s) => s.id === id)!
    expect(step.evidence!.content).toContain('\n')
    expect(step.confidence).toBe('human_verified')
  })
})

describe('le coffre accepte toute nature de secret', () => {
  it('laisse choisir la nature, et les propose toutes', () => {
    const select = root.querySelector<HTMLSelectElement>('#new-secret-kind')!
    expect(select).not.toBeNull()
    expect([...select.options].map((o) => o.value)).toEqual([...SECRET_KINDS])
  })

  it('passe à un champ multiligne pour une clé privée', async () => {
    const select = root.querySelector<HTMLSelectElement>('#new-secret-kind')!
    expect(root.querySelector('#new-secret-value')!.tagName).toBe('INPUT')

    select.value = 'private_key'
    select.dispatchEvent(new Event('input', { bubbles: true }))
    __renderNow()

    // Une clé PEM tient sur plusieurs lignes : un <input> la tronquerait à la
    // première, et rien ne le signalerait avant l'usage.
    expect(root.querySelector('#new-secret-value')!.tagName).toBe('TEXTAREA')
  })

  it('scelle une clé privée entière, et l’annonce par sa nature', async () => {
    const select = root.querySelector<HTMLSelectElement>('#new-secret-kind')!
    select.value = 'private_key'
    select.dispatchEvent(new Event('input', { bubbles: true }))
    __renderNow()

    type('new-secret-name', 'deploy-signing-key')
    type('new-secret-purpose', 'Signs the deploy bundle')
    type('new-secret-value', '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----')
    type('new-secret-passphrase', 'correct horse battery')
    root.querySelector<HTMLFormElement>('#form-secret')!.requestSubmit()

    await waitUntil(() => !!root.querySelector('[data-reveal]'), 'l’identifiant scellé', 3000)
    __renderNow()

    const card = [...root.querySelectorAll('.card')].find((c) =>
      c.querySelector('h2')?.textContent?.includes('Credentials'),
    )!
    expect(card.textContent).toContain('${deploy-signing-key}')
    expect(card.textContent).toContain('Private key')
  })
})

describe('reclasser un identifiant depuis la page', () => {
  it('préremplit la nature enregistrée, et la change sans redemander la valeur', async () => {
    const type2 = (id: string, value: string) => {
      const field = root.querySelector<HTMLInputElement>(`#${id}`)!
      field.value = value
      field.dispatchEvent(new Event('input', { bubbles: true }))
    }

    type2('new-secret-name', 'legacy-key')
    type2('new-secret-purpose', 'Sealed before kinds existed')
    type2('new-secret-value', 'value')
    type2('new-secret-passphrase', 'correct horse battery')
    root.querySelector<HTMLFormElement>('#form-secret')!.requestSubmit()
    await waitUntil(() => !!root.querySelector('[data-edit-secret]'), 'l’identifiant', 3000)
    __renderNow()

    root.querySelector<HTMLButtonElement>('[data-edit-secret]')!.click()
    __renderNow()

    const select = root.querySelector<HTMLSelectElement>('#edit-secret-kind')!
    expect(select.value).toBe('api_key')

    select.value = 'private_key'
    select.dispatchEvent(new Event('input', { bubbles: true }))
    type2('edit-value', 'deploy-signing-key')
    type2('edit-reason', 'Signs the deploy bundle')
    root.querySelector<HTMLFormElement>('#edit-form')!.requestSubmit()

    await waitUntil(() => !root.querySelector('#edit-form'), 'la correction enregistrée', 3000)
    await waitUntil(
      () =>
        [...root.querySelectorAll('li')].some((li) =>
          li.textContent!.includes('deploy-signing-key'),
        ),
      'la ligne corrigée',
      3000,
    )
    __renderNow()

    const row = [...root.querySelectorAll('li')].find((li) =>
      li.textContent!.includes('deploy-signing-key'),
    )!
    expect(row.querySelector('.chip')!.textContent).toBe('Private key')
  })
})
