import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import {
  __resetRegistration,
  getRegistrationState,
  registerTools,
  toolsForCurrentState,
} from '../src/webmcp/register'
import { ALL_TOOLS, READ_TOOLS, WRITE_TOOLS, resumeTaskTool } from '../src/webmcp/tools'
import * as store from '../src/store/taskStore'
import { checkAvailability } from '../src/webmcp/adapter'
import {
  call,
  clearDatabase,
  installModelContext,
  mutationId,
  removeModelContext,
  settle,
  textOf,
  writeArgs,
} from './helpers'

/**
 * Le contrat côté agent (TAL-56, TAL-61) : enregistrement, reprise lisible,
 * refus explicite d'une écriture périmée.
 */

beforeEach(async () => {
  __resetRegistration()
  store.__resetStore()
  removeModelContext()
  await clearDatabase()
})

afterEach(() => {
  __resetRegistration()
  removeModelContext()
})

describe('inventaire', () => {
  it('expose deux outils de lecture et cinq d’écriture', () => {
    expect(READ_TOOLS.map((t) => t.name)).toEqual(['resume_task', 'read_task_detail'])
    expect(WRITE_TOOLS.map((t) => t.name)).toEqual([
      'log_step',
      'add_constraint',
      'reject_approach',
      'add_decision',
      'complete_task',
    ])
    expect(ALL_TOOLS).toHaveLength(7)
  })

  it('n’annonce jamais une annotation que WebMCP ne transporte pas', () => {
    // `dictionary ToolAnnotations { boolean readOnlyHint; boolean
    // untrustedContentHint; }` — et rien d'autre. Une conversion de
    // dictionnaire WebIDL ignore EN SILENCE tout membre inconnu : un
    // `openWorldHint` posé ici n'aurait jamais quitté la page, sans qu'aucune
    // erreur ne le signale.
    const connues = new Set(['readOnlyHint', 'untrustedContentHint'])
    for (const tool of ALL_TOOLS) {
      for (const clé of Object.keys(tool.annotations ?? {})) {
        expect(connues).toContain(clé)
      }
    }
  })

  it('marque les lectures en lecture seule et leur contenu comme non fiable', () => {
    for (const tool of READ_TOOLS) {
      expect(tool.annotations?.readOnlyHint).toBe(true)
      // Ce que ces outils rendent a été écrit par un agent précédent, en texte
      // libre, et revient dans le contexte d'un autre agent.
      expect(tool.annotations?.untrustedContentHint).toBe(true)
    }
    for (const tool of WRITE_TOOLS) {
      expect(tool.annotations?.readOnlyHint).toBe(false)
    }
  })

  it('décrit resume_task en disant quand l’appeler', () => {
    const description = resumeTaskTool.description
    expect(description).toContain('BEFORE doing any work')
    expect(description).toContain('context loss')
    expect(description).toContain('refused as stale')
    expect(resumeTaskTool.annotations?.readOnlyHint).toBe(true)
  })
})

describe('disponibilité', () => {
  it('distingue un contexte non sécurisé d’une absence d’API', async () => {
    const vrai = Object.getOwnPropertyDescriptor(window, 'isSecureContext')
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false })

    // Deux problèmes différents, donc deux consignes différentes pour qui
    // essaie : servir en HTTPS, ou activer un drapeau.
    expect(checkAvailability()).toEqual({ supported: false, reason: 'insecure-context' })
    const state = await registerTools()
    expect(state.phase).toBe('unsupported')

    if (vrai) Object.defineProperty(window, 'isSecureContext', vrai)
    else Reflect.deleteProperty(window, 'isSecureContext')
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
    // Sans cahier ouvert, seules les lectures : voir le cycle de vie.
    expect(registered.map((t) => t.name)).toEqual(['resume_task', 'read_task_detail'])

    Reflect.deleteProperty(navigator, 'modelContext')
  })
})

