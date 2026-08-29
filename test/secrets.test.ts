import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildCoreTask as buildDemoTask } from '../src/demo/seed'
import { estimateTokens, renderTaskState, TOKEN_BUDGET } from '../src/domain/render'
import { buildFullExport, buildTaskExport } from '../src/export/notebook'
import { addSecret, listSecretNames } from '../src/persistence/vault'
import { getDb } from '../src/persistence/db'
import * as store from '../src/store/taskStore'
import { ALL_TOOLS, readTaskDetailTool, resumeTaskTool } from '../src/webmcp/tools'
import { __renderNow, mount } from '../src/ui/bench'
import { call, clearDatabase, textOf } from './helpers'

const VALUE = 'AIzaSyD-this-exact-string-must-never-escape'
const PASSPHRASE = 'correct horse battery staple'

let root: HTMLElement
let unmount: () => void

async function settled(turns = 6) {
  for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0))
  __renderNow()
}

async function waitFor(condition: () => boolean, label: string, timeout = 15_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    await settled(2)
    if (condition()) return
  }
  throw new Error(`timed out : ${label}`)
}

async function clearVault() {
  const db = await getDb()
  const tx = db.transaction('secrets', 'readwrite')
  await Promise.all([tx.store.clear(), tx.done])
}

beforeEach(async () => {
  store.__resetStore()
  await clearDatabase()
  await clearVault()
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

async function withSecret() {
  // The secret exists before the task is opened: that is the real order, and it
  // is also the only one that guarantees the first render sees it.
  const task = buildDemoTask()
  await addSecret({
    taskId: task.id,
    name: 'gemini-api-key',
    purpose: 'Calls the Gemini API from the ingestion script',
    value: VALUE,
    passphrase: PASSPHRASE,
  })
  await store.openPreparedTask(task)
  // The condition targets the row, not the name: `gemini-api-key` is also the
  // form's placeholder text, and the wait ended on it straight away.
  await waitFor(() => root.querySelector('[data-reveal]') !== null, 'sealed name display')
  return task
}

describe('what the agent receives', () => {
  it('quotes the name and the purpose, never the value', async () => {
    await withSecret()

    const rendered = textOf(await call(resumeTaskTool))
    expect(rendered).toContain('CREDENTIALS')
    // The name is exact, always: it is what the agent copies out.
    expect(rendered).toContain('${gemini-api-key}')
    // The purpose is prose, and can be shortened under the budget.
    expect(rendered).toContain('Calls the Gemini API')
    expect(rendered).not.toContain(VALUE)
    expect(rendered).not.toContain(PASSPHRASE)
  })

  it('tells the agent to write the reference, and that no tool returns a value', async () => {
    await withSecret()
    const rendered = textOf(await call(resumeTaskTool))
    expect(rendered).toContain('Write these as ${name}')
    expect(rendered).toContain('no tool here returns a value')
  })

  it('lets NO tool return the value, whichever one it is', async () => {
    const task = await withSecret()

    const outputs: string[] = []
    for (const tool of ALL_TOOLS) {
      const input =
        tool.name === 'read_task_detail'
          ? { section: 'steps' }
          : tool.name === 'resume_task'
            ? {}
            : {
                action: 'a',
                result: 'b',
                rule: 'r',
                approach: 'a',
                reason: 'r',
                choice: 'c',
                rationale: 'r',
                summary: 's',
                based_on_version: task.version,
                mutation_id: `secret-probe-${tool.name}`,
              }
      outputs.push(textOf(await call(tool, input)))
    }

    // The guarantee is structural: a secret does not live in TaskState, so no
    // tool output can contain one, even by accident.
    for (const out of outputs) {
      expect(out).not.toContain(VALUE)
      expect(out).not.toContain(PASSPHRASE)
    }
  })

  it('puts nothing in the task state, neither the value nor the ciphertext', async () => {
    await withSecret()
    const serialised = JSON.stringify(store.currentTask())

    expect(serialised).not.toContain(VALUE)
    expect(serialised).not.toContain(PASSPHRASE)
    expect(serialised).not.toContain('gemini-api-key')
    expect(serialised).not.toContain('ciphertext')
  })

  it('writes nothing into the export, not even the ciphertext', async () => {
    const task = await withSecret()

    for (const dump of [buildTaskExport(store.currentTask()!), buildFullExport([task])]) {
      expect(dump).not.toContain(VALUE)
      expect(dump).not.toContain(PASSPHRASE)
      expect(dump).not.toContain('ciphertext')
    }
  })

  it('bounds the cost: thirty credentials cost no more than two', async () => {
    const task = buildDemoTask()
    const creds = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `s${i}`,
        name: `service-${i}-api-key`,
        purpose: 'Calls the upstream service from the ingestion worker',
        kind: 'api_key' as const,
      }))

    const twoTokens = estimateTokens(renderTaskState(task, { credentials: creds(2) }))
    const thirtyTokens = estimateTokens(renderTaskState(task, { credentials: creds(30) }))

    // The cost is bounded, not proportional: compared against what the
    // twenty-eight extra names would cost if all rendered, and required to stay
    // under a fifth. 17 tokens against 131, 13%. A hardcoded threshold would
    // not say why and would drift with every rewording; this one already went
    // from 5 to 20 when a shortened sentence let one more name fit.
    //
    // No unit price by difference: the output for two credentials is shorter
    // than for one, the degradation ladder trimming elsewhere as room runs out.
    // That is what bounds the cost.
    const twentyEightNames = estimateTokens(
      creds(30)
        .slice(2)
        .map((c) => c.name)
        .join('\n'),
    )
    expect(thirtyTokens).toBeLessThanOrEqual(TOKEN_BUDGET)
    expect(thirtyTokens - twoTokens).toBeLessThan(twentyEightNames * 0.2)

    // A name is never truncated: an agent quoting `${service-1-api-k…}` writes
    // a false reference. Under pressure, fewer names, not shorter ones, and a
    // count of what is hidden.
    const output = renderTaskState(task, { credentials: creds(30) })
    expect(output).toMatch(/CREDENTIALS: names only, values sealed \(\d+ of 30\)/)
    expect(output).not.toMatch(/\$\{service-\d+-api-k…/)
  })

  it('sacrifices old work before hiding a credential name', () => {
    const task = buildDemoTask()
    const creds = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `s${i}`,
        name: `service-${i}-api-key`,
        purpose: 'Calls the upstream service from the ingestion worker',
        kind: 'api_key' as const,
      }))

    // The budget goes first on the older work, which is re-read page by page,
    // before touching the credentials.
    const without = renderTaskState(task)
    const withCreds = renderTaskState(task, { credentials: creds(4) })

    // Without credentials the budget holds two steps. With them it holds only
    // one: the older work pays, and it is re-read page by page.
    expect(without).toMatch(/RECENT WORK \(last 2 of 4\)/)
    expect(withCreds).toMatch(/RECENT WORK \(last 1 of 4\)/)
    expect(withCreds).toContain('${service-0-api-key}')
    expect(withCreds).toContain('${service-1-api-key}')
    expect(estimateTokens(withCreds)).toBeLessThanOrEqual(TOKEN_BUDGET)
  })

  it('says plainly that it hides some, rather than looking complete', () => {
    const output = renderTaskState(buildDemoTask(), {
      credentials: Array.from({ length: 8 }, (_, i) => ({
        id: `s${i}`,
        name: `service-${i}-api-key`,
        purpose: 'Calls the upstream service from the ingestion worker',
        kind: 'api_key' as const,
      })),
    })

    // The count is what counts: "2 of 8" tells the agent six are missing. The
    // section where to read them is declared by the read_task_detail schema,
    // which cannot drift, and does not take up the budget.
    expect(output).toMatch(/CREDENTIALS: names only, values sealed \(\d+ of 8\)/)
    expect(output).toContain('read_task_detail')

    const schema = readTaskDetailTool.inputSchema as {
      properties: { section: { enum: string[] } }
    }
    expect(schema.properties.section.enum).toContain('credentials')
  })

  it('renders exactly as before when there are no credentials', async () => {
    const task = buildDemoTask()
    expect(renderTaskState(task, { credentials: [] })).toBe(renderTaskState(task))
  })
})

