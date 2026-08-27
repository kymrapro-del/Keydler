import { ValidationError } from './errors'
import { EVIDENCE_KINDS, type EvidenceKind } from './types'

export const MAX_FIELD_LENGTH = 2000
export const MAX_EVIDENCE_LENGTH = 8000

export function requireText(field: string, value: unknown, maxLength = MAX_FIELD_LENGTH): string {
  if (typeof value !== 'string') {
    throw new ValidationError(field, 'expected a string.', { code: 'not-a-string' })
  }
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new ValidationError(field, 'must not be empty.', { code: 'empty' })
  }
  if (trimmed.length > maxLength) {
    throw new ValidationError(field, `must be at most ${maxLength} characters.`, {
      code: 'too-long',
      max: maxLength,
    })
  }
  return trimmed
}

export function optionalText(
  field: string,
  value: unknown,
  maxLength = MAX_FIELD_LENGTH,
): string | null {
  if (value === undefined || value === null || value === '') return null
  return requireText(field, value, maxLength)
}

export function requireVersion(field: string, value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value.trim()) : value
  if (typeof parsed !== 'number' || !Number.isInteger(parsed) || parsed < 0) {
    throw new ValidationError(field, 'expected a non-negative integer version number.', {
      code: 'bad-version',
    })
  }
  return parsed
}

export function requireEvidenceKind(field: string, value: unknown): EvidenceKind {
  if (typeof value !== 'string' || !EVIDENCE_KINDS.includes(value as EvidenceKind)) {
    throw new ValidationError(field, `expected one of: ${EVIDENCE_KINDS.join(', ')}.`, {
      code: 'bad-enum',
    })
  }
  return value as EvidenceKind
}

export function requireEvidenceContent(field: string, value: unknown): string {
  return requireText(field, value, MAX_EVIDENCE_LENGTH)
}
