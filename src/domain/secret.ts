import { ValidationError } from './errors'

export const MAX_SECRET_NAME_LENGTH = 64
export const MAX_SECRET_PURPOSE_LENGTH = 200
export const MAX_SECRET_VALUE_LENGTH = 16_384

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

export type SecretKind =
  | 'api_key'
  | 'token'
  | 'password'
  | 'database_url'
  | 'webhook_url'
  | 'private_key'
  | 'certificate'
  | 'other'

export const SECRET_KINDS: readonly SecretKind[] = [
  'api_key',
  'token',
  'password',
  'database_url',
  'webhook_url',
  'private_key',
  'certificate',
  'other',
] as const

export const MULTILINE_KINDS: readonly SecretKind[] = ['private_key', 'certificate', 'other']

const KIND_LABELS: Record<SecretKind, string> = {
  api_key: 'API key',
  token: 'Token',
  password: 'Password',
  database_url: 'Database URL',
  webhook_url: 'Webhook URL',
  private_key: 'Private key',
  certificate: 'Certificate',
  other: 'Other',
}

export function secretKindLabel(kind: SecretKind): string {
  return KIND_LABELS[kind]
}

export function requireSecretKind(value: unknown): SecretKind {
  if (value === undefined || value === null) return 'other'
  if (typeof value !== 'string' || !SECRET_KINDS.includes(value as SecretKind)) {
    throw new ValidationError('kind', `expected one of: ${SECRET_KINDS.join(', ')}.`, {
      code: 'bad-enum',
    })
  }
  return value as SecretKind
}

export type SealedValue = {
  ciphertext: string
  iv: string
  salt: string
  iterations: number
}

export type SecretRef = {
  id: string
  taskId: string
  name: string
  purpose: string
  kind?: SecretKind
  sealed: SealedValue
  at: number
}

export type SecretName = {
  id: string
  name: string
  purpose: string
  kind: SecretKind
}

export function requireSecretName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ValidationError('name', 'expected a string.', { code: 'not-a-string' })
  }
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new ValidationError('name', 'must not be empty.', { code: 'empty' })
  }
  if (!NAME_PATTERN.test(trimmed)) {
    throw new ValidationError(
      'name',
      `must be ${MAX_SECRET_NAME_LENGTH} characters or fewer, start with a letter or digit, and use only letters, digits, and . _ -`,
      { code: 'bad-enum' },
    )
  }
  return trimmed
}

export function requireSecretPurpose(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ValidationError('purpose', 'expected a string.', { code: 'not-a-string' })
  }
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new ValidationError('purpose', 'must not be empty.', { code: 'empty' })
  }
  if (trimmed.length > MAX_SECRET_PURPOSE_LENGTH) {
    throw new ValidationError(
      'purpose',
      `must be at most ${MAX_SECRET_PURPOSE_LENGTH} characters.`,
      { code: 'too-long', max: MAX_SECRET_PURPOSE_LENGTH },
    )
  }
  return trimmed
}

export function requireSecretValue(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ValidationError('value', 'expected a string.', { code: 'not-a-string' })
  }
  if (value.length === 0) {
    throw new ValidationError('value', 'must not be empty.', { code: 'empty' })
  }
  if (value.length > MAX_SECRET_VALUE_LENGTH) {
    throw new ValidationError('value', `must be at most ${MAX_SECRET_VALUE_LENGTH} characters.`, {
      code: 'too-long',
      max: MAX_SECRET_VALUE_LENGTH,
    })
  }
  return value
}

export function requirePassphrase(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ValidationError('passphrase', 'expected a string.', { code: 'not-a-string' })
  }
  if (value.length < 8) {
    throw new ValidationError('passphrase', 'must be at least 8 characters.', {
      code: 'too-short',
    })
  }
  return value
}

export function publicName(ref: SecretRef): SecretName {
  return {
    id: ref.id,
    name: ref.name,
    purpose: ref.purpose,
    kind: SECRET_KINDS.includes(ref.kind as SecretKind) ? (ref.kind as SecretKind) : 'other',
  }
}

export function referenceSyntax(name: string): string {
  return `\${${name}}`
}
