import { beforeEach, describe, expect, it } from 'vitest'
import { ALL_TOOLS } from '../src/webmcp/tools'
import * as store from '../src/store/taskStore'
import { MAX_MUTATION_RECORDS } from '../src/domain/types'
import { call, clearDatabase, currentTask, mutationId, textOf, writeArgs } from './helpers'

const logStep = ALL_TOOLS.find((t) => t.name === 'log_step')!
const addDecision = ALL_TOOLS.find((t) => t.name === 'add_decision')!

beforeEach(async () => {
  store.__resetStore()
  await clearDatabase()
})

describe('rejeu d’un même appel', () => {
  it('n’écrit qu’une fois et rend la réponse du premier appel, mot pour mot', async () => {
    const task = await store.createAndOpenTask('Tâche', 'Continuer')
    const id = mutationId()
    const args = writeArgs(task, { action: 'Lu le module', result: 'trois entrées' }, id)

    const first = await call(logStep, args)
    const second = await call(logStep, args)

    expect(first.isError).toBeUndefined()
    expect(second.isError).toBeUndefined()

    const final = currentTask()
    expect(final.steps).toHaveLength(1)
    expect(final.version).toBe(task.version + 1)

    expect(textOf(second)).toContain(textOf(first))
    expect(textOf(second)).toContain(`VERSION     ${task.version + 1}`)
  })

  it('dit que c’est un rejeu, plutôt que de le laisser croire à un doublon', async () => {
    const task = await store.createAndOpenTask('Tâche', 'Continuer')
    const args = writeArgs(task, { action: 'a', result: 'b' })

    await call(logStep, args)
    const rejeu = await call(logStep, args)

    expect(textOf(rejeu)).toContain('Replay of an earlier call')
    expect(textOf(rejeu)).toContain('Nothing was written twice')
  })

  it('passe AVANT le contrôle de version, sinon il ne servirait jamais', async () => {
    const task = await store.createAndOpenTask('Tâche', 'Continuer')
    const args = writeArgs(task, { action: 'a', result: 'b' })
    await call(logStep, args)

    const ordinaire = await call(logStep, writeArgs(task, { action: 'c', result: 'd' }))
    expect(ordinaire.isError).toBe(true)
    expect(textOf(ordinaire)).toContain('STALE STATE')

    const rejeu = await call(logStep, args)
    expect(rejeu.isError).toBeUndefined()
    expect(currentTask().steps).toHaveLength(1)
  })

  it('ne confond pas deux écritures distinctes au contenu identique', async () => {
    const task = await store.createAndOpenTask('Tâche', 'Continuer')

    await call(logStep, writeArgs(task, { action: 'Relancé les tests', result: 'ok' }))
    const v = currentTask().version
    const second = await call(logStep, {
      action: 'Relancé les tests',
      result: 'ok',
      based_on_version: v,
      mutation_id: mutationId(),
    })

    expect(second.isError).toBeUndefined()
    expect(currentTask().steps).toHaveLength(2)
  })

  it('refuse de rendre la réponse d’une autre opération sous le même jeton', async () => {
    const task = await store.createAndOpenTask('Tâche', 'Continuer')
    const id = mutationId()
    await call(logStep, writeArgs(task, { action: 'a', result: 'b' }, id))

    const v = currentTask().version
    const result = await call(addDecision, {
      choice: 'Approche C',
      rationale: 'moins coûteuse',
      based_on_version: v,
      mutation_id: id,
    })

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('mutation_id')
    expect(textOf(result)).toContain('log_step')
    expect(currentTask().decisions).toHaveLength(0)
  })

  it('ne consomme pas le jeton d’une écriture refusée', async () => {
    const task = await store.createAndOpenTask('Tâche', 'Continuer')
    const id = mutationId()

    const refused = await call(logStep, {
      action: 'a',
      result: 'b',
      based_on_version: task.version + 99,
      mutation_id: id,
    })
    expect(refused.isError).toBe(true)

    const succeeded = await call(
      logStep,
      writeArgs(currentTask(), { action: 'a', result: 'b' }, id),
    )
    expect(succeeded.isError).toBeUndefined()
    expect(textOf(succeeded)).not.toContain('Replay')
    expect(currentTask().steps).toHaveLength(1)
  })

  it('survit à un rechargement de la page', async () => {
    const task = await store.createAndOpenTask('Tâche', 'Continuer')
    const args = writeArgs(task, { action: 'a', result: 'b' })
    const first = await call(logStep, args)

    store.__resetStore()
    await store.init(task.id)

    const rejeu = await call(logStep, args)
    expect(rejeu.isError).toBeUndefined()
    expect(textOf(rejeu)).toContain(textOf(first))
    expect(currentTask().steps).toHaveLength(1)
  })

  it('borne sa mémoire, et retombe alors sur un refus lisible plutôt qu’un doublon', async () => {
    const task = await store.createAndOpenTask('Tâche', 'Continuer')
    const first = mutationId()
    await call(logStep, writeArgs(task, { action: 'la toute première', result: 'r' }, first))

    for (let i = 0; i < MAX_MUTATION_RECORDS + 2; i++) {
      await call(logStep, writeArgs(currentTask(), { action: `étape ${i}`, result: 'r' }))
    }

    const final = currentTask()
    expect(final.mutations.length).toBeLessThanOrEqual(MAX_MUTATION_RECORDS)
    expect(final.mutations.some((m) => m.id === first)).toBe(false)

    const tardif = await call(
      logStep,
      writeArgs(task, { action: 'la toute première', result: 'r' }, first),
    )
    expect(tardif.isError).toBe(true)
    expect(textOf(tardif)).toContain('STALE STATE')
  })
})

