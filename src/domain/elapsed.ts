const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

function plural(n: number, one: string): string {
  return `${n} ${one}${n === 1 ? '' : 's'} ago`
}

/**
 * `null` quand l'horodatage n'est pas exploitable. On ne devine pas : une date
 * inventée dans un cahier vaut moins que pas de date du tout.
 */
export function sinceThen(at: number, now: number = Date.now()): string | null {
  if (!Number.isFinite(at) || at <= 0) return null

  const elapsed = now - at
  if (elapsed < MINUTE) return 'just now'
  if (elapsed < HOUR) return plural(Math.floor(elapsed / MINUTE), 'minute')
  if (elapsed < DAY) return plural(Math.floor(elapsed / HOUR), 'hour')
  return plural(Math.floor(elapsed / DAY), 'day')
}
