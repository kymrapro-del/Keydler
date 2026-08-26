import { beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetRegistration, registerTools } from '../src/webmcp/register'
import { ALL_TOOLS, resumeTaskTool } from '../src/webmcp/tools'
import * as store from '../src/store/taskStore'
import { checkAvailability } from '../src/webmcp/adapter'
import { getDb } from '../src/persistence/db'

/**
 * Le contrat côté agent (TAL-56, TAL-61) : enregistrement unique, reprise
 * lisible, refus explicite d'une écriture périmée.
 */

function installFakeModelContext() {
  const registered: Array<{ name: string }> = []
  Object.defineProperty(document, 'modelContext', {
    configurable: true,
    value: {
      registerTool: vi.fn(async (tool: { name: string }) => {
        registered.push(tool)
      }),
    },
  })
  return registered
}

function removeModelContext() {
  Reflect.deleteProperty(document, 'modelContext')
}

/**
 * IndexedDB survit d'un test à l'autre — c'est justement le comportement
 * recherché en production. On repart donc d'une base vide à chaque cas.
 */
async function clearDatabase() {
  const db = await getDb()
  const tx = db.transaction(['tasks', 'meta'], 'readwrite')
  await Promise.all([tx.objectStore('tasks').clear(), tx.objectStore('meta').clear(), tx.done])
}

beforeEach(async () => {
  __resetRegistration()
  store.__resetStore()
  removeModelContext()
  await clearDatabase()
})

describe('enregistrement', () => {
  it('expose exactement six outils, resume_task en tête', () => {
    expect(ALL_TOOLS).toHaveLength(6)
    expect(ALL_TOOLS[0].name).toBe('resume_task')
    expect(ALL_TOOLS.map((t) => t.name)).toEqual([
      'resume_task',
      'log_step',
      'add_constraint',
      'reject_approach',
      'add_decision',
      'complete_task',
    ])
  })

  it('n’enregistre jamais deux fois, même appelé en double', async () => {
    const registered = installFakeModelContext()

    const first = await registerTools()
    const second = await registerTools()

    expect(first.phase).toBe('registered')
    expect(second.phase).toBe('registered')
    // Le mode strict de React monte deux fois : c'est exactement ce cas.
    expect(registered).toHaveLength(6)
  })

  it('signale l’absence d’API sans lever d’erreur', async () => {
    const state = await registerTools()
    expect(state.phase).toBe('unsupported')
    expect(state.toolNames).toEqual([])
    expect(checkAvailability()).toEqual({ supported: false, reason: 'no-api' })
  })

  it('accepte encore navigator.modelContext, déprécié depuis Chrome 150', async () => {
    const registered: Array<{ name: string }> = []
    Object.defineProperty(navigator, 'modelContext', {
      configurable: true,
      value: {
        registerTool: async (tool: { name: string }) => {
          registered.push(tool)
        },
      },
    })

    const state = await registerTools()
    expect(state.phase).toBe('registered')
    expect(state.availability).toEqual({ supported: true, surface: 'navigator' })
    expect(registered).toHaveLength(6)

    Reflect.deleteProperty(navigator, 'modelContext')
  })

  it('décrit resume_task en disant quand l’appeler', () => {
    const description = resumeTaskTool.description
    expect(description).toContain('BEFORE doing any work')
    expect(description).toContain('new')
    expect(description).toContain('context loss')
    expect(description).toContain('refused as stale')
    expect(resumeTaskTool.annotations?.readOnlyHint).toBe(true)
  })
})

describe('outils de bout en bout', () => {
  it('restitue un état lisible et refuse ensuite une écriture périmée', async () => {
    const task = await store.createAndOpenTask('Refactoriser l’authentification', 'Cartographier')

    const resumed = await resumeTaskTool.execute({}, {})
    const rendered = resumed.content[0].text
    expect(rendered).toContain('Refactoriser l’authentification')
    expect(rendered).toContain(`VERSION     ${task.version}`)

    const logStep = ALL_TOOLS.find((t) => t.name === 'log_step')!
    const ok = await logStep.execute(
      { action: 'Lu le module', result: 'trois entrées', based_on_version: task.version },
      {},
    )
    expect(ok.isError).toBeUndefined()
    expect(ok.content[0].text).toContain('OK — log_step recorded.')

    // L'agent rejoue la même version : elle a bougé, l'écriture doit tomber.
    const stale = await logStep.execute(
      { action: 'Encore', result: 'raté', based_on_version: task.version },
      {},
    )
    expect(stale.isError).toBe(true)
    expect(stale.content[0].text).toContain('STALE STATE')
    expect(stale.content[0].text).toContain('Call resume_task before continuing.')

    // Le refus est visible dans le journal, donc à l'écran.
    const current = store.currentTask()!
    expect(current.audit.at(-1)).toMatchObject({ outcome: 'refused', operation: 'log_step' })
  })

  it('exige un motif de rejet et le dit à l’agent', async () => {
    const task = await store.createAndOpenTask('Tâche', 'Prochaine')
    const rejectApproach = ALL_TOOLS.find((t) => t.name === 'reject_approach')!

    const result = await rejectApproach.execute(
      { approach: 'JWT variante B', reason: '', based_on_version: task.version },
      {},
    )
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('INVALID INPUT')
    expect(result.content[0].text).toContain('reason')
  })

  it('indique clairement l’absence de cahier plutôt que d’échouer', async () => {
    const result = await resumeTaskTool.execute({}, {})
    expect(result.content[0].text).toContain('NO ACTIVE TASK')
  })
})
