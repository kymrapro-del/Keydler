const PREFIX = '/t/'

/**
 * L'adresse où envoyer quelqu'un qui cherche « son compte ». Il n'y en a pas :
 * cette page répond à la question que pose un bouton « Sign in » — où sont mes
 * affaires, et comment les emmener ailleurs — sans rien promettre de faux.
 *
 * Elle existe comme ADRESSE, et pas seulement comme panneau replié dans un
 * cahier ouvert, parce qu'une page d'accueil doit pouvoir y pointer. C'est
 * toute la raison d'être de cette route : quelqu'un qui arrive de l'extérieur
 * n'a aucun cahier ouvert, donc ne voyait jusqu'ici ni la liste de ses
 * cahiers, ni l'export, ni l'import.
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
