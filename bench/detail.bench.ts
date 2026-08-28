import { describe, it } from 'vitest'
import { buildCoreTask } from '../src/demo/seed'
import { getDb } from '../src/persistence/db'
import { normalizeTask, toStored } from '../src/persistence/normalize'
import { loadTask, putTask, saveTask } from '../src/persistence/taskRepository'
import * as store from '../src/store/taskStore'
import { __renderNow, mount } from '../src/ui/bench'
import type { Step, TaskState } from '../src/domain/types'

/**
 * Le banc de détail : où passe le temps DANS un chemin, plutôt que combien
 * coûte le chemin entier. Il sert à décider s'il vaut la peine de toucher à
 * quelque chose — et souvent à décider que non.
 */

function steps(n: number, preuve = true): Step[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `s${i}`,
    action: `Ran the migration on shard ${i} and checked the row count matched`,
    result: `Shard ${i} moved, 4211 rows, no drift detected in the checksum`,
    evidence:
      preuve && i % 3 === 0
        ? { kind: 'command_output' as const, content: 'ok '.repeat(120), verifiedAt: null }
        : null,
    dispute: null,
    confidence: 'evidence' as const,
    basedOnVersion: i,
    source: 'agent' as const,
    at: 1_700_000_000_000 + i,
  }))
}

function median(times: number[]): number {
  const sorted = [...times].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

async function timed(label: string, fn: () => Promise<unknown>, runs = 9): Promise<void> {
  await fn()
  const times: number[] = []
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now()
    await fn()
    times.push(performance.now() - t0)
  }
  console.log(`  ${label.padEnd(52)} ${median(times).toFixed(2)} ms`)
}

function sync(label: string, fn: () => unknown, runs = 9): void {
  fn()
  const times: number[] = []
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now()
    fn()
    times.push(performance.now() - t0)
  }
  console.log(`  ${label.padEnd(52)} ${median(times).toFixed(2)} ms`)
}

async function wipe(): Promise<void> {
  const db = await getDb()
  const tx = db.transaction(['tasks', 'meta', 'secrets'], 'readwrite')
  await Promise.all([
    tx.objectStore('tasks').clear(),
    tx.objectStore('meta').clear(),
    tx.objectStore('secrets').clear(),
    tx.done,
  ])
}

