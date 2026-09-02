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
import { __renderNow, mount, NOTICE_TTL } from '../src/ui/bench'
import { resetCalls } from '../src/webmcp/witness'
import { __resetRegistration, registerTools } from '../src/webmcp/register'
import { ALL_TOOLS } from '../src/webmcp/tools'
import {
  clearDatabase,
  installModelContext,
  mutationId,
  removeModelContext,
  textOf,
  waitUntil,
} from './helpers'

let root: HTMLElement
let unmount: () => void

/**
 * Waiting a fixed number of turns was enough on an empty run and failed in the
 * full suite: the write queue goes through IndexedDB, whose latency depends on
 * the load. Wait for the effect, not for a delay.
 */
async function settled(turns = 4) {
  for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0))
  __renderNow()
}

async function written(before: number) {
  await waitUntil(() => (store.currentTask()?.version ?? 0) > before, 'the write to be applied')
  __renderNow()
}

function type(id: string, value: string) {
  const field = root.querySelector<HTMLInputElement>(`#${id}`)
  if (!field) throw new Error(`field #${id} absent`)
  field.value = value
  field.dispatchEvent(new Event('input', { bubbles: true }))
}

function button(label: string): HTMLButtonElement {
  const found = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === label,
  )
  if (!found) throw new Error(`button “${label}” is missing`)
  return found
}

const text = () => root.textContent?.replace(/\s+/g, ' ') ?? ''

beforeEach(async () => {
  store.__resetStore()
  resetCalls()
  await clearDatabase()
  await store.init()
  history.replaceState(null, '', '/')
  document.body.innerHTML = '<div id="announcements"></div><div id="app"></div>'
  root = document.querySelector<HTMLElement>('#app')!
  unmount = mount(root)
})

afterEach(() => {
  unmount()
  history.replaceState(null, '', '/')
})

describe('first visit', () => {
  it('says what the screen is, without jargon', async () => {
    await settled()

    expect(text()).toContain('Open the task your agent will read')
    expect(text()).toContain('the first thing an agent reads')

    for (const jargon of ['based_on_version', 'mutation_id', 'IndexedDB', 'AbortController']) {
      expect(text(), jargon).not.toContain(jargon)
    }
  })

  /**
   * There used to be two ways in, and the prominent one opened a prepared
   * demonstration. A demonstration is not the product : the first screen now
   * offers the form that creates a real task, and nothing else.
   */
  it('offers one way in, and it creates a real task', async () => {
    await settled()

    const primary = root.querySelector<HTMLButtonElement>('.btn--primary')
    expect(primary?.textContent?.trim()).toBe('Create task')
    expect(root.querySelector('#create-task')).toBeTruthy()
    expect(root.querySelector('#new-title')).toBeTruthy()

    const labels = [...root.querySelectorAll('button')].map((b) => b.textContent?.trim())
    expect(labels).not.toContain('Explore the live demo')
  })

  /**
   * The badge used to read “WebMCP ready” in every state that was not
   * `registered`, so a browser carrying no WebMCP at all was told the page was
   * ready to serve tools it could never register. The honest message is the
   * point of the product, and the badge is the most prominent place it appears.
   */
  it('says WebMCP is unavailable when the browser carries no API', async () => {
    await settled()

    const badge = root.querySelector('.webmcp-badge')
    expect(badge?.textContent).toContain('WebMCP unavailable · 14 task tools')
    expect(badge?.textContent).not.toContain('ready')
    expect(badge?.className).toContain('webmcp-badge--off')
  })

  it('states the WebMCP position before a task is opened', async () => {
    await settled()
    expect(root.querySelector('.webmcp-badge')?.textContent).toContain('14 task tools')
  })

  /**
   * The product's surface is the task, not a page about the task. The first
   * screen used to carry a pitch, three illustrated cards and a tool catalogue
   * above the only two actions that do anything. None of it is the product, and
   * a visitor who lands here wants the surface, so it is gone.
   */
  it('sells nothing : no pitch, no decoration, only the way in', async () => {
    await settled()

    // The brand mark in the top bar is the chrome, not decoration. Everything
    // else that was on this screen existed to illustrate a pitch.
    const decorative = [...root.querySelectorAll('img')].filter(
      (image) => !image.classList.contains('brand__mark'),
    )
    expect(decorative).toHaveLength(0)
    for (const pitch of [
      'Why WebMCP matters',
      'Give every agent the context',
      '4 read tools are always available',
    ]) {
      expect(text(), pitch).not.toContain(pitch)
    }

    const actions = [...root.querySelectorAll('button')].map((b) => b.textContent?.trim())
    expect(actions).toContain('Create task')
  })

  it('contains no account or authentication actions', async () => {
    await settled()
    const labels = [...root.querySelectorAll('a, button')]
      .map((element) => element.textContent?.trim() ?? '')
      .join(' ')

    expect(labels).not.toMatch(/log in|login|sign in|sign up|register|account/i)
  })
})

