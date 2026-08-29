const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

function plural(n: number, one: string): string {
  return `${n} ${one}${n === 1 ? '' : 's'} ago`
}

/**
 * `null` when the timestamp is not usable. We do not guess: an invented date
 * in a task is worth less than no date at all.
 */
export function sinceThen(at: number, now: number = Date.now()): string | null {
  if (!Number.isFinite(at) || at <= 0) return null

  const elapsed = now - at
  if (elapsed < MINUTE) return 'just now'
  if (elapsed < HOUR) return plural(Math.floor(elapsed / MINUTE), 'minute')
  if (elapsed < DAY) return plural(Math.floor(elapsed / HOUR), 'hour')
  return plural(Math.floor(elapsed / DAY), 'day')
}
