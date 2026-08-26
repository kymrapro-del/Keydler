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

      /**
       * Un autre onglet tient encore l'ancienne version ouverte, ce qui
       * empêche la montée de version. Sans ce signal, `getDb()` resterait en
       * attente indéfiniment et la page paraîtrait figée sans rien dire.
       */
      blocked() {
        console.warn(
          '[cahier-de-quart] Mise à jour du stockage bloquée : un autre onglet tient encore l’ancienne version. Fermez-le puis rechargez.',
        )
      },

      /** C'est nous qui bloquons une autre page : on lui rend la main. */
      blocking() {
        void getDb().then((db) => db.close())
        dbPromise = null
      },

      /** Le navigateur a fermé la connexion de son côté (mémoire, onglet inactif). */
      terminated() {
        dbPromise = null
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
