import { ValidationError } from './errors'

export const MAX_SECRET_NAME_LENGTH = 64
export const MAX_SECRET_PURPOSE_LENGTH = 200
export const MAX_SECRET_VALUE_LENGTH = 4096

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

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
  sealed: SealedValue
  at: number
}

export type SecretName = {
  id: string
  name: string
  purpose: string
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
    throw new ValidationError('passphrase', 'must be at least 8 characters.', { code: 'too-long' })
  }
  return value
}

export function publicName(ref: SecretRef): SecretName {
  return { id: ref.id, name: ref.name, purpose: ref.purpose }
}

export function referenceSyntax(name: string): string {
  return `\${${name}}`
}
