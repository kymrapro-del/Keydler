import type { TaskState } from '../domain/types'

export type CloudAuthPhase = 'unavailable' | 'loading' | 'signed-out' | 'signed-in' | 'error'
export type CloudSyncPhase = 'local-only' | 'idle' | 'syncing' | 'synced' | 'error'
export type WorkspaceRole = 'owner' | 'editor' | 'viewer'
export type ConnectorProvider = 'openai' | 'anthropic' | 'gemini'
export type ConnectorStatus = 'disconnected' | 'checking' | 'connected' | 'error'

export type CloudUser = {
  id: string
  email: string
}

export type CloudWorkspace = {
  id: string
  name: string
  role: WorkspaceRole
}

export type CloudSettings = {
  cloudSyncEnabled: boolean
  retentionDays: 7 | 30 | 90 | 365
  strictAgentWrites: boolean
  enabledTools: string[]
}

export type Connector = {
  id: string
  provider: ConnectorProvider
  label: string
  status: ConnectorStatus
  lastCheckedAt: string | null
  error: string | null
}

export type CloudState = {
  configured: boolean
  auth: CloudAuthPhase
  user: CloudUser | null
  workspace: CloudWorkspace | null
  settings: CloudSettings
  connectors: Connector[]
  sync: CloudSyncPhase
  lastSyncedAt: number | null
  error: string | null
}

export type RemoteTask = {
  workspace_id: string
  task_id: string
  state: TaskState
  version: number
  updated_at: string
}

export const DEFAULT_CLOUD_SETTINGS: CloudSettings = {
  cloudSyncEnabled: false,
  retentionDays: 30,
  strictAgentWrites: true,
  enabledTools: [],
}
