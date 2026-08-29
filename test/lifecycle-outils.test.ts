import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  __resetRegistration,
  detectLifecycle,
  getRegistrationState,
  registerTools,
} from '../src/webmcp/register'
import { DYNAMIC_UNREGISTER_MIN_CHROMIUM } from '../src/webmcp/lifecycle'
import { ALL_TOOLS, READ_TOOLS, resumeTaskTool } from '../src/webmcp/tools'
import * as store from '../src/store/taskStore'
import { completeTask, reopenTask } from '../src/domain/task'
import {
  call,
  clearDatabase,
  installModelContext,
  pretendChromium,
  removeModelContext,
  resetUserAgentData,
  settle,
  textOf,
  writeArgs,
} from './helpers'

beforeEach(async () => {
  __resetRegistration()
  store.__resetStore()
  removeModelContext()
  resetUserAgentData()
  await clearDatabase()
})

afterEach(() => {
  __resetRegistration()
  removeModelContext()
  resetUserAgentData()
})

describe('détection de la capacité', () => {
  it('n’autorise le retrait dynamique qu’à partir de Chromium 153', () => {
    pretendChromium(DYNAMIC_UNREGISTER_MIN_CHROMIUM)
    expect(detectLifecycle().mode).toBe('dynamic')

    pretendChromium(DYNAMIC_UNREGISTER_MIN_CHROMIUM + 7)
    expect(detectLifecycle().mode).toBe('dynamic')
  })

  it('reste statique sur les versions de la cible du concours', () => {
    for (const v of [149, 150, 151, 152]) {
      pretendChromium(v)
      const cycle = detectLifecycle()
      expect(cycle.mode, `Chromium ${v}`).toBe('static')
      expect(cycle.chromiumMajor).toBe(v)
    }
  })

  it('reste statique quand la version est inconnue', () => {
    resetUserAgentData()
    const cycle = detectLifecycle()
    expect(cycle.mode).toBe('static')
    expect(cycle.chromiumMajor).toBeNull()
  })

  it('reste statique hors Chromium, même sur un navigateur récent', () => {
    pretendChromium(200, 'Firefox')
    const cycle = detectLifecycle()
    expect(cycle.mode).toBe('static')
    expect(cycle.chromiumMajor).toBeNull()
  })

  it('dit sur quoi elle se fonde, puisqu’elle ne peut pas le prouver', () => {
    pretendChromium(149)
    expect(detectLifecycle().reason).toMatch(/149/)
    resetUserAgentData()
    expect(detectLifecycle().reason).toMatch(/unknown|inconnu/i)
  })
})

describe('mode statique : la cible du concours', () => {
  beforeEach(() => pretendChromium(151))

  it('pose le jeu correspondant à l’état INITIAL, et rien de plus', async () => {
    const fake = installModelContext()
    await registerTools()

    expect(getRegistrationState().lifecycle.mode).toBe('static')
    expect(fake.names()).toEqual(['read_task_detail', 'resume_task', 'search_task', 'what_changed'])
  })

  it('pose deux outils au chargement d’une tâche déjà close', async () => {
    const task = await store.createAndOpenTask('Tâche', 'Continuer')
    await store.mutate((s) => completeTask(s, { summary: 'Clos.', basedOnVersion: null }, 'human'))

    store.__resetStore()
    await store.init(task.id)

    const fake = installModelContext()
    await registerTools()

    expect(fake.names()).toEqual(['read_task_detail', 'resume_task', 'search_task', 'what_changed'])
  })

  it('ne retire JAMAIS un outil pendant la vie du document', async () => {
    const fake = installModelContext()
    const ouverte = await store.createAndOpenTask('Tâche', 'Continuer')
    await registerTools()
    expect(fake.names()).toContain('complete_task')

    const result = await fake.tools
      .get('complete_task')!
      .execute(writeArgs(ouverte, { summary: 'Terminé, rien ne reste.' }), {
        signal: new AbortController().signal,
      })
    await settle(8)

    expect(textOf(result)).toContain('OK: complete_task recorded.')
    expect(fake.names()).toHaveLength(ALL_TOOLS.length)
    expect(getRegistrationState().toolNames).toHaveLength(ALL_TOOLS.length)
  })

  it('laisse les écritures refuser proprement sur une tâche close', async () => {
    const fake = installModelContext()
    await store.createAndOpenTask('Tâche', 'Continuer')
    await registerTools()
    await store.mutate((s) => completeTask(s, { summary: 'Clos.', basedOnVersion: null }, 'human'))
    await settle(4)

    const refusal = await fake.tools
      .get('log_step')!
      .execute(writeArgs(store.currentTask()!, { action: 'a', result: 'b' }), {
        signal: new AbortController().signal,
      })

    expect(refusal.isError).toBe(true)
    expect(textOf(refusal)).toContain('already completed')
    expect(textOf(refusal)).toContain('reopen')
    expect(textOf(await call(resumeTaskTool))).toContain('TASK CLOSED')
    expect(store.currentTask()!.steps).toHaveLength(0)
  })

  it('ajoute en revanche les écritures quand une tâche s’ouvre', async () => {
    const fake = installModelContext()
    await registerTools()
    expect(fake.names()).toHaveLength(READ_TOOLS.length)

    await store.createAndOpenTask('Tâche', 'Continuer')
    await settle(4)

    expect(fake.names()).toHaveLength(ALL_TOOLS.length)
    expect(fake.names()).toContain('log_step')
  })
})

describe('mode dynamique : Chromium 153 et au-delà', () => {
  beforeEach(() => pretendChromium(DYNAMIC_UNREGISTER_MIN_CHROMIUM))

  it('retire les écritures à la clôture', async () => {
    const fake = installModelContext()
    const task = await store.createAndOpenTask('Tâche', 'Continuer')
    await registerTools()
    expect(getRegistrationState().lifecycle.mode).toBe('dynamic')

    await call(
      ALL_TOOLS.find((t) => t.name === 'complete_task')!,
      writeArgs(task, { summary: 'Terminé.' }),
    )
    await settle(6)

    expect(fake.names()).toEqual(['read_task_detail', 'resume_task', 'search_task', 'what_changed'])
  })

  it('les rend à la réouverture', async () => {
    const fake = installModelContext()
    const task = await store.createAndOpenTask('Tâche', 'Continuer')
    await registerTools()
    await store.mutate((s) => completeTask(s, { summary: 'Clos.', basedOnVersion: null }, 'human'))
    await settle(4)
    expect(fake.names()).toHaveLength(READ_TOOLS.length)

    await store.mutate((s) => reopenTask(s, 'Il reste du travail'))
    await settle(4)

    expect(fake.names()).toHaveLength(ALL_TOOLS.length)
    expect(store.currentTask()!.id).toBe(task.id)
  })
})
