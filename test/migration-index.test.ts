import { describe, expect, it } from 'vitest'
import { ConcurrentWriteError, TaskGoneError } from '../src/domain/errors'
import { buildCoreTask } from '../src/demo/seed'
import { loadTask, saveTask } from '../src/persistence/taskRepository'
import { getDb } from '../src/persistence/db'
import type { TaskState } from '../src/domain/types'

// Le contrôle de concurrence passe par l'index `by-id-version` plutôt que par une
// relecture complète du cahier : 2 ms pour 800 ko dans Chrome, contre 0,1 ms pour une
// clé. Ce fichier ouvre la base à l'ANCIENNE version avant que quoi que ce soit
// d'autre n'y touche, pour que la migration ait vraiment lieu : `getDb()` mémorise sa
// promesse, et un seul appel plus tôt rendrait l'épreuve creuse.
function ancienneBase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const requête = indexedDB.open('cahier-de-quart', 2)
    requête.onupgradeneeded = () => {
      const db = requête.result
      const tasks = db.createObjectStore('tasks', { keyPath: 'id' })
      tasks.createIndex('by-updatedAt', 'updatedAt')
      db.createObjectStore('meta')
      const secrets = db.createObjectStore('secrets', { keyPath: 'id' })
      secrets.createIndex('by-taskId', 'taskId')
    }
    requête.onsuccess = () => resolve(requête.result)
    requête.onerror = () => reject(requête.error)
  })
}

function écrireÀLAncienne(db: IDBDatabase, task: TaskState): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('tasks', 'readwrite')
    tx.objectStore('tasks').put({ ...task, schemaVersion: 10 })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

describe('un cahier écrit avant l’index reste protégé', () => {
  it('migre, puis refuse une écriture périmée et dit la version réelle', async () => {
    const posé: TaskState = { ...buildCoreTask(), id: 'ancien', version: 7 }

    const vieille = await ancienneBase()
    await écrireÀLAncienne(vieille, posé)
    vieille.close()

    // Premier contact du code applicatif avec la base : c'est ici que la
    // migration vers l'index a lieu, sur un enregistrement déjà présent.
    const db = await getDb()
    expect(db.version).toBe(3)

    const relu = await loadTask('ancien')
    expect(relu?.version).toBe(7)

    // À la bonne version : accepté.
    await saveTask({ ...relu!, version: 8 }, 7)
    expect((await loadTask('ancien'))?.version).toBe(8)

    // À une version périmée : refusé, et le message porte la version RÉELLE,
    // sans quoi l'appelant ne saurait pas sur quoi se rebaser.
    const erreur = await saveTask({ ...relu!, version: 9 }, 7).catch((e) => e)
    expect(erreur).toBeInstanceOf(ConcurrentWriteError)
    expect((erreur as ConcurrentWriteError).message).toContain('8')
    expect((await loadTask('ancien'))?.version).toBe(8)
  })

  // Une écriture qui PORTE une version attendue est par définition une mise à jour :
  // les créations passent par le chemin sans version. Une clé absente est donc un
  // cahier supprimé ailleurs, et le laisser passer le ressuscitait avec toutes ses
  // étapes et ses preuves, mais sans ses identifiants scellés, eux réellement effacés.
  it('refuse de ressusciter un cahier supprimé, et ne le recrée pas', async () => {
    const posé: TaskState = { ...buildCoreTask(), id: 'supprime', version: 3 }
    await saveTask(posé)
    expect((await loadTask('supprime'))?.version).toBe(3)

    const db = await getDb()
    await db.delete('tasks', 'supprime')

    const erreur = await saveTask({ ...posé, version: 4 }, 3).catch((e) => e)
    expect(erreur).toBeInstanceOf(TaskGoneError)
    expect((erreur as Error).message).toContain('was deleted')
    expect(await loadTask('supprime')).toBeUndefined()
  })

  it('laisse passer une création, qui ne porte aucune version attendue', async () => {
    const neuf: TaskState = { ...buildCoreTask(), id: 'jamais-vu', version: 1 }
    await saveTask(neuf)
    expect((await loadTask('jamais-vu'))?.version).toBe(1)
  })
})
