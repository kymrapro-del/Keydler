import { ALL_TOOLS } from '../webmcp/tools'
import { cloudConfigured } from './client'
import { DEFAULT_CLOUD_SETTINGS, type CloudState } from './types'

const listeners = new Set<() => void>()

let state: CloudState = {
  configured: cloudConfigured,
  auth: cloudConfigured ? 'loading' : 'unavailable',
  user: null,
  workspace: null,
  settings: {
    ...DEFAULT_CLOUD_SETTINGS,
    enabledTools: ALL_TOOLS.map((tool) => tool.name),
  },
  connectors: [],
  sync: 'local-only',
  lastSyncedAt: null,
  error: null,
}

export function getCloudState(): CloudState {
  return state
}

export function updateCloudState(patch: Partial<CloudState>): void {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

export function onCloudStateChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function __resetCloudState(): void {
  listeners.clear()
  state = {
    configured: cloudConfigured,
    auth: cloudConfigured ? 'loading' : 'unavailable',
    user: null,
    workspace: null,
    settings: {
      ...DEFAULT_CLOUD_SETTINGS,
      enabledTools: ALL_TOOLS.map((tool) => tool.name),
    },
    connectors: [],
    sync: 'local-only',
    lastSyncedAt: null,
    error: null,
  }
}
