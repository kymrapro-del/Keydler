import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { TaskState } from '../domain/types'
import type { SecretRef } from '../domain/secret'

const DB_NAME = 'cahier-de-quart'

const DB_VERSION = 3

interface KeydlerDB extends DBSchema {
  tasks: {
    key: string
    value: TaskState
    indexes: { 'by-updatedAt': number; 'by-id-version': [string, number] }
  }
  meta: {
    key: string
    value: string
  }
  secrets: {
    key: string
    value: SecretRef
    indexes: { 'by-taskId': string }
  }
}

let dbPromise: Promise<IDBPDatabase<KeydlerDB>> | null = null

export function getDb(): Promise<IDBPDatabase<KeydlerDB>> {
  if (!dbPromise) {
    dbPromise = openDB<KeydlerDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, transaction) {
        if (oldVersion < 1) {
          const tasks = db.createObjectStore('tasks', { keyPath: 'id' })
          tasks.createIndex('by-updatedAt', 'updatedAt')
          db.createObjectStore('meta')
        }
        if (oldVersion < 2) {
          const secrets = db.createObjectStore('secrets', { keyPath: 'id' })
          secrets.createIndex('by-taskId', 'taskId')
        }
        if (oldVersion < 3) {
          // Le contrôle de concurrence n'a besoin QUE de la version, et la
          // lisait en relisant tout le cahier, 2 ms pour 800 ko dans Chrome,
          // contre 0,1 ms pour une clé. L'index porte les deux champs du
          // cahier lui-même : aucun miroir à tenir à jour, donc rien qui
          // puisse dériver de ce qu'il garde.
          transaction.objectStore('tasks').createIndex('by-id-version', ['id', 'version'])
        }
      },

      blocked() {
        console.warn(
          '[keydler] Storage upgrade blocked: another tab still holds the older version. Close it, then reload.',
        )
      },

      blocking() {
        void getDb().then((db) => db.close())
        dbPromise = null
      },

      terminated() {
        dbPromise = null
      },
    })
  }
  return dbPromise
}

export type { KeydlerDB }
