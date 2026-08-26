import { beforeEach, describe, expect, it } from 'vitest'
import * as store from '../src/store/taskStore'
import { setNext } from '../src/domain/task'
import { resumeTaskTool } from '../src/webmcp/tools'
import { call, clearDatabase, currentTask, settle } from './helpers'

/**
 * Le chargement initial ne doit pas défaire une écriture.
 *
 * `store.init()` lit le disque et pose le résultat comme état courant. Il n'a
 * jamais traversé la file d'écriture : sa lecture pouvait donc démarrer avant
 * qu'une écriture en cours ne soit persistée, et son `setSnapshot` atterrir
 * après — replaçant en mémoire un état ANTÉRIEUR à celui que la page venait
 * d'appliquer.
 *
 * Le déclencheur est banal : `requireTask()` appelle `init()`, donc le tout
 * premier appel d'outil d'un agent suffit. Une contrainte que l'humain vient
 * de poser disparaît de l'écran et de la restitution, et la version recule —
 * exactement la perte silencieuse que ce produit existe pour empêcher.
 */
beforeEach(async () => {
  store.__resetStore()
  await clearDatabase()
})

describe('chargement initial concurrent à une écriture', () => {
  it('ne remplace pas l’état appliqué par une lecture du disque plus ancienne', async () => {
    const task = await store.createAndOpenTask('Tâche', 'Continuer')

    // L'humain écrit pendant que le premier appel d'outil de l'agent déclenche
    // le chargement initial. La lecture du disque part au milieu de la file,
    // donc avant que la seconde écriture ne soit persistée.
    const premier = store.mutate((s) => setNext(s, 'première'))
    const agent = call(resumeTaskTool)
    const second = store.mutate((s) => setNext(s, 'nouvelle prochaine action'))

    await Promise.all([premier, agent, second])
    await settle(4)

    const final = currentTask()
    expect(final.version).toBe(task.version + 2)
    expect(final.next).toBe('nouvelle prochaine action')
  })

  it('ne fait jamais reculer la version, même sur plusieurs écritures en vol', async () => {
    const task = await store.createAndOpenTask('Tâche', 'Continuer')
    const versions: number[] = []
    store.subscribe(() => {
      const v = store.currentTask()?.version
      if (v !== undefined) versions.push(v)
    })

    const écritures = [
      store.mutate((s) => setNext(s, 'une')),
      call(resumeTaskTool),
      store.mutate((s) => setNext(s, 'deux')),
    ]
    await Promise.all(écritures)
    await settle(4)

    // La version est un compteur qui n'est jamais décrémenté ni réutilisé.
    // Une seule inversion dans cette suite signifie qu'un état plus ancien a
    // été réappliqué par-dessus un plus récent.
    const reculs = versions.filter((v, i) => i > 0 && v < versions[i - 1])
    expect(reculs).toEqual([])
    expect(currentTask().version).toBe(task.version + 2)
  })
})
