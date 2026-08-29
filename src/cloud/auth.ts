import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { setEnabledToolNames } from '../security/toolPermissions'
import { cloudClient, cloudConfigured, requireCloudClient } from './client'
import { ensureWorkspace, loadConnectors, loadSettings } from './repository'
import { getCloudState, updateCloudState } from './state'
import { startCloudSync, stopCloudSync } from './sync'

let initialized: Promise<void> | null = null
let authSubscription: { unsubscribe: () => void } | null = null

function cleanAuthCallbackUrl(): void {
  if (typeof location === 'undefined' || !location.search.includes('code=')) return
  const url = new URL(location.href)
  url.searchParams.delete('code')
  history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`)
}

function emailOf(session: Session): string {
  return session.user.email ?? 'Signed-in user'
}

async function applySession(session: Session | null): Promise<void> {
  if (!session) {
    stopCloudSync()
    updateCloudState({
      auth: cloudConfigured ? 'signed-out' : 'unavailable',
      user: null,
      workspace: null,
      connectors: [],
      sync: 'local-only',
      error: null,
    })
    return
  }

  updateCloudState({ auth: 'loading', error: null })
  try {
    const workspace = await ensureWorkspace(session.user)
    const [settings, connectors] = await Promise.all([
      loadSettings(workspace.id),
      loadConnectors(workspace.id),
    ])
    setEnabledToolNames(settings.enabledTools)
    updateCloudState({
      auth: 'signed-in',
      user: { id: session.user.id, email: emailOf(session) },
      workspace,
      settings,
      connectors,
      sync: settings.cloudSyncEnabled ? 'idle' : 'local-only',
      error: null,
    })
    cleanAuthCallbackUrl()
    startCloudSync(workspace.id)
  } catch (error) {
    stopCloudSync()
    updateCloudState({
      auth: 'error',
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

function onAuthChange(_event: AuthChangeEvent, session: Session | null): void {
  // Supabase documents that doing further client work synchronously inside the
  // callback can deadlock its internal auth lock. Defer the bootstrap.
  setTimeout(() => void applySession(session), 0)
}

export function initializeCloud(): Promise<void> {
  if (initialized) return initialized
  initialized = (async () => {
    if (!cloudClient) {
      updateCloudState({ auth: 'unavailable', configured: false })
      return
    }
    updateCloudState({ auth: 'loading', configured: true })
    const result = await cloudClient.auth.getSession()
    if (result.error) {
      updateCloudState({ auth: 'error', error: result.error.message })
      return
    }
    await applySession(result.data.session)
    authSubscription = cloudClient.auth.onAuthStateChange(onAuthChange).data.subscription
  })()
  return initialized
}

export async function sendMagicLink(email: string): Promise<void> {
  const normalized = email.trim().toLocaleLowerCase()
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error('Enter a valid email address.')
  }
  const client = requireCloudClient()
  const redirect = typeof location === 'undefined' ? undefined : `${location.origin}/`
  const result = await client.auth.signInWithOtp({
    email: normalized,
    options: { shouldCreateUser: true, emailRedirectTo: redirect },
  })
  if (result.error) throw new Error(result.error.message)
}

export async function signOut(everywhere = false): Promise<void> {
  const result = await requireCloudClient().auth.signOut({ scope: everywhere ? 'global' : 'local' })
  if (result.error) throw new Error(result.error.message)
  await applySession(null)
}

export function cloudEmail(): string | null {
  return getCloudState().user?.email ?? null
}

export function __resetCloudAuth(): void {
  authSubscription?.unsubscribe()
  authSubscription = null
  initialized = null
  stopCloudSync()
}
