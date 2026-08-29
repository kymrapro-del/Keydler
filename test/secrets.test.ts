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
  throw new Error(`délai dépassé : ${label}`)
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
  document.body.innerHTML = '<div id="annonces"></div><div id="app"></div>'
  root = document.querySelector<HTMLElement>('#app')!
  unmount = mount(root)
})

afterEach(() => {
  unmount()
  history.replaceState(null, '', '/')
})

async function withSecret() {
  // The secret exists BEFORE the task is opened: that is the real order, and
  // it is also the only one that guarantees the first render sees it.
  const task = buildDemoTask()
  await addSecret({
    taskId: task.id,
    name: 'gemini-api-key',
    purpose: 'Calls the Gemini API from the ingestion script',
    value: VALUE,
    passphrase: PASSPHRASE,
  })
  await store.openPreparedTask(task)
  // The condition targets the ROW, not the name: `gemini-api-key` is also the
  // form's placeholder text, and the wait ended on it straight away.
  await waitFor(() => root.querySelector('[data-reveal]') !== null, 'affichage du nom scellé')
  return task
}

describe('ce que l’agent reçoit', () => {
  it('cite le nom et l’usage, jamais la valeur', async () => {
    await withSecret()

    const rendered = textOf(await call(resumeTaskTool))
    expect(rendered).toContain('CREDENTIALS')
    // The NAME is exact, always: it is what the agent copies out.
    expect(rendered).toContain('${gemini-api-key}')
    // The purpose is prose, and can be shortened under the budget.
    expect(rendered).toContain('Calls the Gemini API')
    expect(rendered).not.toContain(VALUE)
    expect(rendered).not.toContain(PASSPHRASE)
  })

  it('dit à l’agent d’écrire la référence, et qu’aucun outil ne rend de valeur', async () => {
    await withSecret()
    const rendered = textOf(await call(resumeTaskTool))
    expect(rendered).toContain('Write these as ${name}')
    expect(rendered).toContain('no tool here returns a value')
  })

  it('ne laisse AUCUN outil rendre la valeur, quel qu’il soit', async () => {
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

  it('ne met rien dans l’état de la tâche, ni la valeur ni le chiffré', async () => {
    await withSecret()
    const serialised = JSON.stringify(store.currentTask())

    expect(serialised).not.toContain(VALUE)
    expect(serialised).not.toContain(PASSPHRASE)
    expect(serialised).not.toContain('gemini-api-key')
    expect(serialised).not.toContain('ciphertext')
  })

  it('n’écrit rien dans l’export, pas même le chiffré', async () => {
    const task = await withSecret()

    for (const dump of [buildTaskExport(store.currentTask()!), buildFullExport([task])]) {
      expect(dump).not.toContain(VALUE)
      expect(dump).not.toContain(PASSPHRASE)
      expect(dump).not.toContain('ciphertext')
    }
  })

  it('borne le coût : trente identifiants ne coûtent pas plus que deux', async () => {
    const task = buildDemoTask()
    const creds = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `s${i}`,
        name: `service-${i}-api-key`,
        purpose: 'Calls the upstream service from the ingestion worker',
        kind: 'api_key' as const,
      }))

    const deux = estimateTokens(renderTaskState(task, { credentials: creds(2) }))
    const trente = estimateTokens(renderTaskState(task, { credentials: creds(30) }))

    // The cost is bounded, not proportional. It is compared against what the
    // twenty-eight extra names would cost if they were all rendered, and we
    // require staying under a fifth of that. Measured: 17 tokens against 131,
    // that is 13%. A hardcoded threshold would not say why
    // and would drift with every rewording: this one already had to go from 5
    // to 20 the day a sentence shortened and let one more name fit.
    //
    // We do NOT measure a unit price by difference: the output for two
    // credentials is SHORTER than the output for one, because the degradation
    // ladder trims elsewhere as soon as room runs out. That is exactly what
    // bounds the cost.
    const vingtHuitNoms = estimateTokens(
      creds(30)
        .slice(2)
        .map((c) => c.name)
        .join('\n'),
    )
    expect(trente).toBeLessThanOrEqual(TOKEN_BUDGET)
    expect(trente - deux).toBeLessThan(vingtHuitNoms * 0.2)

    // A NAME is never truncated: an agent quoting `${service-1-api-k…}` would
    // write a false reference. Under pressure we show fewer of them, we do not
    // shorten them, and we say how many are hidden.
    const output = renderTaskState(task, { credentials: creds(30) })
    expect(output).toMatch(/CREDENTIALS: names only, values sealed \(\d+ of 30\)/)
    expect(output).not.toMatch(/\$\{service-\d+-api-k…/)
  })

  it('sacrifie le travail ancien avant de cacher un nom d’identifiant', () => {
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

  it('dit clairement qu’il en cache, plutôt que de paraître complet', () => {
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

  it('rend une restitution sans identifiants identique à avant', async () => {
    const task = buildDemoTask()
    expect(renderTaskState(task, { credentials: [] })).toBe(renderTaskState(task))
  })
})

describe('ce que l’écran montre', () => {
  it('affiche le nom sous forme de référence, et scelle la valeur', async () => {
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

  it('n’expose la valeur qu’après une phrase de passe correcte', async () => {
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
    await waitFor(() => root.querySelector('[data-revealed]') !== null, 'révélation')

    expect(root.querySelector('[data-revealed]')?.textContent).toBe(VALUE)
    prompt.mockRestore()
  })

  it('replie la valeur au second clic', async () => {
    await withSecret()
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue(PASSPHRASE)

    root.querySelector<HTMLButtonElement>('[data-reveal]')!.click()
    await waitFor(() => root.innerHTML.includes(VALUE), 'révélation')

    root.querySelector<HTMLButtonElement>('[data-reveal]')!.click()
    await waitFor(() => !root.innerHTML.includes(VALUE), 'repli')
    prompt.mockRestore()
  })

  it('scelle un identifiant depuis le formulaire, sans garder la valeur saisie', async () => {
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
    await waitFor(() => root.innerHTML.includes('stripe-secret'), 'scellement')

    expect((await listSecretNames(task.id)).map((s) => s.name)).toContain('stripe-secret')

    // The value field is NOT kept between two renders, unlike the other inputs:
    // a value that a render put back into the DOM would be readable by an agent
    // driving the browser.
    expect(root.querySelector<HTMLInputElement>('#new-secret-value')!.value).toBe('')
    expect(root.querySelector<HTMLInputElement>('#new-secret-passphrase')!.value).toBe('')
    expect(root.innerHTML).not.toContain(VALUE)
  })

  it('refuse un nom qu’un agent ne pourrait pas citer', async () => {
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
    await waitFor(() => root.querySelector('[role="alert"]') !== null, 'refus du nom')

    expect(root.querySelector('[role="alert"]')?.textContent).toBeTruthy()
    expect(root.querySelector('[role="alert"]')?.textContent).not.toContain('INVALID INPUT')
  })

  it('oublie ce qui était révélé quand on change de cahier', async () => {
    await withSecret()
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue(PASSPHRASE)
    root.querySelector<HTMLButtonElement>('[data-reveal]')!.click()
    await waitFor(() => root.innerHTML.includes(VALUE), 'révélation')

    await store.createAndOpenTask('Another task', 'Do something else')
    await waitFor(() => !root.innerHTML.includes(VALUE), 'changement de cahier')
    expect(root.textContent).toContain('No credentials yet.')
    prompt.mockRestore()
  })
})
