import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { TaskState } from '../domain/types'

/**
 * Persistance locale (TAL-69).
 *
 * Tout vit dans le navigateur : pas de compte, pas de serveur, pas de donnée
 * qui sort de l'appareil. Cela supprime la moitié du travail et rend la
 * démonstration reproductible par n'importe qui, sans inscription.
 */

const DB_NAME = 'cahier-de-quart'

/**
 * Version du schéma IndexedDB. Incrémenter impose d'ajouter une branche dans
 * `upgrade` : un utilisateur qui revient sur le site a déjà l'ancienne base.
 */
const DB_VERSION = 1

interface WatchLogDB extends DBSchema {
  tasks: {
    key: string
    value: TaskState
    indexes: { 'by-updatedAt': number }
  }
  meta: {
    key: string
    value: string
  }
}

let dbPromise: Promise<IDBPDatabase<WatchLogDB>> | null = null

export function getDb(): Promise<IDBPDatabase<WatchLogDB>> {
  if (!dbPromise) {
    dbPromise = openDB<WatchLogDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const tasks = db.createObjectStore('tasks', { keyPath: 'id' })
          tasks.createIndex('by-updatedAt', 'updatedAt')
          db.createObjectStore('meta')
        }
      },
    })
  }
  return dbPromise
}

/** Réinitialise le handle mémorisé. Réservé aux tests. */
export function resetDbHandle(): void {
  dbPromise = null
}

export type { WatchLogDB }