describe('outils de bout en bout', () => {
  it('restitue un état lisible et refuse ensuite une écriture périmée', async () => {
    const task = await store.createAndOpenTask('Refactoriser l’authentification', 'Cartographier')

    const rendered = textOf(await call(resumeTaskTool))
    expect(rendered).toContain('Refactoriser l’authentification')
    expect(rendered).toContain(`VERSION     ${task.version}`)
    // L'identifiant est rendu : c'est ce qui permet à un agent de constater
    // qu'on lui répond bien sur la tâche qu'il croit.
    expect(rendered).toContain(`TASK ID     ${task.id}`)

    const logStep = ALL_TOOLS.find((t) => t.name === 'log_step')!
    const ok = await call(
      logStep,
      writeArgs(task, { action: 'Lu le module', result: 'trois entrées' }),
    )
    expect(ok.isError).toBeUndefined()
    expect(textOf(ok)).toContain('OK — log_step recorded.')

    // L'agent rejoue la même version avec une AUTRE intention : elle a bougé,
    // l'écriture doit tomber.
    const stale = await call(logStep, writeArgs(task, { action: 'Encore', result: 'raté' }))
    expect(stale.isError).toBe(true)
    expect(textOf(stale)).toContain('STALE STATE')
    expect(textOf(stale)).toContain('Call resume_task before continuing.')

    // Le refus est visible dans le journal, donc à l'écran.
    const current = store.currentTask()!
    expect(current.audit.at(-1)).toMatchObject({ outcome: 'refused', operation: 'log_step' })
  })

  it('exige un motif de rejet et le dit à l’agent', async () => {
    const task = await store.createAndOpenTask('Tâche', 'Prochaine')
    const rejectApproach = ALL_TOOLS.find((t) => t.name === 'reject_approach')!

    const result = await call(
      rejectApproach,
      writeArgs(task, { approach: 'JWT variante B', reason: '' }),
    )
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('INVALID INPUT')
    expect(textOf(result)).toContain('reason')
  })

  it('refuse un mutation_id qui ne pourrait pas servir à rejouer', async () => {
    const task = await store.createAndOpenTask('Tâche', 'Prochaine')
    const logStep = ALL_TOOLS.find((t) => t.name === 'log_step')!

    for (const mauvais of ['', 'court', 'avec espace ici', 'x'.repeat(65)]) {
      const result = await call(logStep, {
        action: 'a',
        result: 'b',
        based_on_version: task.version,
        mutation_id: mauvais,
      })
      expect(result.isError).toBe(true)
      expect(textOf(result)).toContain('mutation_id')
    }
    expect(store.currentTask()!.steps).toHaveLength(0)
  })

  it('indique clairement l’absence de cahier plutôt que d’échouer', async () => {
    expect(textOf(await call(resumeTaskTool))).toContain('NO ACTIVE TASK')
  })
})

