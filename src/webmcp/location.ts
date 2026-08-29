const PREFIX = '/t/'

/**
 * There is no account: this page answers what a “Sign in” button is looked to for,
 * that is, where my things are and how to take them elsewhere. It exists as an ADDRESS
 * because someone arriving from outside has no log open, so saw no list, no export, no import.
 */
export const WORKSPACE_PATH = '/workspace'

export function isWorkspacePath(pathname: string): boolean {
  return pathname === WORKSPACE_PATH || pathname === `${WORKSPACE_PATH}/`
}

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
