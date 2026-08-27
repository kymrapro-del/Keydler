import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildDemoTask } from '../src/demo/seed'
import { renderTaskState } from '../src/domain/render'
import {
  acceptedRejections,
  activeConstraints,
  addConstraint,
  completeTask,
  logStep,
  proposedRejections,
} from '../src/domain/task'
import * as store from '../src/store/taskStore'
import { __renderNow, mount } from '../src/ui/bench'
import { resetCalls } from '../src/webmcp/witness'
import { __resetRegistration, registerTools } from '../src/webmcp/register'
import { clearDatabase, installModelContext, mutationId, removeModelContext } from './helpers'

let root: HTMLElement
let unmount: () => void

async function settled(turns = 4) {
  for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0))
  __renderNow()
}

function type(id: string, value: string) {
  const field = root.querySelector<HTMLInputElement>(`#${id}`)
  if (!field) throw new Error(`champ #${id} absent`)
  field.value = value
  field.dispatchEvent(new Event('input', { bubbles: true }))
}

function button(label: string): HTMLButtonElement {
  const found = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === label,
  )
  if (!found) throw new Error(`bouton « ${label} » absent`)
  return found
}

const text = () => root.textContent?.replace(/\s+/g, ' ') ?? ''

beforeEach(async () => {
  store.__resetStore()
  resetCalls()
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

describe('première visite', () => {
  it('explique le bénéfice avant le mécanisme, et sans jargon', async () => {
    await settled()

    expect(text()).toContain('Give your AI a memory that survives the conversation.')
    expect(text()).toContain('completed work, rules to follow, and mistakes not to repeat')

    for (const jargon of ['based_on_version', 'mutation_id', 'IndexedDB', 'AbortController']) {
      expect(text(), jargon).not.toContain(jargon)
    }
  })

  it('offre les deux portes d’entrée, la principale d’abord', async () => {
    await settled()
    const primary = root.querySelector<HTMLButtonElement>('.btn--primary')
    expect(primary?.textContent?.trim()).toBe('Create a task')
    expect(button('Try the demo')).toBeTruthy()
  })
})

describe('création d’une tâche', () => {
  async function openForm() {
    await settled()
    button('Create a task').click()
    await settled()
  }

  it('donne le focus au premier champ à l’ouverture du formulaire', async () => {
    await openForm()
    expect(document.activeElement?.id).toBe('new-title')
  })

  it('crée une vraie tâche et conserve titre, prochaine action et première règle', async () => {
    await openForm()
    type('new-title', 'Refactor the authentication module')
    type('new-next', 'Map the existing entry points')
    type('new-rule', 'Never modify the database schema')
    root.querySelector<HTMLFormElement>('#create-task')!.requestSubmit()
    await settled(8)

    const task = store.currentTask()!
    expect(task.title).toBe('Refactor the authentication module')
    expect(task.next).toBe('Map the existing entry points')

    const rules = activeConstraints(task)
    expect(rules).toHaveLength(1)
    expect(rules[0].rule).toBe('Never modify the database schema')
    expect(rules[0].source).toBe('human')
    expect(rules[0].standing).toBe('accepted')
  })

  it('place le focus sur le titre après création, et l’y laisse', async () => {
    await openForm()
    type('new-title', 'Add rate limiting to our HTTP API')
    type('new-next', 'Choose the mechanism')
    root.querySelector<HTMLFormElement>('#create-task')!.requestSubmit()
    await settled(8)

    expect(document.activeElement?.tagName).toBe('H1')
    expect(document.activeElement?.textContent).toBe('Add rate limiting to our HTTP API')
  })

  it('lie la tâche à /t/:id', async () => {
    await openForm()
    type('new-title', 'Ship the invoice export')
    type('new-next', 'List the current columns')
    root.querySelector<HTMLFormElement>('#create-task')!.requestSubmit()
    await settled(8)

    expect(location.pathname).toBe(`/t/${store.currentTask()!.id}`)
  })

  it('refuse un titre vide en langage humain, sans rien écrire', async () => {
    await openForm()
    type('new-next', 'Map the existing entry points')
    root.querySelector<HTMLFormElement>('#create-task')!.requestSubmit()
    await settled()

    expect(root.querySelector('[role="alert"]')?.textContent).toContain('give the task a title')
    expect(store.currentTask()).toBeNull()
    expect(document.activeElement?.id).toBe('new-title')
  })

  it('refuse une prochaine action vide, en disant pourquoi elle compte', async () => {
    await openForm()
    type('new-title', 'Something')
    root.querySelector<HTMLFormElement>('#create-task')!.requestSubmit()
    await settled()

    expect(root.querySelector('[role="alert"]')?.textContent).toContain('next action')
    expect(store.currentTask()).toBeNull()
  })

  it('conserve la saisie quand le formulaire est refusé', async () => {
    await openForm()
    type('new-next', 'Map the existing entry points')
    root.querySelector<HTMLFormElement>('#create-task')!.requestSubmit()
    await settled()

    expect(root.querySelector<HTMLInputElement>('#new-next')!.value).toBe(
      'Map the existing entry points',
    )
  })

  it('guide vers l’agent juste après la création, sans expliquer le protocole', async () => {
    await openForm()
    type('new-title', 'Refactor the authentication module')
    type('new-next', 'Map the existing entry points')
    root.querySelector<HTMLFormElement>('#create-task')!.requestSubmit()
    await settled(8)

    const guide = root.querySelector('.card--guide')!
    expect(guide.textContent).toContain('Ready for your AI')
    expect(guide.textContent).toContain('Continue this task.')

    for (const jargon of ['based_on_version', 'mutation_id', 'IndexedDB']) {
      expect(guide.textContent, jargon).not.toContain(jargon)
    }
    expect(root.querySelector('details.technical')!.textContent).toContain('based_on_version')
  })
})

describe('démonstration', () => {
  it('« Try the demo » charge le cahier préparé', async () => {
    await settled()
    button('Try the demo').click()
    await settled(8)

    const task = store.currentTask()!
    expect(task.title).toBe(buildDemoTask().title)
    expect(task.steps.length).toBeGreaterThan(0)
    expect(location.pathname).toBe(`/t/${task.id}`)
  })
})

describe('tableau de bord', () => {
  beforeEach(async () => {
    await store.openPreparedTask(buildDemoTask())
    await settled()
  })

  it('montre les quatre concepts essentiels, dans l’ordre', async () => {
    const titles = [...root.querySelectorAll('h2')].map((h) => h.textContent?.trim() ?? '')
    const wanted = ['Next', 'Completed work', 'Rules to follow', 'Don’t retry']
    for (const w of wanted) expect(titles, w).toContain(w)

    const positions = wanted.map((w) => titles.indexOf(w))
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })

  it('rend la prochaine action dominante', async () => {
    const hero = root.querySelector('.hero')!
    expect(hero.textContent).toContain('Implement approach C')
  })

  it('nomme les trois degrés de preuve en clair', async () => {
    expect(text()).toContain('Verified by you')
    expect(text()).toContain('Evidence attached')
    expect(text()).toContain('Claimed without evidence')
    expect(text()).not.toContain('machine_verified')
  })

  it('sépare les propositions d’agent des règles contraignantes', async () => {
    const pending = proposedRejections(store.currentTask()!)[0]

    const proposals = root.querySelector('.card--proposals')!
    expect(proposals.textContent).toContain(pending.approach)
    expect(proposals.textContent).toContain('no effect until you accept them')

    const dontRetry = [...root.querySelectorAll('.card')].find((c) =>
      c.querySelector('h2')?.textContent?.includes('Don’t retry'),
    )!
    expect(dontRetry.textContent).not.toContain(pending.approach)
  })

  it('rend une proposition opposable d’un clic, et pas avant', async () => {
    const pending = proposedRejections(store.currentTask()!)[0]
    expect(acceptedRejections(store.currentTask()!).map((r) => r.id)).not.toContain(pending.id)

    root.querySelector<HTMLButtonElement>(`[data-accept="${pending.id}"]`)!.click()
    await settled()

    expect(acceptedRejections(store.currentTask()!).map((r) => r.id)).toContain(pending.id)
    expect(store.currentTask()!.audit.at(-1)).toMatchObject({
      operation: 'accept_rejection',
      actor: 'human',
    })
  })

  it('écarte une proposition sans l’effacer', async () => {
    const pending = proposedRejections(store.currentTask()!)[0]
    root.querySelector<HTMLButtonElement>(`[data-decline="${pending.id}"]`)!.click()
    await settled()

    const after = store.currentTask()!
    expect(proposedRejections(after)).toHaveLength(0)
    expect(after.rejected.map((r) => r.id)).toContain(pending.id)
  })

  it('affiche le contenu de la preuve AVANT le bouton qui la valide', async () => {
    const verify = root.querySelector<HTMLButtonElement>('[data-verify]')!
    const item = verify.closest('li')!
    const evidence = item.querySelector('pre')

    expect(evidence).not.toBeNull()
    const step = store.currentTask()!.steps.find((s) => s.id === verify.dataset.verify)!
    expect(evidence!.textContent).toBe(step.evidence!.content)
  })

  it('valide une preuve, seul chemin vers « verified »', async () => {
    const verify = root.querySelector<HTMLButtonElement>('[data-verify]')!
    const id = verify.dataset.verify!
    verify.click()
    await settled()

    const step = store.currentTask()!.steps.find((s) => s.id === id)!
    expect(step.confidence).toBe('human_verified')
    expect(step.evidence!.verifiedAt).not.toBeNull()
  })

  it('replie les détails techniques par défaut', async () => {
    const details = root.querySelector<HTMLDetailsElement>('details.technical')!
    expect(details.open).toBe(false)
    expect(details.querySelector('summary')?.textContent?.trim()).toBe('Technical details')

    const body = details.textContent ?? ''
    expect(body).toContain('Task ID')
    expect(body).toContain('getTools()')
    expect(body).toContain('Lifecycle')
    expect(body).toContain('resume_task')
  })

  it('garde le rendu brut de resume_task sous les détails', async () => {
    const pre = root.querySelector('details.technical pre')!
    expect(pre.textContent).toBe(renderTaskState(store.currentTask()!))
  })

  it('ajoute une règle humaine, immédiatement opposable', async () => {
    const before = activeConstraints(store.currentTask()!).length
    type('new-constraint', 'Do not touch the router')
    root.querySelector<HTMLFormElement>('#form-constraint')!.requestSubmit()
    await settled()

    const rules = activeConstraints(store.currentTask()!)
    expect(rules).toHaveLength(before + 1)
    expect(rules.at(-1)).toMatchObject({ source: 'human', standing: 'accepted', active: true })
  })

  it('lève puis rétablit une règle, et la restitution suit', async () => {
    const rule = activeConstraints(store.currentTask()!)[0].rule
    root.querySelector<HTMLButtonElement>('[data-toggle]')!.click()
    await settled()

    expect(renderTaskState(store.currentTask()!)).not.toContain(rule)

    root.querySelector<HTMLButtonElement>('[data-toggle]')!.click()
    await settled()
    expect(renderTaskState(store.currentTask()!)).toContain(rule)
  })

  it('condamne une approche, marquée humaine', async () => {
    type('new-rejection', 'Client-side rotation')
    type('new-rejection-reason', 'exposes the token to the browser')
    root.querySelector<HTMLFormElement>('#form-rejection')!.requestSubmit()
    await settled()

    const last = acceptedRejections(store.currentTask()!).at(-1)!
    expect(last).toMatchObject({ approach: 'Client-side rotation', source: 'human' })
    expect(renderTaskState(store.currentTask()!)).toContain('Client-side rotation')
  })

  it('refuse un motif vide, en langage humain', async () => {
    type('new-rejection', 'Some approach')
    root.querySelector<HTMLFormElement>('#form-rejection')!.requestSubmit()
    await settled()

    const alert = root.querySelector('[role="alert"]')?.textContent ?? ''
    expect(alert).toContain('the reason cannot be empty')
    expect(alert).not.toContain('INVALID INPUT')
  })
})

describe('supervision pendant qu’un agent travaille', () => {
  beforeEach(async () => {
    await store.openPreparedTask(buildDemoTask())
    await settled()
  })

  it('rend un refus pour état périmé immédiatement visible, en langage humain', async () => {
    const stale = store.currentTask()!.version

    await store.mutate((s) =>
      addConstraint(s, { rule: 'No new dependency', basedOnVersion: null }, 'human'),
    )

    await store
      .mutateAsAgent({
        operation: 'log_step',
        basedOnVersion: stale,
        mutationId: mutationId(),
        fingerprint: 'stale-fp',
        mutate: (s) => logStep(s, { action: 'a', result: 'b', basedOnVersion: stale }, 'agent'),
        render: (n) => `v${n.version}`,
      })
      .catch(() => undefined)
    await settled()

    const notice = root.querySelector('.notice--stale')
    expect(notice).not.toBeNull()
    expect(notice!.textContent).toContain(
      'The task changed while the agent was working. It must read the log again.',
    )
    expect(notice!.textContent).not.toContain('STALE STATE')
    expect(notice!.textContent).not.toContain('based_on_version')
  })

  it('conserve la saisie humaine quand l’agent écrit pendant la frappe', async () => {
    type('new-constraint', 'Do not touch the rou')
    const field = root.querySelector<HTMLInputElement>('#new-constraint')!
    field.focus()
    field.setSelectionRange(20, 20)

    await store.mutateAsAgent({
      operation: 'log_step',
      basedOnVersion: store.currentTask()!.version,
      mutationId: mutationId(),
      fingerprint: 'concurrent-fp',
      mutate: (s) =>
        logStep(s, { action: 'agent step', result: 'done', basedOnVersion: s.version }, 'agent'),
      render: (n) => `v${n.version}`,
    })
    await settled()

    const after = root.querySelector<HTMLInputElement>('#new-constraint')!
    expect(after.value).toBe('Do not touch the rou')
    expect(document.activeElement).toBe(after)
    expect(after.selectionStart).toBe(20)
  })
})

describe('tâche close', () => {
  beforeEach(async () => {
    await store.openPreparedTask(buildDemoTask())
    await store.mutate((s) =>
      completeTask(s, { summary: 'Approach C shipped.', basedOnVersion: null }, 'human'),
    )
    await settled()
  })

  it('annonce la clôture et son résumé', async () => {
    expect(text()).toContain('Task closed')
    expect(text()).toContain('Approach C shipped.')
  })

  it('retire les formulaires d’écriture humaine', async () => {
    expect(root.querySelector('#form-constraint')).toBeNull()
    expect(root.querySelector('#form-rejection')).toBeNull()
  })

  it('laisse l’humain rouvrir ce que l’agent a clos', async () => {
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('Rotation still needs measuring')
    button('Reopen this task').click()
    await settled()

    const task = store.currentTask()!
    expect(task.status).toBe('active')
    expect(task.next).toBe('Rotation still needs measuring')
    expect(text()).toContain('Rotation still needs measuring')
    prompt.mockRestore()
  })
})

describe('détails techniques', () => {
  it('montre les outils relus par getTools() et la politique de retrait', async () => {
    const fake = installModelContext()
    __resetRegistration()
    await store.openPreparedTask(buildDemoTask())
    await registerTools()
    await settled()

    const details = root.querySelector('details.technical')!.textContent ?? ''
    expect(details).toContain('log_step')

    expect(details).toContain('Observed through')
    expect(details).not.toMatch(/what the agent sees/i)

    expect(details).toContain('Lifecycle')
    expect(details).toContain('static')
    expect(fake.names()).toContain('log_step')

    __resetRegistration()
    removeModelContext()
  })
})
