import { createClient, type SupabaseClient } from '@supabase/supabase-js'

function env(name: 'VITE_SUPABASE_URL' | 'VITE_SUPABASE_PUBLISHABLE_KEY'): string {
  return (import.meta.env[name] ?? '').trim()
}

const url = env('VITE_SUPABASE_URL')
const publishableKey = env('VITE_SUPABASE_PUBLISHABLE_KEY')

function validUrl(value: string): boolean {
  if (!value) return false
  try {
    const parsed = new URL(value)
    return (
      parsed.protocol === 'https:' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === 'localhost'
    )
  } catch {
    return false
  }
}

export const cloudConfigured = validUrl(url) && publishableKey.length >= 20

/**
 * Supabase stores the PKCE verifier and refresh token through this adapter.
 * `sessionStorage` survives reloads but not a closed browser session, reducing
 * the lifetime of a stolen browser profile compared with `localStorage`.
 */
const sessionStorageAdapter = {
  getItem(key: string): string | null {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(key)
  },
  setItem(key: string, value: string): void {
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(key, value)
  },
  removeItem(key: string): void {
    if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(key)
  },
}

export const cloudClient: SupabaseClient | null = cloudConfigured
  ? createClient(url, publishableKey, {
      auth: {
        flowType: 'pkce',
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true,
        storage: sessionStorageAdapter,
      },
      realtime: { params: { eventsPerSecond: 4 } },
      global: { headers: { 'X-Client-Info': 'nightorder-web/1' } },
    })
  : null

export function requireCloudClient(): SupabaseClient {
  if (!cloudClient) {
    throw new Error('Cloud is not configured on this deployment.')
  }
  return cloudClient
}
