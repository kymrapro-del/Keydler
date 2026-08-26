import { beforeEach, describe, expect, it } from 'vitest'
import { ALL_TOOLS } from '../src/webmcp/tools'
import * as store from '../src/store/taskStore'
import { MAX_MUTATION_RECORDS } from '../src/domain/types'
import { call, clearDatabase, currentTask, mutationId, textOf, writeArgs } from './helpers'

/**
 * Idempotence des écritures.
 *
 * Le besoin n'est pas théorique, et il vient de la spécification elle-même :
 * WebMCP JETTE le résultat d'une exécution annulée. L'écriture a eu lieu, la
 * réponse n'arrive jamais, et l'agent fait la seule chose sensée — il réessaie.
 * Sans mémoire de ce qui a déjà été fait, le cahier compte deux fois le même
 * travail, et le produit qui existe pour empêcher la perte silencieuse se met
 * à produire de la duplication silencieuse.
 *
 * Un `mutation_id` identifie UNE écriture. Deux appels qui le partagent sont le
 * même appel.
 */

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

    const premier = await call(logStep, args)
    // Exactement les mêmes arguments, y compris la version — qui est désormais
    // périmée. C'est le réessai naturel d'un agent qui n'a rien reçu.
    const second = await call(logStep, args)

    expect(premier.isError).toBeUndefined()
    expect(second.isError).toBeUndefined()

    // Un seul travail consigné, une seule version consommée.
    const final = currentTask()
    expect(final.steps).toHaveLength(1)
    expect(final.version).toBe(task.version + 1)

    // La réponse du premier appel est restituée telle quelle. Ce n'est pas
    // « une réponse équivalente » : c'est la même chaîne, conservée.
    expect(textOf(second)).toContain(textOf(premier))
    expect(textOf(second)).toContain(`VERSION     ${task.version + 1}`)
  })

  it('dit que c’est un rejeu, plutôt que de le laisser croire à un doublon', async () => {
    const task = await store.createAndOpenTask('Tâche', 'Continuer')
    const args = writeArgs(task, { action: 'a', result: 'b' })

    await call(logStep, args)
    const rejeu = await call(logStep, args)

    // Sans cette ligne, deux réponses identiques se lisent comme deux
    // écritures réussies, et l'agent conclut qu'il a consigné deux fois.
    expect(textOf(rejeu)).toContain('Replay of an earlier call')
    expect(textOf(rejeu)).toContain('Nothing was written twice')
  })

  it('passe AVANT le contrôle de version, sinon il ne servirait jamais', async () => {
    const task = await store.createAndOpenTask('Tâche', 'Continuer')
    const args = writeArgs(task, { action: 'a', result: 'b' })
    await call(logStep, args)

    // La version a bougé, et une écriture ordinaire sur cette version tombe.
    const ordinaire = await call(logStep, writeArgs(task, { action: 'c', result: 'd' }))
    expect(ordinaire.isError).toBe(true)
    expect(textOf(ordinaire)).toContain('STALE STATE')

    // Le rejeu, lui, aboutit : un réessai porte NÉCESSAIREMENT une version
    // périmée, puisque l'appel d'origine l'a fait avancer. Contrôler d'abord
    // rendrait STALE STATE à un agent qui ne demande que sa réponse perdue.
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

    // Deux jetons, deux intentions : refaire le même geste est légitime, et
    // dédupliquer sur le contenu effacerait un travail réellement accompli.
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

    // Rendre la réponse du log_step accuserait réception d'une décision qui
    // n'a jamais été prise.
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('mutation_id')
    expect(textOf(result)).toContain('log_step')
    expect(currentTask().decisions).toHaveLength(0)
  })

  it('ne consomme pas le jeton d’une écriture refusée', async () => {
    const task = await store.createAndOpenTask('Tâche', 'Continuer')
    const id = mutationId()

    // Refusée pour version périmée : rien n'a été écrit, donc rien n'est à
    // mémoriser. Retenir le jeton condamnerait l'agent à ne jamais pouvoir
    // aboutir avec lui, alors que sa seule faute était la version.
    const refusé = await call(logStep, {
      action: 'a',
      result: 'b',
      based_on_version: task.version + 99,
      mutation_id: id,
    })
    expect(refusé.isError).toBe(true)

    const réussi = await call(logStep, writeArgs(currentTask(), { action: 'a', result: 'b' }, id))
    expect(réussi.isError).toBeUndefined()
    expect(textOf(réussi)).not.toContain('Replay')
    expect(currentTask().steps).toHaveLength(1)
  })

  it('survit à un rechargement de la page', async () => {
    const task = await store.createAndOpenTask('Tâche', 'Continuer')
    const args = writeArgs(task, { action: 'a', result: 'b' })
    const premier = await call(logStep, args)

    // La page est fermée puis rouverte : la garantie ne peut pas vivre en
    // mémoire, sinon un rechargement pendant un réessai suffirait à dupliquer.
    store.__resetStore()
    await store.init(task.id)

    const rejeu = await call(logStep, args)
    expect(rejeu.isError).toBeUndefined()
    expect(textOf(rejeu)).toContain(textOf(premier))
    expect(currentTask().steps).toHaveLength(1)
  })

  it('borne sa mémoire, et retombe alors sur un refus lisible plutôt qu’un doublon', async () => {
    const task = await store.createAndOpenTask('Tâche', 'Continuer')
    const premier = mutationId()
    await call(logStep, writeArgs(task, { action: 'la toute première', result: 'r' }, premier))

    for (let i = 0; i < MAX_MUTATION_RECORDS + 2; i++) {
      await call(logStep, writeArgs(currentTask(), { action: `étape ${i}`, result: 'r' }))
    }

    const final = currentTask()
    expect(final.mutations.length).toBeLessThanOrEqual(MAX_MUTATION_RECORDS)
    expect(final.mutations.some((m) => m.id === premier)).toBe(false)

    // Le jeton le plus ancien est oublié. Un réessai devient alors une
    // écriture ordinaire — donc refusée pour version périmée, ce qui est un
    // refus lisible et non une duplication muette.
    const tardif = await call(
      logStep,
      writeArgs(task, { action: 'la toute première', result: 'r' }, premier),
    )
    expect(tardif.isError).toBe(true)
    expect(textOf(tardif)).toContain('STALE STATE')
  })
})

