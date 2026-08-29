import type { User } from '@supabase/supabase-js'
import { ALL_TOOLS } from '../webmcp/tools'
import { requireCloudClient } from './client'
import type {
  CloudSettings,
  CloudWorkspace,
  Connector,
  ConnectorProvider,
  RemoteTask,
} from './types'

type WorkspaceRow = { id: string; name: string; owner_id: string }
type MembershipRow = { role: CloudWorkspace['role']; workspaces: WorkspaceRow | WorkspaceRow[] }
type SettingsRow = {
  cloud_sync_enabled: boolean
  retention_days: number
  strict_agent_writes: boolean
  enabled_tools: unknown
}
type ConnectorRow = {
  id: string
  provider: ConnectorProvider
  label: string
  status: Connector['status']
  last_checked_at: string | null
  last_error: string | null
}

function message(error: { message: string } | null): string {
  return error?.message ?? 'The cloud service returned an unknown error.'
}

function cleanRetention(value: number): CloudSettings['retentionDays'] {
  return value === 7 || value === 90 || value === 365 ? value : 30
}

function cleanTools(value: unknown): string[] {
  const known = new Set(ALL_TOOLS.map((tool) => tool.name))
  if (!Array.isArray(value)) return [...known]
  return [
    ...new Set(value.filter((name): name is string => typeof name === 'string' && known.has(name))),
  ]
}

function workspaceFromMembership(row: MembershipRow): CloudWorkspace | null {
  const workspace = Array.isArray(row.workspaces) ? row.workspaces[0] : row.workspaces
  return workspace ? { id: workspace.id, name: workspace.name, role: row.role } : null
}

export async function ensureWorkspace(user: User): Promise<CloudWorkspace> {
  const client = requireCloudClient()
  const existing = await client
    .from('workspace_members')
    .select('role, workspaces!inner(id,name,owner_id)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (existing.error) throw new Error(message(existing.error))
  if (existing.data) {
    const workspace = workspaceFromMembership(existing.data as unknown as MembershipRow)
    if (workspace) return workspace
  }

  const inserted = await client
    .from('workspaces')
    .insert({ owner_id: user.id, name: 'My Keydler' })
    .select('id,name,owner_id')
    .single()
  if (inserted.error) throw new Error(message(inserted.error))

  const row = inserted.data as WorkspaceRow
  return { id: row.id, name: row.name, role: 'owner' }
}

export async function loadSettings(workspaceId: string): Promise<CloudSettings> {
  const client = requireCloudClient()
  const result = await client
    .from('workspace_settings')
    .select('cloud_sync_enabled,retention_days,strict_agent_writes,enabled_tools')
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  if (result.error) throw new Error(message(result.error))
  if (!result.data) {
    const defaults: CloudSettings = {
      cloudSyncEnabled: false,
      retentionDays: 30,
      strictAgentWrites: true,
      enabledTools: ALL_TOOLS.map((tool) => tool.name),
    }
    await saveSettings(workspaceId, defaults)
    return defaults
  }

  const row = result.data as SettingsRow
  return {
    cloudSyncEnabled: row.cloud_sync_enabled,
    retentionDays: cleanRetention(row.retention_days),
    strictAgentWrites: true,
    enabledTools: cleanTools(row.enabled_tools),
  }
}

export async function saveSettings(workspaceId: string, settings: CloudSettings): Promise<void> {
  const client = requireCloudClient()
  const result = await client.from('workspace_settings').upsert(
    {
      workspace_id: workspaceId,
      cloud_sync_enabled: settings.cloudSyncEnabled,
      retention_days: settings.retentionDays,
      strict_agent_writes: true,
      enabled_tools: cleanTools(settings.enabledTools),
    },
    { onConflict: 'workspace_id' },
  )
  if (result.error) throw new Error(message(result.error))
}

export async function listRemoteTasks(workspaceId: string): Promise<RemoteTask[]> {
  const client = requireCloudClient()
  const result = await client
    .from('task_snapshots')
    .select('workspace_id,task_id,state,version,updated_at')
    .eq('workspace_id', workspaceId)
  if (result.error) throw new Error(message(result.error))
  return (result.data ?? []) as RemoteTask[]
}

export async function pushRemoteTask(
  workspaceId: string,
  task: RemoteTask['state'],
): Promise<void> {
  const client = requireCloudClient()
  const result = await client.rpc('sync_task_snapshot', {
    p_workspace_id: workspaceId,
    p_task_id: task.id,
    p_state: task,
    p_version: task.version,
  })
  if (result.error) throw new Error(message(result.error))
}

export async function loadConnectors(workspaceId: string): Promise<Connector[]> {
  const client = requireCloudClient()
  const result = await client
    .from('connectors')
    .select('id,provider,label,status,last_checked_at,last_error')
    .eq('workspace_id', workspaceId)
    .order('provider')
  if (result.error) throw new Error(message(result.error))
  return ((result.data ?? []) as ConnectorRow[]).map((row) => ({
    id: row.id,
    provider: row.provider,
    label: row.label,
    status: row.status,
    lastCheckedAt: row.last_checked_at,
    error: row.last_error,
  }))
}

export async function connectProvider(
  workspaceId: string,
  provider: ConnectorProvider,
  apiKey: string,
): Promise<void> {
  if (apiKey.trim().length < 16 || apiKey.length > 512) {
    throw new Error('The provider key must contain between 16 and 512 characters.')
  }
  const client = requireCloudClient()
  const result = await client.functions.invoke('connector-credentials', {
    body: { action: 'connect', workspaceId, provider, apiKey: apiKey.trim() },
  })
  if (result.error) throw new Error(result.error.message)
  const payload = result.data as { ok?: boolean; error?: string } | null
  if (!payload?.ok) throw new Error(payload?.error ?? 'The provider could not be verified.')
}

export async function disconnectProvider(
  workspaceId: string,
  provider: ConnectorProvider,
): Promise<void> {
  const client = requireCloudClient()
  const result = await client.functions.invoke('connector-credentials', {
    body: { action: 'disconnect', workspaceId, provider },
  })
  if (result.error) throw new Error(result.error.message)
  const payload = result.data as { ok?: boolean; error?: string } | null
  if (!payload?.ok) throw new Error(payload?.error ?? 'The provider could not be disconnected.')
}
