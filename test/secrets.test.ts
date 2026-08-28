import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildDemoTask } from '../src/demo/seed'
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
  // Le secret existe AVANT l'ouverture du cahier : c'est l'ordre réel, et
  // c'est aussi le seul qui garantisse que le premier rendu le voie.
  const task = buildDemoTask()
  await addSecret({
    taskId: task.id,
    name: 'gemini-api-key',
    purpose: 'Calls the Gemini API from the ingestion script',
    value: VALUE,
    passphrase: PASSPHRASE,
  })
  await store.openPreparedTask(task)
  // La condition vise la LIGNE, pas le nom : `gemini-api-key` est aussi le
  // texte indicatif du formulaire, et l'attente se terminait aussitôt sur lui.
  await waitFor(() => root.querySelector('[data-reveal]') !== null, 'affichage du nom scellé')
  return task
}

describe('ce que l’agent reçoit', () => {
  it('cite le nom et l’usage, jamais la valeur', async () => {
    await withSecret()

    const rendered = textOf(await call(resumeTaskTool))
    expect(rendered).toContain('CREDENTIALS')
    // Le NOM est exact, toujours : c'est ce que l'agent recopie.
    expect(rendered).toContain('${gemini-api-key}')
    // L'usage, lui, est de la prose et peut être raccourci sous le budget.
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

    // La garantie est structurelle : un secret ne vit pas dans TaskState, donc
    // aucune sortie d'outil ne peut en contenir un, même par accident.
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
    // Le coût est borné, pas proportionnel : trente n'ajoutent qu'un compteur.
    expect(trente).toBeLessThanOrEqual(TOKEN_BUDGET)
    expect(trente - deux).toBeLessThanOrEqual(5)

    // Un NOM n'est jamais tronqué : un agent qui citerait `${service-1-api-k…}`
    // écrirait une référence fausse. Sous pression, on en montre moins, on ne
    // les raccourcit pas — et on dit combien sont cachés.
    const rendu = renderTaskState(task, { credentials: creds(30) })
    expect(rendu).toMatch(/CREDENTIALS — names only, values sealed \(\d+ of 30\)/)
    expect(rendu).not.toMatch(/\$\{service-\d+-api-k…/)
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

    // Le budget passe d'abord sur le travail ancien, qui se relit page par
    // page, avant de toucher aux identifiants.
    const sans = renderTaskState(task)
    const avec = renderTaskState(task, { credentials: creds(4) })

    // Sans identifiants, le budget tient deux étapes. Avec, il n'en tient plus
    // qu'une — c'est le travail ancien qui paie, et il se relit page par page.
    expect(sans).toMatch(/RECENT WORK \(last 2 of 4\)/)
    expect(avec).toMatch(/RECENT WORK \(last 1 of 4\)/)
    expect(avec).toContain('${service-0-api-key}')
    expect(avec).toContain('${service-1-api-key}')
    expect(estimateTokens(avec)).toBeLessThanOrEqual(TOKEN_BUDGET)
  })

  it('dit clairement qu’il en cache, plutôt que de paraître complet', () => {
    const rendu = renderTaskState(buildDemoTask(), {
      credentials: Array.from({ length: 8 }, (_, i) => ({
        id: `s${i}`,
        name: `service-${i}-api-key`,
        purpose: 'Calls the upstream service from the ingestion worker',
        kind: 'api_key' as const,
      })),
    })

    // Le compte est ce qui compte : « 2 of 8 » dit à l'agent qu'il lui en manque
    // six. La section où les lire est déclarée par le schéma de
    // read_task_detail, qui ne peut pas dériver — et n'occupe pas le budget.
    expect(rendu).toMatch(/CREDENTIALS — names only, values sealed \(\d+ of 8\)/)
    expect(rendu).toContain('read_task_detail')

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

    // Rien de la valeur dans le DOM tant que personne n'a demandé à la voir.
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

    // Le champ de valeur n'est PAS conservé entre deux rendus, contrairement aux
    // autres saisies : une valeur qu'un rendu réinjecterait dans le DOM serait
    // lisible par un agent qui pilote le navigateur.
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
