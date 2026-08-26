import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  __resetRegistration,
  detectLifecycle,
  getRegistrationState,
  registerTools,
} from '../src/webmcp/register'
import { DYNAMIC_UNREGISTER_MIN_CHROMIUM } from '../src/webmcp/lifecycle'
import { ALL_TOOLS, resumeTaskTool } from '../src/webmcp/tools'
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

/**
 * Politique de cycle de vie des outils.
 *
 * Le désenregistrement dynamique est séduisant — un outil qui ne peut que
 * refuser n'aide pas l'agent à choisir — mais il repose sur une garantie que
 * Chrome ne donne qu'à partir de la 153 : qu'avorter le contrôleur d'un outil
 * ne casse pas une exécution en cours. La cible du concours commence à la 149.
 *
 * Une version antérieure de ce code retenait le retrait d'un tour de boucle,
 * par `setTimeout`. C'était sans valeur : la spécification dit en toutes
 * lettres que l'ordre entre la source de tâches WebMCP et celle des minuteurs
 * ne peut pas être invoqué. Un tour de boucle n'est pas une garantie de
 * livraison, et présenter le contraire aurait été une affirmation qu'aucun
 * test ne peut soutenir.
 *
 * D'où la règle : on ne désenregistre QUE si la capacité est positivement
 * connue. Partout ailleurs, les outils restent posés et refusent proprement.
 */

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
    // jsdom ne publie pas `userAgentData`. C'est le cas « environnement
    // inconnu », et le défaut doit y être le mode sûr — pas l'inverse.
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
    // Il n'existe aucune détection de fonctionnalité pour « désenregistrer ne
    // casse pas une exécution en vol ». C'est un reniflage de version, et le
    // dire est la moindre des choses.
    pretendChromium(149)
    expect(detectLifecycle().reason).toMatch(/149/)
    resetUserAgentData()
    expect(detectLifecycle().reason).toMatch(/unknown|inconnu/i)
  })
})

describe('mode statique — la cible du concours', () => {
  beforeEach(() => pretendChromium(151))

  it('pose le jeu correspondant à l’état INITIAL, et rien de plus', async () => {
    const fake = installModelContext()
    await registerTools()

    expect(getRegistrationState().lifecycle.mode).toBe('static')
    expect(fake.names()).toEqual(['read_task_detail', 'resume_task'])
  })

  it('pose deux outils au chargement d’une tâche déjà close', async () => {
    const task = await store.createAndOpenTask('Tâche', 'Continuer')
    await store.mutate((s) => completeTask(s, { summary: 'Clos.', basedOnVersion: null }, 'human'))

    // Rechargement : le magasin repart de zéro, le document est neuf.
    store.__resetStore()
    await store.init(task.id)

    const fake = installModelContext()
    await registerTools()

    // Aucune écriture ne pourrait aboutir : ne pas les poser du tout est sans
    // risque, puisque rien n'est encore en vol au premier enregistrement.
    expect(fake.names()).toEqual(['read_task_detail', 'resume_task'])
  })

  it('ne retire JAMAIS un outil pendant la vie du document', async () => {
    const fake = installModelContext()
    const ouverte = await store.createAndOpenTask('Tâche', 'Continuer')
    await registerTools()
    expect(fake.names()).toContain('complete_task')

    const résultat = await fake.tools
      .get('complete_task')!
      .execute(writeArgs(ouverte, { summary: 'Terminé, rien ne reste.' }), {
        signal: new AbortController().signal,
      })
    await settle(8)

    expect(textOf(résultat)).toContain('OK — complete_task recorded.')
    // Les sept restent. C'est le prix payé pour qu'aucune réponse ne puisse
    // être emportée par un retrait : on ne peut pas casser une exécution avec
    // un contrôleur qu'on n'avorte pas.
    expect(fake.names()).toHaveLength(7)
    expect(getRegistrationState().toolNames).toHaveLength(7)
  })

  it('laisse les écritures refuser proprement sur une tâche close', async () => {
    const fake = installModelContext()
    await store.createAndOpenTask('Tâche', 'Continuer')
    await registerTools()
    await store.mutate((s) => completeTask(s, { summary: 'Clos.', basedOnVersion: null }, 'human'))
    await settle(4)

    const refus = await fake.tools
      .get('log_step')!
      .execute(writeArgs(store.currentTask()!, { action: 'a', result: 'b' }), {
        signal: new AbortController().signal,
      })

    // Un outil qui reste posé doit dire pourquoi il ne sert plus, et le dire
    // de façon actionnable — sans quoi le prix de la sûreté serait un agent
    // qui s'acharne.
    expect(refus.isError).toBe(true)
    expect(textOf(refus)).toContain('already completed')
    expect(textOf(refus)).toContain('reopen')
    expect(textOf(await call(resumeTaskTool))).toContain('TASK CLOSED')
    expect(store.currentTask()!.steps).toHaveLength(0)
  })

  it('ajoute en revanche les écritures quand une tâche s’ouvre', async () => {
    const fake = installModelContext()
    await registerTools()
    expect(fake.names()).toHaveLength(2)

    await store.createAndOpenTask('Tâche', 'Continuer')
    await settle(4)

    // Poser un outil n'avorte rien : l'ajout est sans danger dans les deux
    // modes. Sans lui, une page ouverte avant la tâche n'aurait plus aucune
    // écriture jusqu'au rechargement — le produit serait inutilisable pour la
    // moitié des parcours.
    expect(fake.names()).toHaveLength(7)
    expect(fake.names()).toContain('log_step')
  })
})

describe('mode dynamique — Chromium 153 et au-delà', () => {
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

    expect(fake.names()).toEqual(['read_task_detail', 'resume_task'])
  })

  it('les rend à la réouverture', async () => {
    const fake = installModelContext()
    const task = await store.createAndOpenTask('Tâche', 'Continuer')
    await registerTools()
    await store.mutate((s) => completeTask(s, { summary: 'Clos.', basedOnVersion: null }, 'human'))
    await settle(4)
    expect(fake.names()).toHaveLength(2)

    await store.mutate((s) => reopenTask(s, 'Il reste du travail'))
    await settle(4)

    expect(fake.names()).toHaveLength(7)
    expect(store.currentTask()!.id).toBe(task.id)
  })
})
