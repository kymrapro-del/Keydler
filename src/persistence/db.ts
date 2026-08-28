import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { TaskState } from '../domain/types'
import type { SecretRef } from '../domain/secret'

const DB_NAME = 'cahier-de-quart'

const DB_VERSION = 2

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
  secrets: {
    key: string
    value: SecretRef
    indexes: { 'by-taskId': string }
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
        if (oldVersion < 2) {
          const secrets = db.createObjectStore('secrets', { keyPath: 'id' })
          secrets.createIndex('by-taskId', 'taskId')
        }
      },

      blocked() {
        console.warn(
          '[watch-log] Storage upgrade blocked: another tab still holds the older version. Close it, then reload.',
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

export type { WatchLogDB }
