import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cloudConfigured, requireCloudClient } from '../src/cloud/client'
import { getCloudState } from '../src/cloud/state'
import { sendMagicLink } from '../src/cloud/auth'
import { createTask } from '../src/domain/task'
import {
  enabledToolNames,
  resetToolPermissions,
  setEnabledToolNames,
} from '../src/security/toolPermissions'
import * as store from '../src/store/taskStore'
import { ALL_TOOLS } from '../src/webmcp/tools'
import migration from '../supabase/migrations/202608280001_nightorder_cloud.sql?raw'
import vercel from '../vercel.json'
import { clearDatabase } from './helpers'

beforeEach(async () => {
  resetToolPermissions()
  store.__resetStore()
  await clearDatabase()
  await store.init()
})

afterEach(() => resetToolPermissions())

describe('déploiement local-first sans backend', () => {
  it('reste explicitement indisponible au lieu de simuler un compte', async () => {
    expect(cloudConfigured).toBe(false)
    expect(getCloudState().auth).toBe('unavailable')
    expect(() => requireCloudClient()).toThrow('not configured')
    await expect(sendMagicLink('person@example.com')).rejects.toThrow('not configured')
  })
})

describe('permissions WebMCP locales', () => {
  it('active tous les outils par défaut et ignore les noms inventés', () => {
    expect(enabledToolNames()).toEqual(ALL_TOOLS.map((tool) => tool.name))
    setEnabledToolNames(['resume_task', 'not-a-tool', 'resume_task'])
    expect(enabledToolNames()).toEqual(['resume_task'])
  })
})

describe('fusion cloud monotone', () => {
  it('adopte une version distante plus récente sans faire reculer le cahier', async () => {
    const local = createTask({ title: 'Local', next: 'Continue' })
    await store.openPreparedTask(local)
    const remote = {
      ...local,
      title: 'Cloud',
      version: local.version + 2,
      updatedAt: Date.now() + 1,
    }

    await expect(store.mergeCloudTask(remote)).resolves.toBe('updated')
    expect(store.currentTask()?.title).toBe('Cloud')
    await expect(store.mergeCloudTask(local)).resolves.toBe('ignored')
    expect(store.currentTask()?.version).toBe(remote.version)
  })
})

describe('frontière serveur', () => {
  it('active RLS partout et garde les secrets de connecteur hors du rôle authentifié', () => {
    for (const table of [
      'profiles',
      'workspaces',
      'workspace_members',
      'workspace_settings',
      'task_snapshots',
      'connectors',
      'audit_events',
    ]) {
      expect(migration).toContain(`alter table public.${table} enable row level security`)
    }
    expect(migration).toContain('revoke all on public.connectors from anon, authenticated')
    expect(migration).not.toContain('credential_ciphertext, credential_iv, created_at')
    expect(migration).toContain('private.can_edit_workspace(p_workspace_id)')
  })

  it('autorise uniquement Supabase dans connect-src en plus de la même origine', () => {
    const headers = vercel.headers[0].headers
    const csp = headers.find((header) => header.key === 'Content-Security-Policy')?.value ?? ''
    expect(csp).toContain("connect-src 'self' https://*.supabase.co wss://*.supabase.co")
    expect(csp).toContain("script-src 'self'")
    expect(csp).not.toContain("'unsafe-inline'")
  })
})
