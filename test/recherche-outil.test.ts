import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildDemoTask } from '../src/demo/seed'
import { addConstraint, logStep, rejectApproach } from '../src/domain/task'
import { renderSearch } from '../src/domain/searchResult'
import { searchTaskTool } from '../src/webmcp/tools'
import { READ_TOOLS, WRITE_TOOLS } from '../src/webmcp/tools'
import * as store from '../src/store/taskStore'
import { addSecret } from '../src/persistence/vault'
import { call, clearDatabase, currentTask, textOf } from './helpers'

async function seed() {
  store.__resetStore()
  await clearDatabase()
  await store.init()
  await store.openPreparedTask(buildDemoTask())
}

describe('search_task', () => {
  beforeEach(seed)
  afterEach(() => {
    store.__resetStore()
  })

  it('est déclaré en lecture seule, et annoncé comme tel', () => {
    expect(searchTaskTool.annotations?.readOnlyHint).toBe(true)
    expect(searchTaskTool.annotations?.untrustedContentHint).toBe(true)
    expect(READ_TOOLS).toContain(searchTaskTool)
    expect(WRITE_TOOLS).not.toContain(searchTaskTool)
  })

  it('répond à la question du produit : a-t-on déjà essayé cela ?', async () => {
    await store.mutate((s) =>
      rejectApproach(
        s,
        {
          approach: 'Caching tokens in localStorage',
          reason: 'XSS reads it',
          basedOnVersion: null,
        },
        'human',
      ),
    )

    const found = textOf(await call(searchTaskTool, { query: 'localStorage' }))
    expect(found).toContain('Caching tokens in localStorage')
    expect(found).toContain('XSS reads it')
    expect(found).toMatch(/RULED OUT|Ruled out/)
  })

  it('cherche dans les étapes, les preuves, les règles et les décisions', async () => {
    await store.mutate((s) =>
      logStep(
        s,
        {
          action: 'Ran the suite',
          result: 'green',
          evidence: { kind: 'test_report', content: 'monogram-parser 41 passed' },
          basedOnVersion: null,
        },
        'human',
      ),
    )
    await store.mutate((s) =>
      addConstraint(s, { rule: 'Never touch monogram-parser', basedOnVersion: null }, 'human'),
    )

    const found = textOf(await call(searchTaskTool, { query: 'monogram-parser' }))
    expect(found).toContain('Never touch monogram-parser')
    // La preuve compte : c'est souvent là que se trouve la trace d'un essai.
    expect(found).toContain('Ran the suite')
  })

  it('dit clairement qu’il n’a rien trouvé, sans laisser croire à une absence de trace', async () => {
    const found = textOf(await call(searchTaskTool, { query: 'quantum-flux-capacitor' }))
    expect(found).toContain('NO MATCH')
    expect(found).toContain('quantum-flux-capacitor')
    // Une recherche vide ne prouve pas que rien n'a été tenté : le cahier peut
    // simplement employer d'autres mots.
    expect(found.toLowerCase()).toContain('does not prove')
  })

  it('refuse une requête trop courte plutôt que de tout déverser', async () => {
    const result = await call(searchTaskTool, { query: 'a' })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('query')
  })

  it('borne sa réponse, et dit combien de résultats il a laissés de côté', async () => {
    for (let i = 0; i < 30; i++) {
      await store.mutate((s) =>
        addConstraint(s, { rule: `Rule about widgets number ${i}`, basedOnVersion: null }, 'human'),
      )
    }

    const found = textOf(await call(searchTaskTool, { query: 'widgets' }))
    expect(found).toContain('30')
    expect(found).toMatch(/more not shown|MORE/)
    expect(found.length).toBeLessThan(6000)
  })

  it('ne rend jamais la valeur d’un identifiant', async () => {
    const task = currentTask()
    await addSecret({
      taskId: task.id,
      name: 'gemini-api-key',
      purpose: 'Gemini calls',
      value: 'AIzaSy-never-leaves-this-device',
      passphrase: 'correct horse battery',
    })
    await store.mutate((s) =>
      logStep(
        s,
        {
          action: 'Called Gemini with ${gemini-api-key}',
          result: 'ok',
          basedOnVersion: null,
        },
        'human',
      ),
    )

    const found = textOf(await call(searchTaskTool, { query: 'gemini' }))
    expect(found).not.toContain('AIzaSy-never-leaves-this-device')
  })

  it('refuse une limite hors bornes plutôt que de la rogner en silence', async () => {
    for (const limit of [0, 99, 2.5, 'beaucoup']) {
      const result = await call(searchTaskTool, { query: 'token', limit })
      expect(result.isError, String(limit)).toBe(true)
      expect(textOf(result), String(limit)).toContain('limit')
    }

    // Absente, elle vaut le maximum : l'agent n'a pas à la connaître.
    expect((await call(searchTaskTool, { query: 'token' })).isError).toBeFalsy()
    expect((await call(searchTaskTool, { query: 'token', limit: 1 })).isError).toBeFalsy()
  })

  it('refuse une requête qui n’est pas du texte', async () => {
    const result = await call(searchTaskTool, { query: 42 })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('query')
  })

  it('refuse une requête interminable', async () => {
    const result = await call(searchTaskTool, { query: 'x'.repeat(201) })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('200')
  })

  it('renonce quand l’exécution est annulée', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await call(searchTaskTool, { query: 'token' }, controller.signal)
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(/cancel/i)
  })
})

describe('la mise en mots d’une recherche', () => {
  it('nomme la section où continuer, pour que l’agent sache quoi lire ensuite', () => {
    const rendered = renderSearch(buildDemoTask(), 'token', 10)
    expect(rendered).toContain('read_task_detail')
  })
})
