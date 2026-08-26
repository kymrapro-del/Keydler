import { ValidationError } from './errors'
import { CONFIDENCE_ORDER, EVIDENCE_KINDS, type Confidence, type EvidenceKind } from './types'

/** Longueur au-delà de laquelle un champ libre cesse d'être lisible dans le cahier. */
const MAX_FIELD_LENGTH = 2000
const MAX_EVIDENCE_LENGTH = 8000

/** Exige une chaîne non vide et la normalise (trim + espaces compactés). */
export function requireText(field: string, value: unknown, maxLength = MAX_FIELD_LENGTH): string {
  if (typeof value !== 'string') {
    throw new ValidationError(field, 'expected a string.')
  }
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new ValidationError(field, 'must not be empty.')
  }
  if (trimmed.length > maxLength) {
    throw new ValidationError(field, `must be at most ${maxLength} characters.`)
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

/**
 * Exige un entier de version. Accepte une chaîne numérique : les agents
 * sérialisent volontiers les nombres en texte, et refuser sur ce détail
 * gaspillerait un aller-retour sans rien protéger.
 */
export function requireVersion(field: string, value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value.trim()) : value
  if (typeof parsed !== 'number' || !Number.isInteger(parsed) || parsed < 0) {
    throw new ValidationError(field, 'expected a non-negative integer version number.')
  }
  return parsed
}

export function requireConfidence(field: string, value: unknown): Confidence {
  if (value === undefined || value === null) return 'claimed'
  if (typeof value !== 'string' || !CONFIDENCE_ORDER.includes(value as Confidence)) {
    throw new ValidationError(field, `expected one of: ${CONFIDENCE_ORDER.join(', ')}.`)
  }
  return value as Confidence
}

export function requireEvidenceKind(field: string, value: unknown): EvidenceKind {
  if (typeof value !== 'string' || !EVIDENCE_KINDS.includes(value as EvidenceKind)) {
    throw new ValidationError(field, `expected one of: ${EVIDENCE_KINDS.join(', ')}.`)
  }
  return value as EvidenceKind
}

export function requireEvidenceContent(field: string, value: unknown): string {
  return requireText(field, value, MAX_EVIDENCE_LENGTH)
}