describe('what the screen shows', () => {
  it('shows the name as a reference, and seals the value', async () => {
    await withSecret()

    const card = [...root.querySelectorAll('.card')].find((c) =>
      c.querySelector('h2')?.textContent?.includes('Credentials'),
    )!
    expect(card.textContent).toContain('${gemini-api-key}')
    expect(card.textContent).toContain('Calls the Gemini API')
    expect(card.textContent).toContain('never the value')

    // Nothing of the value in the DOM until someone asks to see it.
    expect(root.innerHTML).not.toContain(VALUE)
  })

  it('exposes the value only after a correct passphrase', async () => {
    await withSecret()

    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('wrong passphrase here')
    root.querySelector<HTMLButtonElement>('[data-reveal]')!.click()
    await waitFor(
      () => root.querySelector('[role="alert"]') !== null,
      'refus de la mauvaise phrase',
    )

    expect(root.innerHTML).not.toContain(VALUE)
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('does not open')

    prompt.mockReturnValue(PASSPHRASE)
    root.querySelector<HTMLButtonElement>('[data-reveal]')!.click()
    await waitFor(() => root.querySelector('[data-revealed]') !== null, 'reveal')

    expect(root.querySelector('[data-revealed]')?.textContent).toBe(VALUE)
    prompt.mockRestore()
  })

  it('folds the value back on the second click', async () => {
    await withSecret()
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue(PASSPHRASE)

    root.querySelector<HTMLButtonElement>('[data-reveal]')!.click()
    await waitFor(() => root.innerHTML.includes(VALUE), 'reveal')

    root.querySelector<HTMLButtonElement>('[data-reveal]')!.click()
    await waitFor(() => !root.innerHTML.includes(VALUE), 'repli')
    prompt.mockRestore()
  })

  it('seals a credential from the form, without keeping the value typed in', async () => {
    const task = await store.openPreparedTask(buildDemoTask())
    await settled()

    const set = (id: string, value: string) => {
      const field = root.querySelector<HTMLInputElement>(`#${id}`)!
      field.value = value
      field.dispatchEvent(new Event('input', { bubbles: true }))
    }
    set('new-secret-name', 'stripe-secret')
    set('new-secret-purpose', 'Charges cards in the billing worker')
    set('new-secret-value', VALUE)
    set('new-secret-passphrase', PASSPHRASE)
    root.querySelector<HTMLFormElement>('#form-secret')!.requestSubmit()
    await waitFor(() => root.innerHTML.includes('stripe-secret'), 'sealing')

    expect((await listSecretNames(task.id)).map((s) => s.name)).toContain('stripe-secret')

    // The value field is not kept between renders, unlike the other inputs: a
    // value put back into the DOM would be readable by an agent driving the
    // browser.
    expect(root.querySelector<HTMLInputElement>('#new-secret-value')!.value).toBe('')
    expect(root.querySelector<HTMLInputElement>('#new-secret-passphrase')!.value).toBe('')
    expect(root.innerHTML).not.toContain(VALUE)
  })

  it('refuses a name an agent could not quote', async () => {
    await store.openPreparedTask(buildDemoTask())
    await settled()

    const set = (id: string, value: string) => {
      const field = root.querySelector<HTMLInputElement>(`#${id}`)!
      field.value = value
      field.dispatchEvent(new Event('input', { bubbles: true }))
    }
    set('new-secret-name', 'has a space')
    set('new-secret-purpose', 'p')
    set('new-secret-value', 'v')
    set('new-secret-passphrase', PASSPHRASE)
    root.querySelector<HTMLFormElement>('#form-secret')!.requestSubmit()
    await waitFor(() => root.querySelector('[role="alert"]') !== null, 'name refusal')

    expect(root.querySelector('[role="alert"]')?.textContent).toBeTruthy()
    expect(root.querySelector('[role="alert"]')?.textContent).not.toContain('INVALID INPUT')
  })

  it('forgets what was revealed when the log changes', async () => {
    await withSecret()
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue(PASSPHRASE)
    root.querySelector<HTMLButtonElement>('[data-reveal]')!.click()
    await waitFor(() => root.innerHTML.includes(VALUE), 'reveal')

    await store.createAndOpenTask('Another task', 'Do something else')
    await waitFor(() => !root.innerHTML.includes(VALUE), 'changement de task')
    expect(root.textContent).toContain('No credentials yet.')
    prompt.mockRestore()
  })
})
