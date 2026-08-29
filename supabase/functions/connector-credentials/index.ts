import { createClient } from 'npm:@supabase/supabase-js@2'

type Provider = 'openai' | 'anthropic' | 'gemini'
type Action = 'connect' | 'disconnect'
type Body = { action?: Action; workspaceId?: string; provider?: Provider; apiKey?: string }

const providers = new Set<Provider>(['openai', 'anthropic', 'gemini'])
const encoder = new TextEncoder()

function env(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

function allowedOrigin(request: Request): string | null {
  const origin = request.headers.get('Origin')
  if (!origin) return null
  const configured = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin
  return configured.includes(origin) ? origin : null
}

function headers(origin: string | null): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
    ...(origin
      ? {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
        }
      : {}),
  }
}

function response(origin: string | null, status: number, body: object): Response {
  return new Response(JSON.stringify(body), { status, headers: headers(origin) })
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

async function encryptionKey(): Promise<CryptoKey> {
  const raw = decodeBase64(env('CONNECTOR_MASTER_KEY'))
  if (raw.byteLength !== 32) throw new Error('CONNECTOR_MASTER_KEY must decode to 32 bytes')
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt'])
}

async function encrypt(value: string): Promise<{ ciphertext: Uint8Array; iv: Uint8Array }> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      await encryptionKey(),
      encoder.encode(value),
    ),
  )
  return { ciphertext, iv }
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function keyHint(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
  return `sha256:${toHex(digest.slice(0, 4))}`
}

async function verifyProvider(provider: Provider, apiKey: string): Promise<void> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const request =
      provider === 'openai'
        ? new Request('https://api.openai.com/v1/models', {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: controller.signal,
          })
        : provider === 'anthropic'
          ? new Request('https://api.anthropic.com/v1/models?limit=1', {
              headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
              signal: controller.signal,
            })
          : new Request('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', {
              headers: { 'x-goog-api-key': apiKey },
              signal: controller.signal,
            })
    const result = await fetch(request)
    if (!result.ok) throw new Error(`Provider verification failed (${result.status}).`)
  } finally {
    clearTimeout(timeout)
  }
}

Deno.serve(async (request) => {
  const origin = allowedOrigin(request)
  if (request.headers.has('Origin') && !origin)
    return response(null, 403, { error: 'Origin denied.' })
  if (request.method === 'OPTIONS')
    return new Response(null, { status: 204, headers: headers(origin) })
  if (request.method !== 'POST') return response(origin, 405, { error: 'Method not allowed.' })

  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization?.startsWith('Bearer '))
      return response(origin, 401, { error: 'Sign in required.' })

    const url = env('SUPABASE_URL')
    const anon = createClient(url, env('SUPABASE_ANON_KEY'), {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const admin = createClient(url, env('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const userResult = await anon.auth.getUser()
    const user = userResult.data.user
    if (!user) return response(origin, 401, { error: 'Session expired.' })

    const body = (await request.json()) as Body
    if (!body.workspaceId || !body.provider || !providers.has(body.provider)) {
      return response(origin, 400, { error: 'Invalid connector request.' })
    }

    const membership = await anon
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', body.workspaceId)
      .eq('user_id', user.id)
      .in('role', ['owner', 'editor'])
      .maybeSingle()
    if (membership.error || !membership.data)
      return response(origin, 403, { error: 'Workspace access denied.' })

    if (body.action === 'disconnect') {
      const deletion = await admin
        .from('connectors')
        .delete()
        .eq('workspace_id', body.workspaceId)
        .eq('provider', body.provider)
      if (deletion.error) throw deletion.error
      return response(origin, 200, { ok: true })
    }

    if (body.action !== 'connect' || typeof body.apiKey !== 'string') {
      return response(origin, 400, { error: 'A provider key is required.' })
    }
    const apiKey = body.apiKey.trim()
    if (apiKey.length < 16 || apiKey.length > 512) {
      return response(origin, 400, { error: 'Invalid provider key length.' })
    }

    const since = new Date(Date.now() - 10 * 60_000).toISOString()
    const attempts = await admin
      .schema('private')
      .from('connector_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('workspace_id', body.workspaceId)
      .gte('attempted_at', since)
    if ((attempts.count ?? 0) >= 10)
      return response(origin, 429, { error: 'Too many attempts. Try again later.' })
    await admin.schema('private').from('connector_attempts').insert({
      user_id: user.id,
      workspace_id: body.workspaceId,
    })

    await verifyProvider(body.provider, apiKey)
    const sealed = await encrypt(apiKey)
    const upsert = await admin.from('connectors').upsert(
      {
        workspace_id: body.workspaceId,
        provider: body.provider,
        label:
          body.provider === 'openai'
            ? 'OpenAI'
            : body.provider === 'anthropic'
              ? 'Anthropic'
              : 'Gemini',
        status: 'connected',
        credential_ciphertext: sealed.ciphertext,
        credential_iv: sealed.iv,
        credential_hint: await keyHint(apiKey),
        last_checked_at: new Date().toISOString(),
        last_error: null,
        created_by: user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'workspace_id,provider' },
    )
    if (upsert.error) throw upsert.error
    return response(origin, 200, { ok: true })
  } catch (error) {
    const reason =
      error instanceof DOMException && error.name === 'AbortError'
        ? 'Provider verification timed out.'
        : error instanceof Error && error.message.startsWith('Provider verification failed')
          ? error.message
          : 'The connector could not be saved.'
    return response(origin, 400, { error: reason })
  }
})