describe('collision de mutation_id', () => {
  /**
   * Un `mutation_id` sans empreinte des arguments ne distingue pas un rejeu
   * d'une collision.
   *
   * Les agents produisent ces jetons ; rien ne garantit qu'ils soient uniques.
   * Un compteur remis à zéro entre deux conversations, un identifiant dérivé du
   * numéro d'étape, un modèle qui recopie l'exemple de la description — et deux
   * travaux DIFFÉRENTS arrivent sous le même jeton. Le second était alors
   * accueilli par la réponse du premier : jamais écrit, et pourtant accusé
   * réception. C'est une perte silencieuse, la seule chose que ce produit
   * promette d'empêcher.
   */

  it('refuse un même jeton porté par des arguments différents, sans rien écrire', async () => {
    const task = await store.createAndOpenTask('Tâche', 'Continuer')
    const id = mutationId()

    const premier = await call(
      logStep,
      writeArgs(task, { action: 'Lu le module', result: 'ok' }, id),
    )
    expect(premier.isError).toBeUndefined()

    const second = await call(logStep, {
      action: 'Supprimé le cache',
      result: 'ok',
      based_on_version: currentTask().version,
      mutation_id: id,
    })

    expect(second.isError).toBe(true)
    // Ni écrit, ni accusé réception : les deux fautes seraient graves, et la
    // seconde davantage — un agent qui croit son travail consigné ne le
    // reconsignera pas.
    expect(textOf(second)).not.toContain('OK — log_step recorded')
    expect(textOf(second)).toContain('mutation_id')
    expect(currentTask().steps).toHaveLength(1)
    expect(currentTask().steps[0].action).toBe('Lu le module')
  })

  it('rejoue quand les arguments sont les mêmes à l’ordre des clés près', async () => {
    const task = await store.createAndOpenTask('Tâche', 'Continuer')
    const id = mutationId()

    const premier = await call(logStep, {
      action: 'Lancé la suite',
      result: '183 passés',
      evidence: { kind: 'command_output', content: '$ npm test' },
      based_on_version: task.version,
      mutation_id: id,
    })

    // Mêmes arguments, sérialisés dans un autre ordre — ce qu'un agent fait
    // sans y penser d'un appel à l'autre. C'est le MÊME appel.
    const rejeu = await call(logStep, {
      mutation_id: id,
      evidence: { content: '$ npm test', kind: 'command_output' },
      based_on_version: task.version,
      result: '183 passés',
      action: 'Lancé la suite',
    })

    expect(rejeu.isError).toBeUndefined()
    expect(textOf(rejeu)).toContain(textOf(premier))
    expect(currentTask().steps).toHaveLength(1)
  })

  it('ignore les écarts que la validation efface de toute façon', async () => {
    const task = await store.createAndOpenTask('Tâche', 'Continuer')
    const id = mutationId()

    await call(logStep, writeArgs(task, { action: 'Lu le module', result: 'ok' }, id))
    // Le domaine trime : ces deux appels portent la même intention validée.
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

    const autreOpération = await call(addDecision, {
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

    // Deux fautes différentes, deux messages différents : l'agent doit savoir
    // s'il a réutilisé un jeton pour un autre outil ou pour un autre travail.
    // Les deux nomment l'opération d'ORIGINE, seule information utile pour
    // retrouver ce que le jeton désigne déjà.
    expect(textOf(autreOpération)).toContain('already used for log_step')
    expect(textOf(autreOpération)).not.toContain('different arguments')
    expect(textOf(autresArguments)).toContain('different arguments')
    expect(currentTask().decisions).toHaveLength(0)
    expect(currentTask().steps).toHaveLength(1)
  })

  it('inscrit la collision au journal, sans mutation ni changement de version', async () => {
    const task = await store.createAndOpenTask('Tâche', 'Continuer')
    const id = mutationId()
    await call(logStep, writeArgs(task, { action: 'Lu le module', result: 'ok' }, id))

    const avant = currentTask()
    const result = await call(logStep, {
      action: 'Supprimé le cache',
      result: 'ok',
      based_on_version: avant.version,
      mutation_id: id,
    })
    expect(result.isError).toBe(true)

    const après = currentTask()
    // Rien n'a bougé sinon la trace elle-même.
    expect(après.version).toBe(avant.version)
    expect(après.steps).toHaveLength(1)

    // Et la trace existe. Les contrôles de collision vivaient au-dessus du
    // try/catch qui la produit : le refus n'atteignait donc ni le journal, ni
    // l'écran qui le lit. C'est la même faute que pour l'annulation, sur le
    // refus le plus grave du lot — celui qui dit à un agent que son travail
    // n'a pas été consigné.
    const dernière = après.audit.at(-1)!
    expect(dernière.outcome).toBe('refused')
    expect(dernière.operation).toBe('log_step')
    expect(dernière.detail).toContain('mutation-id-collision')
    expect(dernière.versionBefore).toBe(dernière.versionAfter)
  })

  it('inscrit aussi la réutilisation pour un autre outil', async () => {
    const task = await store.createAndOpenTask('Tâche', 'Continuer')
    const id = mutationId()
    await call(logStep, writeArgs(task, { action: 'a', result: 'b' }, id))

    const avant = currentTask()
    await call(addDecision, {
      choice: 'Approche C',
      rationale: 'moins coûteuse',
      based_on_version: avant.version,
      mutation_id: id,
    })

    const dernière = currentTask().audit.at(-1)!
    expect(dernière).toMatchObject({ outcome: 'refused', operation: 'add_decision' })
    expect(dernière.detail).toContain('mutation-id-reused')
    expect(currentTask().version).toBe(avant.version)
  })

  it('ne salit pas le journal pour un rejeu, qui n’est le refus de rien', async () => {
    const task = await store.createAndOpenTask('Tâche', 'Continuer')
    const args = writeArgs(task, { action: 'a', result: 'b' })
    await call(logStep, args)

    const avant = currentTask().audit.length
    await call(logStep, args)

    // Un rejeu ne refuse rien et n'écrit rien : lui donner une ligne noierait
    // les vrais refus dans le bruit d'agents qui réessaient.
    expect(currentTask().audit).toHaveLength(avant)
  })

  it('n’accepte pas un enregistrement sans empreinte comme base de rejeu', async () => {
    const task = await store.createAndOpenTask('Tâche', 'Continuer')
    const id = mutationId()
    await call(logStep, writeArgs(task, { action: 'a', result: 'b' }, id))

    // Un enregistrement écrit avant l'empreinte ne permet pas de vérifier que
    // le réessai porte bien la même intention. Le relire comme un rejeu
    // valable rendrait la faute ci-dessus indétectable pour les cahiers déjà
    // sur disque : on l'écarte plutôt.
    const brut = currentTask()
    await store.openPreparedTask({
      ...brut,
      mutations: brut.mutations.map((m) => ({ ...m, fingerprint: undefined })),
    } as unknown as typeof brut)

    // Relu depuis le disque : c'est la lecture défensive qui doit l'écarter.
    store.__resetStore()
    await store.init(task.id)
    expect(currentTask().mutations).toHaveLength(0)

    // La conséquence est bornée et lisible : le réessai redevient une écriture
    // ordinaire, donc refusée pour version périmée — un refus, pas un doublon.
    const tardif = await call(logStep, writeArgs(task, { action: 'a', result: 'b' }, id))
    expect(tardif.isError).toBe(true)
    expect(textOf(tardif)).toContain('STALE STATE')
  })
})