describe('détail', () => {
  it('où passe le temps dans une écriture', async () => {
    for (const n of [500, 4000]) {
      const task: TaskState = { ...buildCoreTask(), id: 'w', steps: steps(n) }
      await wipe()
      await putTask(task)
      const db = await getDb()
      console.log(`\n  --- ${n} étapes ---`)

      await timed('db.get complet (le contrôle de version le fait)', () => db.get('tasks', 'w'))
      await timed('db.put complet', () => db.put('tasks', toStored(task)))
      await timed('saveTask AVEC contrôle de version', () => saveTask(task, task.version))
      await timed('saveTask SANS contrôle de version', () => saveTask(task))
      await timed('loadTask (get + normalize)', () => loadTask('w'))
      // Le clone était DANS la mesure : `normalizeTask` paraissait coûter
      // 26,34 ms là où il en coûte 1,18 — un facteur 22, et il pointait vers
      // le mauvais correctif (« accélérer normalize » au lieu de « lire moins
      // souvent »). Le clone est fait une fois, hors du chronomètre.
      const cloné = structuredClone(toStored(task))
      sync('normalizeTask seul', () => normalizeTask(cloné), 5)
      sync('structuredClone seul', () => structuredClone(toStored(task)), 5)
    }
  }, 300_000)

  it('où passe le temps dans un rendu', async () => {
    await wipe()
    store.__resetStore()
    await store.init()
    document.body.innerHTML = '<div id="annonces"></div><div id="app"></div>'
    const root = document.querySelector<HTMLElement>('#app')!
    mount(root)
    await store.openPreparedTask({ ...buildCoreTask(), steps: steps(2000) })
    __renderNow()

    const html = root.innerHTML
    console.log(
      `\n  html rendu : ${html.length} caractères, ${root.querySelectorAll('*').length} nœuds`,
    )
    sync('render() complet (chaîne identique : saute tout)', () => __renderNow())
    sync('innerHTML = même chaîne (analyse HTML seule)', () => {
      root.innerHTML = html
    })
    sync('querySelectorAll sur tous les boutons', () => root.querySelectorAll('button').length)
  }, 300_000)

  it('un rendu qui change vraiment, sur un gros cahier', async () => {
    await wipe()
    store.__resetStore()
    await store.init()
    document.body.innerHTML = '<div id="annonces"></div><div id="app"></div>'
    const root = document.querySelector<HTMLElement>('#app')!
    mount(root)
    await store.openPreparedTask({ ...buildCoreTask(), steps: steps(20000) })
    __renderNow()

    const durées: number[] = []
    for (let i = 0; i < 12; i++) {
      await store.mutate((st) => ({ ...st, version: st.version + 1, next: `tour ${i}` }))
      const t0 = performance.now()
      __renderNow()
      durées.push(performance.now() - t0)
    }
    console.log(`\n  rendu changeant (le cahier bouge)   : ${median(durées).toFixed(2)} ms`)

    // Le cas qui compte vraiment : le cahier ne bouge PAS, mais l'écran si —
    // une frappe dans la recherche, une liste que l'on déplie. C'est là que
    // tout ce qui dépend du seul cahier peut être réutilisé.
    const champ = root.querySelector<HTMLInputElement>('#search')
    const interactifs: number[] = []
    for (let i = 0; i < 12; i++) {
      if (champ) {
        champ.value = 'shard'.slice(0, (i % 5) + 1)
        champ.dispatchEvent(new Event('input', { bubbles: true }))
      }
      const t0 = performance.now()
      __renderNow()
      interactifs.push(performance.now() - t0)
    }
    console.log(
      `  rendu interactif (le cahier ne bouge pas) : ${median(interactifs).toFixed(2)} ms${champ ? '' : '  [PAS DE CHAMP]'}`,
    )
  }, 300_000)

  it('démarrage', async () => {
    for (const [nombre, taille] of [
      [1, 200],
      [1, 20000],
      [30, 500],
    ] as const) {
      await wipe()
      for (let i = 0; i < nombre; i++) {
        await putTask({ ...buildCoreTask(), id: `t${i}`, title: `T${i}`, steps: steps(taille) })
      }
      const db = await getDb()
      await db.put('meta', 't0', 'lastTaskId')

      store.__resetStore()
      const t0 = performance.now()
      await store.init()
      const avec = performance.now() - t0

      // Le chemin de repli : plus de `lastTaskId`, donc listTasks() entier.
      await db.delete('meta', 'lastTaskId')
      store.__resetStore()
      const t1 = performance.now()
      await store.init()
      const sans = performance.now() - t1

      console.log(
        `  ${String(nombre).padEnd(3)} cahiers × ${String(taille).padEnd(6)} étapes : init ${avec.toFixed(1)} ms · sans lastTaskId ${sans.toFixed(1)} ms`,
      )
    }
  }, 300_000)

  it('mémoire retenue par la liste des cahiers', async () => {
    const mo = (n: number) => `${(n / 1024 / 1024).toFixed(1)} Mo`
    await wipe()
    for (let i = 0; i < 20; i++) {
      await putTask({ ...buildCoreTask(), id: `t${i}`, title: `T${i}`, steps: steps(2000) })
    }

    // Le tas d'un worker est trop bruyant pour trancher ici. On mesure donc ce
    // qui est RETENU par sa taille sérialisée : un mandataire déterministe, et
    // proportionnel à ce que la page garde ouvert en permanence.
    const entiers = JSON.stringify(await store.allTasks()).length
    const fiches = JSON.stringify(await store.allTaskCards()).length

    console.log('\n  20 cahiers × 2000 étapes, retenus par le sélecteur :')
    console.log(`    cahiers entiers (avant) : ${mo(entiers)}`)
    console.log(
      `    fiches (après)          : ${mo(fiches)}  (${(entiers / fiches).toFixed(0)}× moins)`,
    )
  }, 300_000)

  it('mémoire tenue par un cahier', async () => {
    const mo = (n: number) => `${(n / 1024 / 1024).toFixed(1)} Mo`
    for (const n of [1000, 20000]) {
      global.gc?.()
      const avant = process.memoryUsage().heapUsed
      const task: TaskState = { ...buildCoreTask(), steps: steps(n) }
      const json = JSON.stringify(task).length
      global.gc?.()
      const après = process.memoryUsage().heapUsed
      console.log(
        `  ${String(n).padEnd(6)} étapes : ${mo(après - avant)} en tas · ${mo(json)} en JSON`,
      )
      void task
    }
  }, 300_000)
})