describe('collision de mutation_id', () => {
  it('refuse un même jeton porté par des arguments différents, sans rien écrire', async () => {
    const task = await store.createAndOpenTask('Tâche', 'Continuer')
    const id = mutationId()

    const first = await call(logStep, writeArgs(task, { action: 'Lu le module', result: 'ok' }, id))
    expect(first.isError).toBeUndefined()

    const second = await call(logStep, {
      action: 'Supprimé le cache',
      result: 'ok',
      based_on_version: currentTask().version,
      mutation_id: id,
    })

    expect(second.isError).toBe(true)
    expect(textOf(second)).not.toContain('OK: log_step recorded')
    expect(textOf(second)).toContain('mutation_id')
    expect(currentTask().steps).toHaveLength(1)
    expect(currentTask().steps[0].action).toBe('Lu le module')
  })

  it('rejoue quand les arguments sont les mêmes à l’ordre des clés près', async () => {
    const task = await store.createAndOpenTask('Tâche', 'Continuer')
    const id = mutationId()

    const first = await call(logStep, {
      action: 'Lancé la suite',
      result: '183 passés',
      evidence: { kind: 'command_output', content: '$ npm test' },
      based_on_version: task.version,
      mutation_id: id,
    })

    const rejeu = await call(logStep, {
      mutation_id: id,
      evidence: { content: '$ npm test', kind: 'command_output' },
      based_on_version: task.version,
      result: '183 passés',
      action: 'Lancé la suite',
    })

    expect(rejeu.isError).toBeUndefined()
    expect(textOf(rejeu)).toContain(textOf(first))
    expect(currentTask().steps).toHaveLength(1)
  })

  it('ignore les écarts que la validation efface de toute façon', async () => {
    const task = await store.createAndOpenTask('Tâche', 'Continuer')
    const id = mutationId()

    await call(logStep, writeArgs(task, { action: 'Lu le module', result: 'ok' }, id))
    const rejeu = await call(logStep, {
      action: '  Lu le module  ',
      result: 'ok',
      based_on_version: task.version,
      mutation_id: id,
    })

    expect(rejeu.isError).toBeUndefined()
    expect(currentTask().steps).toHaveLength(1)
  })

  it('distingue une collision d’arguments d’une collision d’opération', async () => {
    const task = await store.createAndOpenTask('Tâche', 'Continuer')
    const id = mutationId()
    await call(logStep, writeArgs(task, { action: 'a', result: 'b' }, id))

    const otherOperation = await call(addDecision, {
      choice: 'Approche C',
      rationale: 'moins coûteuse',
      based_on_version: currentTask().version,
      mutation_id: id,
    })
    const autresArguments = await call(logStep, {
      action: 'z',
      result: 'y',
      based_on_version: currentTask().version,
      mutation_id: id,
    })

    expect(textOf(otherOperation)).toContain('already used for log_step')
    expect(textOf(otherOperation)).not.toContain('different arguments')
    expect(textOf(autresArguments)).toContain('different arguments')
    expect(currentTask().decisions).toHaveLength(0)
    expect(currentTask().steps).toHaveLength(1)
  })

  it('inscrit la collision au journal, sans mutation ni changement de version', async () => {
    const task = await store.createAndOpenTask('Tâche', 'Continuer')
    const id = mutationId()
    await call(logStep, writeArgs(task, { action: 'Lu le module', result: 'ok' }, id))

    const before = currentTask()
    const result = await call(logStep, {
      action: 'Supprimé le cache',
      result: 'ok',
      based_on_version: before.version,
      mutation_id: id,
    })
    expect(result.isError).toBe(true)

    const after = currentTask()
    expect(after.version).toBe(before.version)
    expect(after.steps).toHaveLength(1)

    const last = after.audit.at(-1)!
    expect(last.outcome).toBe('refused')
    expect(last.operation).toBe('log_step')
    expect(last.detail).toContain('mutation-id-collision')
    expect(last.versionBefore).toBe(last.versionAfter)
  })

  it('inscrit aussi la réutilisation pour un autre outil', async () => {
    const task = await store.createAndOpenTask('Tâche', 'Continuer')
    const id = mutationId()
    await call(logStep, writeArgs(task, { action: 'a', result: 'b' }, id))

    const before = currentTask()
    await call(addDecision, {
      choice: 'Approche C',
      rationale: 'moins coûteuse',
      based_on_version: before.version,
      mutation_id: id,
    })

    const last = currentTask().audit.at(-1)!
    expect(last).toMatchObject({ outcome: 'refused', operation: 'add_decision' })
    expect(last.detail).toContain('mutation-id-reused')
    expect(currentTask().version).toBe(before.version)
  })

  it('ne salit pas le journal pour un rejeu, qui n’est le refus de rien', async () => {
    const task = await store.createAndOpenTask('Tâche', 'Continuer')
    const args = writeArgs(task, { action: 'a', result: 'b' })
    await call(logStep, args)

    const before = currentTask().audit.length
    await call(logStep, args)

    expect(currentTask().audit).toHaveLength(before)
  })

  it('n’accepte pas un enregistrement sans empreinte comme base de rejeu', async () => {
    const task = await store.createAndOpenTask('Tâche', 'Continuer')
    const id = mutationId()
    await call(logStep, writeArgs(task, { action: 'a', result: 'b' }, id))

    const raw = currentTask()
    await store.openPreparedTask({
      ...raw,
      mutations: raw.mutations.map((m) => ({ ...m, fingerprint: undefined })),
    } as unknown as typeof raw)

    store.__resetStore()
    await store.init(task.id)
    expect(currentTask().mutations).toHaveLength(0)

    const tardif = await call(logStep, writeArgs(task, { action: 'a', result: 'b' }, id))
    expect(tardif.isError).toBe(true)
    expect(textOf(tardif)).toContain('STALE STATE')
  })
})
