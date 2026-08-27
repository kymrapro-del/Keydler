const PREFIX = '/t/'

export function taskIdFromPath(pathname: string): string | null {
  if (!pathname.startsWith(PREFIX)) return null
  const brut = pathname.slice(PREFIX.length).split('/')[0]
  return /^[A-Za-z0-9_-]{1,64}$/.test(brut) ? brut : null
}

export function taskPath(id: string): string {
  return `${PREFIX}${id}`
}

export function taskUrl(id: string): string | null {
  if (typeof location === 'undefined' || !location.origin) return null
  return `${location.origin}${taskPath(id)}`
}

export function currentTaskIdFromLocation(): string | null {
  if (typeof location === 'undefined') return null
  return taskIdFromPath(location.pathname)
}
