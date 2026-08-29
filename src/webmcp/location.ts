const PREFIX = '/t/'

/**
 * Il n'y a pas de compte : cette page répond à ce que cherche un bouton « Sign in »,
 * c'est-à-dire où sont mes affaires et comment les emmener ailleurs. Elle existe comme ADRESSE parce que qui
 * vient de l'extérieur n'a aucun cahier ouvert, donc ne voyait ni liste, ni export, ni import.
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