describe('creating a task', () => {
  // The creation form is the first screen : with no task on the device there
  // is nothing else to show, so there is no longer a button to open it.
  async function openForm() {
    await settled()
  }

  /**
   * Focus used to land on the title because the form opened on a click, which
   * is where a click should send it. The form is now the screen itself, and
   * moving focus on load would carry a screen reader past the heading and past
   * the WebMCP status before either had been read. The field is the first thing
   * a Tab reaches, which is enough.
   */
  it('does not steal focus on load, and puts the title first in the order', async () => {
    await openForm()

    expect(document.activeElement?.id).not.toBe('new-title')

    // The top bar legitimately comes first on the page; the title is the first
    // thing reachable inside the form itself.
    const form = root.querySelector('#create-task')!
    const focusable = [...form.querySelectorAll<HTMLElement>('input, textarea, select, button')]
    expect(focusable[0]?.id).toBe('new-title')
  })

  it('creates a real task and keeps the title, the next action and the first rule', async () => {
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

  it('puts focus on the title after creation, and leaves it there', async () => {
    await openForm()
    type('new-title', 'Add rate limiting to our HTTP API')
    type('new-next', 'Choose the mechanism')
    root.querySelector<HTMLFormElement>('#create-task')!.requestSubmit()
    await settled(8)

    expect(document.activeElement?.tagName).toBe('H1')
    expect(document.activeElement?.textContent).toBe('Add rate limiting to our HTTP API')
  })

  it('links the task to /t/:id', async () => {
    await openForm()
    type('new-title', 'Ship the invoice export')
    type('new-next', 'List the current columns')
    root.querySelector<HTMLFormElement>('#create-task')!.requestSubmit()
    await settled(8)

    expect(location.pathname).toBe(`/t/${store.currentTask()!.id}`)
  })

  it('refuses an empty title in human words, without writing anything', async () => {
    await openForm()
    type('new-next', 'Map the existing entry points')
    root.querySelector<HTMLFormElement>('#create-task')!.requestSubmit()
    await settled()

    expect(root.querySelector('[role="alert"]')?.textContent).toContain('give the task a title')
    expect(store.currentTask()).toBeNull()
    expect(document.activeElement?.id).toBe('new-title')
  })

  it('refuses an empty next action, and says why it matters', async () => {
    await openForm()
    type('new-title', 'Something')
    root.querySelector<HTMLFormElement>('#create-task')!.requestSubmit()
    await settled()

    expect(root.querySelector('[role="alert"]')?.textContent).toContain('next action')
    expect(store.currentTask()).toBeNull()
  })

  it('keeps what was typed when the form is refused', async () => {
    await openForm()
    type('new-next', 'Map the existing entry points')
    root.querySelector<HTMLFormElement>('#create-task')!.requestSubmit()
    await settled()

    expect(root.querySelector<HTMLInputElement>('#new-next')!.value).toBe(
      'Map the existing entry points',
    )
  })

  it('points to the agent right after creation, without explaining the protocol', async () => {
    await openForm()
    type('new-title', 'Refactor the authentication module')
    type('new-next', 'Map the existing entry points')
    root.querySelector<HTMLFormElement>('#create-task')!.requestSubmit()
    await settled(8)

    const guide = root.querySelector('.card--guide')!
    expect(guide.textContent).toContain('Ready for WebMCP')
    expect(guide.textContent).toContain('Continue this task.')

    for (const jargon of ['based_on_version', 'mutation_id', 'IndexedDB']) {
      expect(guide.textContent, jargon).not.toContain(jargon)
    }
    expect(root.querySelector('details.technical')!.textContent).toContain('based_on_version')
  })
})

describe('demo', () => {
  /**
   * The prepared notebook survives as a fixture and as the measurement's
   * starting state, reachable through `?measure=N`. What is gone is the button
   * that offered it as a way into the product : opening a demonstration is not
   * using the product, and the first screen now creates a real task instead.
   */
  it('is no longer offered as a way into the product', async () => {
    await settled()

    const labels = [...root.querySelectorAll('button')].map((b) => b.textContent?.trim())
    expect(labels).not.toContain('Explore the live demo')
    expect(root.querySelector('#seed')).toBeNull()
  })

  it('still builds a coherent prepared task, used by the measurement', async () => {
    await store.openPreparedTask(buildDemoTask())
    await settled(8)

    const task = store.currentTask()!
    expect(task.title).toBe(buildDemoTask().title)
    expect(task.steps.length).toBeGreaterThan(0)
    expect(location.pathname).toBe(`/t/${task.id}`)
  })
})

describe('dashboard', () => {
  beforeEach(async () => {
    await store.openPreparedTask(buildDemoTask())
    await settled()
  })

  it('shows the four essential ideas, in order', async () => {
    const titles = [...root.querySelectorAll('h2')].map((h) => h.textContent?.trim() ?? '')
    const wanted = ['Next', 'Completed work', 'Rules to follow', 'Don’t retry']
    for (const w of wanted) expect(titles, w).toContain(w)

    const positions = wanted.map((w) => titles.indexOf(w))
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })

  it('makes the next action dominant', async () => {
    const hero = root.querySelector('.hero')!
    expect(hero.textContent).toContain('Implement approach C')
  })

  it('names the three degrees of proof in plain words', async () => {
    expect(text()).toContain('Verified by you')
    expect(text()).toContain('Evidence attached')
    expect(text()).toContain('Claimed without evidence')
    expect(text()).not.toContain('machine_verified')
  })

  it('separates agent proposals from binding rules', async () => {
    const pending = proposedRejections(store.currentTask()!)[0]

    const proposals = root.querySelector('.card--proposals')!
    expect(proposals.textContent).toContain(pending.approach)
    expect(proposals.textContent).toContain('no effect until you accept them')

    const dontRetry = [...root.querySelectorAll('.card')].find((c) =>
      c.querySelector('h2')?.textContent?.includes('Don’t retry'),
    )!
    expect(dontRetry.textContent).not.toContain(pending.approach)
  })

  it('makes a proposal binding in one click, and not before', async () => {
    const pending = proposedRejections(store.currentTask()!)[0]
    expect(acceptedRejections(store.currentTask()!).map((r) => r.id)).not.toContain(pending.id)

    const before = store.currentTask()!.version
    root.querySelector<HTMLButtonElement>(`[data-accept="${pending.id}"]`)!.click()
    await written(before)

    expect(acceptedRejections(store.currentTask()!).map((r) => r.id)).toContain(pending.id)
    expect(store.currentTask()!.audit.at(-1)).toMatchObject({
      operation: 'accept_rejection',
      actor: 'human',
    })
  })

  it('declines a proposal without erasing it', async () => {
    const pending = proposedRejections(store.currentTask()!)[0]
    const before = store.currentTask()!.version
    root.querySelector<HTMLButtonElement>(`[data-decline="${pending.id}"]`)!.click()
    await written(before)

    const after = store.currentTask()!
    expect(proposedRejections(after)).toHaveLength(0)
    expect(after.rejected.map((r) => r.id)).toContain(pending.id)
  })

  it('shows the evidence itself BEFORE the button that confirms it', async () => {
    const verify = root.querySelector<HTMLButtonElement>('[data-verify]')!
    const item = verify.closest('li')!
    const evidence = item.querySelector('pre')

    expect(evidence).not.toBeNull()
    const step = store.currentTask()!.steps.find((s) => s.id === verify.dataset.verify)!
    expect(evidence!.textContent).toBe(step.evidence!.content)
  })

  it('confirms evidence, the only path to “verified”', async () => {
    const verify = root.querySelector<HTMLButtonElement>('[data-verify]')!
    const id = verify.dataset.verify!
    const before = store.currentTask()!.version
    verify.click()
    await written(before)

    const step = store.currentTask()!.steps.find((s) => s.id === id)!
    expect(step.confidence).toBe('human_verified')
    expect(step.evidence!.verifiedAt).not.toBeNull()
  })

  it('keeps the technical details collapsed by default', async () => {
    const details = root.querySelector<HTMLDetailsElement>('details.technical')!
    expect(details.open).toBe(false)
    expect(details.querySelector('summary')?.textContent?.trim()).toBe(
      'WebMCP status and developer details',
    )

    const body = details.textContent ?? ''
    expect(body).toContain('Task ID')
    expect(body).toContain('getTools()')
    expect(body).toContain('Lifecycle')
    expect(body).toContain('resume_task')
  })

  it('shows exactly what resume_task returns, not a near version', async () => {
    // The panel is titled "What resume_task returns". If it rendered the state
    // without the URL or the credentials, it would show something other than
    // what the agent receives, in a product whose whole value is honesty.
    const resume = ALL_TOOLS.find((t) => t.name === 'resume_task')!
    const expected = textOf(await resume.execute({}, { signal: new AbortController().signal }))
    await settled()

    const pre = root.querySelector('details.technical pre')!
    expect(pre.textContent).toBe(expected)
    expect(pre.textContent).toContain('URL')
  })

  it('adds a human rule, binding immediately', async () => {
    const before = activeConstraints(store.currentTask()!).length
    const version = store.currentTask()!.version
    type('new-constraint', 'Do not touch the router')
    root.querySelector<HTMLFormElement>('#form-constraint')!.requestSubmit()
    await written(version)

    const rules = activeConstraints(store.currentTask()!)
    expect(rules).toHaveLength(before + 1)
    expect(rules.at(-1)).toMatchObject({ source: 'human', standing: 'accepted', active: true })
  })

  it('lifts then restores a rule, and what the agent reads follows', async () => {
    const rule = activeConstraints(store.currentTask()!)[0].rule

    let before = store.currentTask()!.version
    root.querySelector<HTMLButtonElement>('[data-toggle]')!.click()
    await written(before)
    expect(renderTaskState(store.currentTask()!)).not.toContain(rule)

    before = store.currentTask()!.version
    root.querySelector<HTMLButtonElement>('[data-toggle]')!.click()
    await written(before)
    expect(renderTaskState(store.currentTask()!)).toContain(rule)
  })

  it('condemns an approach, marked as human', async () => {
    const before = store.currentTask()!.version
    type('new-rejection', 'Client-side rotation')
    type('new-rejection-reason', 'exposes the token to the browser')
    root.querySelector<HTMLFormElement>('#form-rejection')!.requestSubmit()
    await written(before)

    const last = acceptedRejections(store.currentTask()!).at(-1)!
    expect(last).toMatchObject({ approach: 'Client-side rotation', source: 'human' })
    expect(renderTaskState(store.currentTask()!)).toContain('Client-side rotation')
  })

  it('refuses an empty reason, in human words', async () => {
    type('new-rejection', 'Some approach')
    root.querySelector<HTMLFormElement>('#form-rejection')!.requestSubmit()
    await settled()

    const alert = root.querySelector('[role="alert"]')?.textContent ?? ''
    expect(alert).toContain('the reason cannot be empty')
    expect(alert).not.toContain('INVALID INPUT')
  })
})

describe('supervision while an agent works', () => {
  beforeEach(async () => {
    await store.openPreparedTask(buildDemoTask())
    await settled()
  })

  it('makes a refusal for a stale state visible at once, in human words', async () => {
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

  it('keeps what the human is typing while the agent writes', async () => {
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

describe('closed task', () => {
  beforeEach(async () => {
    await store.openPreparedTask(buildDemoTask())
    await store.mutate((s) =>
      completeTask(s, { summary: 'Approach C shipped.', basedOnVersion: null }, 'human'),
    )
    await settled()
  })

  it('announces the closing and its summary', async () => {
    expect(text()).toContain('Task closed')
    expect(text()).toContain('Approach C shipped.')
  })

  it('removes the human writing forms', async () => {
    expect(root.querySelector('#form-constraint')).toBeNull()
    expect(root.querySelector('#form-rejection')).toBeNull()
  })

  it('lets the human reopen what the agent closed', async () => {
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('Rotation still needs measuring')
    const before = store.currentTask()!.version
    button('Reopen this task').click()
    await written(before)

    const task = store.currentTask()!
    expect(task.status).toBe('active')
    expect(task.next).toBe('Rotation still needs measuring')
    expect(text()).toContain('Rotation still needs measuring')
    prompt.mockRestore()
  })
})

describe('the WebMCP badge tells the truth about the browser', () => {
  it('reads “ready” only where the API is actually present', async () => {
    installModelContext()
    __resetRegistration()
    await settled()

    const badge = root.querySelector('.webmcp-badge')
    expect(badge?.textContent).toContain('WebMCP ready · 14 task tools')
    expect(badge?.className).not.toContain('webmcp-badge--off')

    removeModelContext()
  })

  it('reads “active” once the tools are registered, and counts them', async () => {
    installModelContext()
    __resetRegistration()
    await store.openPreparedTask(buildDemoTask())
    await registerTools()
    await settled()

    const badge = root.querySelector('.webmcp-badge')
    expect(badge?.textContent).toContain(`WebMCP active · ${ALL_TOOLS.length - 1} tools`)
    expect(badge?.className).toContain('webmcp-badge--active')

    __resetRegistration()
    removeModelContext()
  })
})

describe('technical details', () => {
  it('shows the tools getTools() reads back and the withdrawal policy', async () => {
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

describe('a success message does not settle in', () => {
  let root: HTMLElement
  let unmount: () => void

  async function settled(turns = 8) {
    for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0))
    __renderNow()
  }

  beforeEach(async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
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
    vi.useRealTimers()
    history.replaceState(null, '', '/')
  })

  it('clears itself, instead of claiming forever that something was just copied', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.resolve() },
    })

    root.querySelector<HTMLButtonElement>('#copy-handoff')!.click()
    await waitUntil(() => !!root.querySelector('.notice--ok'), 'the copy message')
    __renderNow()
    expect(root.querySelector('.notice--ok')!.textContent).toContain('Copied')

    await vi.advanceTimersByTimeAsync(NOTICE_TTL + 1000)
    __renderNow()

    // A notice that stays claims, a minute later, that an action has just
    // happened. It has to be read as false.
    expect(root.querySelector('.notice--ok')).toBeNull()
  })
})

describe('the live region does not outlive its screen', () => {
  let root: HTMLElement
  let unmount: () => void

  beforeEach(async () => {
    store.__resetStore()
    resetCalls()
    await clearDatabase()
    await store.init()
    history.replaceState(null, '', '/')
    document.body.innerHTML = '<div id="announcements"></div><div id="app"></div>'
    root = document.querySelector<HTMLElement>('#app')!
    unmount = mount(root)
  })

  afterEach(() => {
    unmount()
    history.replaceState(null, '', '/')
  })

  /**
   * `announce()` returned early with no task and left the previous screen's
   * sentence standing, so leaving a task still announced "0 steps recorded"
   * about a task no longer shown. A live region nobody clears is a screen that
   * lies to the one person who cannot check it.
   */
  it('clears the announcement when no task is on screen', async () => {
    await store.openPreparedTask(buildDemoTask())
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0))
    __renderNow()

    const region = document.querySelector('#announcements')!
    expect(region.textContent?.trim()).not.toBe('')

    // `init()` reopens the last task from IndexedDB, so the store has to be
    // genuinely empty for the screen to carry no task at all.
    store.__resetStore()
    await clearDatabase()
    await store.init()
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0))
    __renderNow()

    expect(store.currentTask()).toBeNull()
    expect(region.textContent?.trim()).toBe('')
  })
})
