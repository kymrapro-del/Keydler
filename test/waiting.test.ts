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
  await waitUntil(() => (store.currentTask()?.version ?? 0) > before, 'the write')
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
  document.body.innerHTML = '<div id="announcements"></div><div id="app"></div>'
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

describe('what the agent is waiting on you for', () => {
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

  it('shows nothing until someone asks', () => {
    expect(waitingCard()).toBeUndefined()
  })

  it('shows the question and its reason, as soon as it is asked', async () => {
    await ask()
    const card = waitingCard()!
    expect(card).toBeDefined()
    expect(card.textContent).toContain('Which of the five telemetry baselines')
    expect(card.textContent).toContain('The thresholds are relative to them')
  })

  it('answers from the page, and the question closes', async () => {
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

  it('refuses an empty answer rather than closing the question for nothing', async () => {
    await ask()
    const id = openQuestions(store.currentTask()!)[0].id
    root.querySelector<HTMLButtonElement>(`[data-answer="${id}"]`)!.click()
    __renderNow()

    type('answer-text', '   ')
    root.querySelector<HTMLFormElement>('#form-answer')!.requestSubmit()
    await settled()

    expect(openQuestions(store.currentTask()!)).toHaveLength(1)
  })

  it('calls for attention: an open question is seen before the work', async () => {
    await ask()
    const cards = [...root.querySelectorAll('.card')]
    const waiting = cards.indexOf(waitingCard()!)
    const work = cards.findIndex((c) => c.querySelector('h2')?.textContent?.includes('Completed'))
    expect(waiting).toBeGreaterThanOrEqual(0)
    expect(waiting).toBeLessThan(work)
  })
})

describe('attaching evidence after the fact', () => {
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

  it('offers to attach evidence to a step that has none', async () => {
    const id = await claimed()
    expect(root.querySelector(`[data-attach="${id}"]`)).not.toBeNull()
  })

  it('does not offer it when evidence is already there', async () => {
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

  it('says, at the moment of attaching, where the evidence will go', async () => {
    const id = await claimed()
    root.querySelector<HTMLButtonElement>(`[data-attach="${id}"]`)!.click()
    __renderNow()

    const note = root
      .querySelector('#attach-content')!
      .parentElement!.textContent!.replace(/\s+/g, ' ')
    expect(note).toContain('Kept exactly as pasted')
    expect(note).toContain('travels with every export and shared link')
  })

  it('attaches multiline evidence, verified by you since you read it', async () => {
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

describe('the vault takes every kind of secret', () => {
  it('lets you choose the kind, and offers them all', () => {
    const select = root.querySelector<HTMLSelectElement>('#new-secret-kind')!
    expect(select).not.toBeNull()
    expect([...select.options].map((o) => o.value)).toEqual([...SECRET_KINDS])
  })

  it('switches to a multiline field for a private key', async () => {
    const select = root.querySelector<HTMLSelectElement>('#new-secret-kind')!
    expect(root.querySelector('#new-secret-value')!.tagName).toBe('INPUT')

    select.value = 'private_key'
    select.dispatchEvent(new Event('input', { bubbles: true }))
    __renderNow()

    // A PEM key spans several lines: an <input> would cut it at the first one,
    // and nothing would say so before it is used.
    expect(root.querySelector('#new-secret-value')!.tagName).toBe('TEXTAREA')
  })

  it('seals a whole private key, and announces it by its kind', async () => {
    const select = root.querySelector<HTMLSelectElement>('#new-secret-kind')!
    select.value = 'private_key'
    select.dispatchEvent(new Event('input', { bubbles: true }))
    __renderNow()

    type('new-secret-name', 'deploy-signing-key')
    type('new-secret-purpose', 'Signs the deploy bundle')
    type('new-secret-value', '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----')
    type('new-secret-passphrase', 'correct horse battery')
    root.querySelector<HTMLFormElement>('#form-secret')!.requestSubmit()

    await waitUntil(() => !!root.querySelector('[data-reveal]'), 'the sealed credential', 3000)
    __renderNow()

    const card = [...root.querySelectorAll('.card')].find((c) =>
      c.querySelector('h2')?.textContent?.includes('Credentials'),
    )!
    expect(card.textContent).toContain('${deploy-signing-key}')
    expect(card.textContent).toContain('Private key')
  })
})

describe('reclassifying a credential from the page', () => {
  it('prefills the stored kind, and changes it without asking for the value again', async () => {
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
    await waitUntil(() => !!root.querySelector('[data-edit-secret]'), 'the credential', 3000)
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

    await waitUntil(() => !root.querySelector('#edit-form'), 'the correction to be recorded', 3000)
    await waitUntil(
      () =>
        [...root.querySelectorAll('li')].some((li) =>
          li.textContent!.includes('deploy-signing-key'),
        ),
      'the corrected line',
      3000,
    )
    __renderNow()

    const row = [...root.querySelectorAll('li')].find((li) =>
      li.textContent!.includes('deploy-signing-key'),
    )!
    expect(row.querySelector('.chip')!.textContent).toBe('Private key')
  })
})