describe('cycle de vie des outils', () => {
  it('n’expose aucune écriture tant qu’aucun cahier n’est ouvert', async () => {
    const fake = installModelContext()
    await registerTools()

    // Un outil qui ne peut que rendre « NO ACTIVE TASK » n'aide pas l'agent à
    // choisir : il allonge la liste qu'il doit lire pour se décider.
    expect(fake.names()).toEqual(['read_task_detail', 'resume_task'])
    expect(toolsForCurrentState().map((t) => t.name)).toEqual(['resume_task', 'read_task_detail'])
  })

  it('expose les écritures dès qu’une tâche est ouverte, et émet toolchange', async () => {
    const fake = installModelContext()
    await registerTools()

    const changements: string[][] = []
    fake.addEventListener('toolchange', () => {
      void fake.getTools().then((t) => changements.push(t.map((x) => x.name)))
    })

    await store.createAndOpenTask('Tâche', 'Continuer')
    await settle()

    expect(fake.names()).toEqual([
      'add_constraint',
      'add_decision',
      'complete_task',
      'log_step',
      'read_task_detail',
      'reject_approach',
      'resume_task',
    ])

    // Le changement est passé par l'événement de la plateforme, et pas
    // seulement par la carte que la page tient. C'est le signal que la
    // spécification prévoit pour qu'un consommateur rafraîchisse sa liste ; ce
    // que l'agent intégré du navigateur en fait n'est pas observable ici.
    expect(changements.length).toBeGreaterThan(0)
    expect(changements.at(-1)).toContain('log_step')

    // Ce que `getTools()` rend : les outils ENREGISTRÉS, relus depuis la table
    // du navigateur. C'est une seconde source, pas une preuve que l'agent du
    // navigateur les a découverts — la spécification réserve `getTools()` aux
    // agents dans la page.
    const état = await registerTools()
    expect(état.observedTools).not.toBeNull()
    expect(état.observedTools).toContain('log_step')
  })

  it('garde les écritures posées à la clôture, faute de garantie de retrait', async () => {
    const fake = installModelContext()
    const task = await store.createAndOpenTask('Tâche', 'Continuer')
    await registerTools()
    expect(fake.names()).toContain('log_step')

    const complete = ALL_TOOLS.find((t) => t.name === 'complete_task')!
    const résultat = await call(complete, writeArgs(task, { summary: 'Terminé, rien ne reste.' }))
    await settle(6)

    // Environnement sans version de Chromium lisible : c'est le cas « inconnu »
    // et le défaut y est le mode sûr. Les sept restent posés — voir
    // `lifecycle-outils.test.ts` pour la politique et ses deux modes.
    expect(getRegistrationState().lifecycle.mode).toBe('static')
    expect(fake.names()).toHaveLength(7)

    // Ce qui compte pour l'agent tient de toute façon : sa réponse lui parvient,
    // et la lecture lui dit que la tâche est close.
    expect(textOf(résultat)).toContain('OK — complete_task recorded.')
    expect(textOf(await call(resumeTaskTool))).toContain('TASK CLOSED')
  })

  it('désenregistre par AbortController, sans jamais réenregistrer un nom pris', async () => {
    const fake = installModelContext()
    await store.createAndOpenTask('Tâche', 'Continuer')
    await registerTools()

    const avant = [...fake.attempts]
    // Le faux rejette un nom déjà pris, comme la spécification l'impose. Si le
    // module réenregistrait sans désenregistrer, on le verrait ici.
    await store.mutate((s) => ({ ...s, updatedAt: s.updatedAt + 1 }))
    await settle()

    expect(fake.attempts).toEqual(avant)
    expect(fake.names()).toContain('log_step')
  })

  it('garde les outils enregistrés quand un seul échoue', async () => {
    const fake = installModelContext()
    fake.failOn.add('reject_approach')
    await store.createAndOpenTask('Tâche', 'Continuer')

    const état = await registerTools()

    // L'ancienne boucle séquentielle s'arrêtait au premier échec, rendait
    // « failed » avec zéro outil, et laissait pourtant les premiers bel et
    // bien enregistrés et joignables : l'écran annonçait zéro pendant qu'un
    // agent en appelait trois.
    expect(état.phase).toBe('partial')
    expect(état.toolNames).toContain('resume_task')
    expect(état.toolNames).toContain('log_step')
    expect(état.toolNames).not.toContain('reject_approach')
    expect(état.failures.map((f) => f.name)).toEqual(['reject_approach'])
    expect(état.error).toContain('reject_approach')

    // Et ce que le navigateur tient correspond à ce que l'état annonce.
    expect(fake.names()).toEqual([...état.toolNames].sort())
  })

  it('continue d’annoncer l’outil manquant, même quand un tour n’a rien à poser', async () => {
    const fake = installModelContext()
    fake.failOn.add('reject_approach')
    await store.createAndOpenTask('Tâche', 'Continuer')
    await registerTools()

    // Un changement de version du cahier ne donne rien à poser de neuf.
    // Ne compter que les échecs DU TOUR faisait alors repasser la page en
    // « tout va bien » alors que l'outil restait absent.
    await store.mutate((s) => ({ ...s, updatedAt: s.updatedAt + 1 }))
    await settle()

    const { getRegistrationState } = await import('../src/webmcp/register')
    const état = getRegistrationState()
    expect(état.phase).toBe('partial')
    expect(état.failures.map((f) => f.name)).toEqual(['reject_approach'])
    expect(fake.names()).not.toContain('reject_approach')
  })

  it('repose un outil dont l’échec était passager', async () => {
    const fake = installModelContext()
    fake.failOn.add('reject_approach')
    await store.createAndOpenTask('Tâche', 'Continuer')
    await registerTools()
    expect(fake.names()).not.toContain('reject_approach')

    // Un refus peut être passager — une permission qui arrive, un document qui
    // redevient actif. Condamner l'outil pour un échec unique serait sévère et
    // sans recours : la page ne se réenregistre plus jamais.
    fake.failOn.delete('reject_approach')
    await store.mutate((s) => ({ ...s, updatedAt: s.updatedAt + 1 }))
    await settle()

    const { getRegistrationState } = await import('../src/webmcp/register')
    expect(fake.names()).toContain('reject_approach')
    expect(getRegistrationState().phase).toBe('registered')
  })

  it('ne pose jamais deux fois le même nom, même quand deux tours se chevauchent', async () => {
    const fake = installModelContext()
    await registerTools()

    // Les enregistrements sont retenus en vol : la fenêtre pendant laquelle un
    // second tour peut démarrer avant que le premier n'ait rempli sa table est
    // grande ouverte. C'est la situation réelle d'une écriture d'agent suivie
    // aussitôt d'une correction humaine.
    fake.lent = true
    await store.createAndOpenTask('Une', 'A')
    await store.openPreparedTask({ ...store.currentTask()!, updatedAt: Date.now() + 1 })
    await settle(2)

    fake.lent = false
    fake.reprendre()
    await settle(8)

    // Deux tours en vol calculeraient tous deux le même « à poser ». La
    // spécification REJETTE un nom déjà pris : la page se déclarerait alors en
    // échec sur un outil pourtant bien présent et joignable.
    const doublons = fake.attempts.filter((n, i) => fake.attempts.indexOf(n) !== i)
    expect(doublons).toEqual([])

    const { getRegistrationState } = await import('../src/webmcp/register')
    expect(getRegistrationState().phase).toBe('registered')
    expect(fake.names()).toContain('log_step')
  })

  it('n’enregistre jamais deux fois, même appelé en double', async () => {
    const fake = installModelContext()
    await store.createAndOpenTask('Tâche', 'Continuer')

    const first = await registerTools()
    const second = await registerTools()

    expect(first.phase).toBe('registered')
    expect(second.phase).toBe('registered')
    // Le mode strict de React monte deux fois : c'est exactement ce cas.
    expect(fake.attempts).toHaveLength(7)
  })

  it('rejette un enregistrement dont le signal est déjà avorté', async () => {
    // La spécification l'exige, et le faux le reproduit. Un module qui poserait
    // un contrôleur déjà avorté croirait avoir enregistré un outil absent.
    const fake = installModelContext()
    const controller = new AbortController()
    controller.abort()

    await expect(
      fake.registerTool({ ...resumeTaskTool }, { signal: controller.signal }),
    ).rejects.toThrow()
    expect(fake.names()).toEqual([])
  })
})

