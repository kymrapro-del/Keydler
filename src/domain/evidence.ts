import type { EvidenceKind } from './types'

const LABELS: Record<EvidenceKind, string> = {
  command_output: 'Command output',
  diff: 'Diff or patch',
  url: 'Link',
  hash: 'Hash or commit',
  test_report: 'Test report',
}

const HASH_LENGTHS = new Set([7, 8, 32, 40, 64])

export function evidenceKindLabel(kind: EvidenceKind): string {
  return LABELS[kind]
}

function isSingleToken(value: string): boolean {
  return value.length > 0 && !/\s/.test(value)
}

function looksLikeDiff(value: string): boolean {
  const lines = value.split('\n')
  if (lines.some((line) => line.startsWith('diff --git ') || line.startsWith('Index: ')))
    return true
  const minus = lines.some((line) => line.startsWith('--- '))
  const plus = lines.some((line) => line.startsWith('+++ '))
  const hunk = lines.some((line) => /^@@ .* @@/.test(line))
  return (minus && plus) || hunk
}

function looksLikeTestReport(value: string): boolean {
  return (
    /\b\d+\s+(passed|failed|passing|failing|skipped)\b/i.test(value) ||
    /^\s*(PASS|FAIL)\s+\S/m.test(value) ||
    /\bTests?\s+Files?\b/i.test(value) ||
    /\b(Tests?|Suites?):\s*\d+/i.test(value)
  )
}

export function guessEvidenceKind(content: string): EvidenceKind {
  const value = content.trim()
  if (value.length === 0) return 'command_output'

  if (isSingleToken(value)) {
    if (/^https?:\/\/\S+$/i.test(value)) return 'url'
    if (/^[0-9a-f]+$/i.test(value) && HASH_LENGTHS.has(value.length)) return 'hash'
  }

  if (looksLikeDiff(value)) return 'diff'
  if (looksLikeTestReport(value)) return 'test_report'
  return 'command_output'
}
