import type { RealtimeChannel } from '@supabase/supabase-js'
import { normalizeTask } from '../persistence/normalize'
import * as store from '../store/taskStore'
import { requireCloudClient } from './client'
import { listRemoteTasks, pushRemoteTask } from './repository'
import { getCloudState, updateCloudState } from './state'

let workspaceId: string | null = null
let unsubscribeStore: (() => void) | null = null
let channel: RealtimeChannel | null = null
let timer: ReturnType<typeof setTimeout> | null = null
let running: Promise<void> | null = null
let rerun = false

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function runSync(): Promise<void> {
  const target = workspaceId
  const state = getCloudState()
  if (!target || state.auth !== 'signed-in' || !state.settings.cloudSyncEnabled) return

  if (running) {
    rerun = true
    return running
  }

  updateCloudState({ sync: 'syncing', error: null })
  running = (async () => {
    const [remoteRows, localTasks] = await Promise.all([listRemoteTasks(target), store.allTasks()])
    const remote = new Map(remoteRows.map((row) => [row.task_id, row]))
    const local = new Map(localTasks.map((task) => [task.id, task]))

    for (const task of localTasks) {
      const cloud = remote.get(task.id)
      if (!cloud || task.version > cloud.version) await pushRemoteTask(target, task)
    }

    for (const row of remoteRows) {
      const task = normalizeTask(row.state)
      if (!task) continue
      const device = local.get(task.id)
      if (!device || task.version > device.version) await store.mergeCloudTask(task)
    }

    updateCloudState({ sync: 'synced', lastSyncedAt: Date.now(), error: null })
  })()

  try {
    await running
  } catch (error) {
    updateCloudState({ sync: 'error', error: errorMessage(error) })
  } finally {
    running = null
    if (rerun) {
      rerun = false
      void runSync()
    }
  }
}

export function requestCloudSync(): void {
  if (timer !== null) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void runSync()
  }, 500)
}

export function startCloudSync(nextWorkspaceId: string): void {
  stopCloudSync()
  workspaceId = nextWorkspaceId
  if (!getCloudState().settings.cloudSyncEnabled) {
    updateCloudState({ sync: 'local-only' })
    return
  }

  unsubscribeStore = store.subscribe(requestCloudSync)
  channel = requireCloudClient()
    .channel(`workspace:${nextWorkspaceId}:tasks`, { config: { private: true } })
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'task_snapshots',
        filter: `workspace_id=eq.${nextWorkspaceId}`,
      },
      requestCloudSync,
    )
    .subscribe()
  void runSync()
}

export function stopCloudSync(): void {
  if (timer !== null) clearTimeout(timer)
  timer = null
  unsubscribeStore?.()
  unsubscribeStore = null
  if (channel) void requireCloudClient().removeChannel(channel)
  channel = null
  workspaceId = null
  rerun = false
}

export async function syncNow(): Promise<void> {
  await runSync()
}

export function __resetCloudSync(): void {
  stopCloudSync()
  running = null
}