describe('annulation', () => {
  it('n’écrit rien quand le signal est déjà avorté', async () => {
    const task = await store.createAndOpenTask('Tâche', 'Continuer')
    const logStep = ALL_TOOLS.find((t) => t.name === 'log_step')!

    const controller = new AbortController()
    controller.abort()

    const result = await call(
      logStep,
      writeArgs(task, { action: 'a', result: 'b' }),
      controller.signal,
    )

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('CANCELLED')
    expect(store.currentTask()!.steps).toHaveLength(0)
    expect(store.currentTask()!.version).toBe(task.version)
  })

  it('n’écrit pas non plus si l’annulation survient pendant l’attente de la file', async () => {
    const task = await store.createAndOpenTask('Tâche', 'Continuer')
    const logStep = ALL_TOOLS.find((t) => t.name === 'log_step')!
    const controller = new AbortController()

    // Une première écriture occupe la file ; la seconde est annulée pendant
    // qu'elle attend son tour. C'est le cas réel du bouton « stop » d'un agent.
    const première = call(logStep, writeArgs(task, { action: 'première', result: 'ok' }))
    const seconde = call(
      logStep,
      {
        action: 'seconde',
        result: 'ko',
        based_on_version: task.version + 1,
        mutation_id: mutationId(),
      },
      controller.signal,
    )
    controller.abort()

    await première
    const result = await seconde

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('CANCELLED')

    const final = store.currentTask()!
    expect(final.steps.map((s) => s.action)).toEqual(['première'])
    // Une seule écriture appliquée : l'annulation n'a pas fait avancer la
    // version, et n'a donc pas périmé le travail des autres.
    expect(final.version).toBe(task.version + 1)

    // Et elle est AUDITÉE. Le contrôle d'annulation vivait avant le try/catch
    // du magasin : le refus ne laissait donc aucune trace, ni au journal, ni à
    // l'écran qui le lit. Une écriture qui disparaît sans qu'on puisse dire
    // pourquoi est exactement ce que ce cahier existe pour rendre impossible.
    const dernière = final.audit.at(-1)!
    expect(dernière.outcome).toBe('refused')
    expect(dernière.operation).toBe('log_step')
    expect(dernière.detail).toContain('cancelled')
    expect(dernière.versionBefore).toBe(dernière.versionAfter)
  })

  it('laisse une trace du refus, pour que l’écran le montre', async () => {
    const task = await store.createAndOpenTask('Tâche', 'Continuer')
    const logStep = ALL_TOOLS.find((t) => t.name === 'log_step')!
    const controller = new AbortController()
    controller.abort()

    await call(logStep, writeArgs(task, { action: 'a', result: 'b' }), controller.signal)

    const journal = store.currentTask()!.audit
    expect(journal.at(-1)).toMatchObject({ outcome: 'refused', operation: 'log_step' })
  })

  it('refuse aussi une lecture annulée plutôt que de la servir', async () => {
    await store.createAndOpenTask('Tâche', 'Continuer')
    const controller = new AbortController()
    controller.abort()

    const result = await call(resumeTaskTool, {}, controller.signal)
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('CANCELLED')
  })
})
