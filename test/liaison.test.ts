import { beforeEach, describe, expect, it } from 'vitest'
import { resumeTaskTool } from '../src/webmcp/tools'
import * as store from '../src/store/taskStore'
import { taskIdFromPath, taskPath } from '../src/webmcp/location'
import { call, clearDatabase, textOf } from './helpers'

beforeEach(async () => {
  store.__resetStore()
  await clearDatabase()
})

describe('l’adresse', () => {
  it('lit un identifiant sur /t/:id, et rien d’autre', () => {
    expect(taskIdFromPath('/t/abc123')).toBe('abc123')
    expect(taskIdFromPath('/t/abc123/quoi')).toBe('abc123')
    expect(taskIdFromPath('/')).toBeNull()
    expect(taskIdFromPath('/tasks/abc')).toBeNull()
    expect(taskIdFromPath('/t/')).toBeNull()
  })

  it('rejette ce qui n’est pas un identifiant : un chemin est une entrée non fiable', () => {
    expect(taskIdFromPath('/t/../../etc')).toBeNull()
    expect(taskIdFromPath('/t/<script>')).toBeNull()
    expect(taskIdFromPath('/t/' + 'x'.repeat(65))).toBeNull()
  })

  it('fait l’aller-retour', () => {
    expect(taskIdFromPath(taskPath('abc123def456'))).toBe('abc123def456')
  })
})

describe('reprise liée', () => {
  it('rend la tâche nommée par l’adresse, pas la dernière touchée', async () => {
    const first = await store.createAndOpenTask('Première tâche', 'A')
    const seconde = await store.createAndOpenTask('Seconde tâche', 'B')
    expect(seconde.id).not.toBe(first.id)

    store.__resetStore()
    await store.init(first.id)

    const rendered = textOf(await call(resumeTaskTool))
    expect(rendered).toContain('Première tâche')
    expect(rendered).not.toContain('Seconde tâche')
    expect(rendered).toContain(`TASK ID     ${first.id}`)
  })

  it('nomme la tâche dans toute réponse, pour qu’une substitution se voie', async () => {
    const task = await store.createAndOpenTask('Tâche', 'Continuer')
    const rendered = textOf(await call(resumeTaskTool))
    expect(rendered).toContain(`TASK ID     ${task.id}`)
    expect(resumeTaskTool.description).toContain('TASK ID')
  })

  it('refuse plutôt que de substituer, quand le cahier lié a disparu', async () => {
    const first = await store.createAndOpenTask('Première tâche', 'A')
    await store.createAndOpenTask('Seconde tâche', 'B')

    store.__resetStore()
    await store.init(first.id)
    await store.deleteCurrentTask()

    store.__resetStore()
    await store.init(first.id)

    const result = await call(resumeTaskTool)
    expect(result.isError).toBe(true)
    const rendered = textOf(result)
    expect(rendered).toContain('TASK NOT FOUND')
    expect(rendered).toContain(first.id)
    expect(rendered).toContain('has not')
    expect(rendered).not.toContain('Seconde tâche')
  })

  it('refuse aussi toute écriture sur un cahier lié disparu', async () => {
    const { ALL_TOOLS } = await import('../src/webmcp/tools')
    const logStep = ALL_TOOLS.find((t) => t.name === 'log_step')!

    const task = await store.createAndOpenTask('Tâche', 'Continuer')
    store.__resetStore()
    await store.init('inexistant-123')

    const result = await call(logStep, {
      action: 'a',
      result: 'b',
      based_on_version: task.version,
      mutation_id: 'aaaaaaaa-bbbb',
    })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('TASK NOT FOUND')
  })

  it('se lie au dernier cahier ouvert quand l’adresse ne dit rien', async () => {
    const task = await store.createAndOpenTask('Tâche', 'Continuer')
    store.__resetStore()
    await store.init()

    expect(store.boundTaskId()).toBe(task.id)
    expect(textOf(await call(resumeTaskTool))).toContain(`TASK ID     ${task.id}`)
  })

  it('distingue « aucun cahier » de « ce cahier-là a disparu »', async () => {
    store.__resetStore()
    await store.init()
    expect(textOf(await call(resumeTaskTool))).toContain('NO ACTIVE TASK')

    store.__resetStore()
    await store.init('jamais-existé')
    const rendered = textOf(await call(resumeTaskTool))
    expect(rendered).toContain('TASK NOT FOUND')
    expect(rendered).not.toContain('NO ACTIVE TASK')
  })
})
