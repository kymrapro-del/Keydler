import { beforeEach, describe, expect, it } from 'vitest'
import { resumeTaskTool } from '../src/webmcp/tools'
import * as store from '../src/store/taskStore'
import { taskIdFromPath, taskPath } from '../src/webmcp/location'
import { call, clearDatabase, textOf } from './helpers'

/**
 * Un cahier, une adresse.
 *
 * « Figure dans l'URL : /t/:id » était écrit dans le type depuis le premier
 * jour, et nulle part ailleurs : rien ne construisait cette adresse, rien ne
 * la lisait. `resume_task` rendait « le dernier cahier touché sur cet
 * appareil ».
 *
 * La conséquence n'était pas cosmétique. Deux onglets sur deux tâches
 * suffisaient à ce qu'un agent reçoive l'état d'une tâche qui n'était pas la
 * sienne, sans qu'aucune ligne de la réponse ne l'indique — et il reprenait ce
 * travail-là en croyant reprendre le sien.
 */

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
    const première = await store.createAndOpenTask('Première tâche', 'A')
    const seconde = await store.createAndOpenTask('Seconde tâche', 'B')
    expect(seconde.id).not.toBe(première.id)

    // Un autre onglet a ouvert — et donc touché en dernier — la seconde. Cet
    // onglet-ci est lié à la première.
    store.__resetStore()
    await store.init(première.id)

    const rendu = textOf(await call(resumeTaskTool))
    expect(rendu).toContain('Première tâche')
    expect(rendu).not.toContain('Seconde tâche')
    expect(rendu).toContain(`TASK ID     ${première.id}`)
  })

  it('nomme la tâche dans toute réponse, pour qu’une substitution se voie', async () => {
    const task = await store.createAndOpenTask('Tâche', 'Continuer')
    const rendu = textOf(await call(resumeTaskTool))
    // Sans cette ligne, un agent ne peut pas constater qu'on lui a répondu sur
    // une autre tâche : le contenu seul ne le trahit pas toujours.
    expect(rendu).toContain(`TASK ID     ${task.id}`)
    expect(resumeTaskTool.description).toContain('TASK ID')
  })

  it('refuse plutôt que de substituer, quand le cahier lié a disparu', async () => {
    const première = await store.createAndOpenTask('Première tâche', 'A')
    await store.createAndOpenTask('Seconde tâche', 'B')

    store.__resetStore()
    await store.init(première.id)
    await store.deleteCurrentTask()

    // Une autre tâche EXISTE sur l'appareil. La rendre serait la pire réponse
    // possible : l'agent reprendrait un travail qui n'est pas le sien.
    store.__resetStore()
    await store.init(première.id)

    const result = await call(resumeTaskTool)
    expect(result.isError).toBe(true)
    const rendu = textOf(result)
    expect(rendu).toContain('TASK NOT FOUND')
    expect(rendu).toContain(première.id)
    expect(rendu).toContain('has not')
    expect(rendu).not.toContain('Seconde tâche')
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

    // Une première visite n'a pas d'adresse : elle reprend le dernier, PUIS
    // s'y lie. Le comportement d'après est le même que si elle avait été
    // nommée — c'est le lien qui compte, pas la façon de l'établir.
    expect(store.boundTaskId()).toBe(task.id)
    expect(textOf(await call(resumeTaskTool))).toContain(`TASK ID     ${task.id}`)
  })

  it('distingue « aucun cahier » de « ce cahier-là a disparu »', async () => {
    store.__resetStore()
    await store.init()
    expect(textOf(await call(resumeTaskTool))).toContain('NO ACTIVE TASK')

    store.__resetStore()
    await store.init('jamais-existé')
    const rendu = textOf(await call(resumeTaskTool))
    expect(rendu).toContain('TASK NOT FOUND')
    expect(rendu).not.toContain('NO ACTIVE TASK')
  })
})
