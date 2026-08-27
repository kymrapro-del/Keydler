/**
 * L'adresse d'un cahier.
 *
 * Un cahier vit à `/t/:id`. C'était écrit dans le type depuis le premier jour —
 * « Figure dans l'URL : /t/:id » — et nulle part ailleurs : rien ne construisait
 * cette adresse, rien ne la lisait, et la page rendait toujours le dernier
 * cahier touché sur l'appareil.
 *
 * La conséquence n'était pas cosmétique. Deux onglets sur deux tâches, et un
 * agent recevait l'état de celle que l'autre onglet venait d'écrire, sans
 * qu'aucune ligne de la réponse ne l'indique. Il reprenait le travail d'une
 * autre tâche en croyant reprendre le sien.
 *
 * Ce module est le seul endroit qui connaît la forme de cette adresse.
 */

const PREFIX = '/t/'

/**
 * L'identifiant porté par un chemin, ou `null`.
 *
 * Rien d'autre que le jeu de caractères d'un identifiant n'est accepté : un
 * chemin est une entrée non fiable, et il finit interpolé dans une réponse
 * d'outil comme dans le DOM.
 */
export function taskIdFromPath(pathname: string): string | null {
  if (!pathname.startsWith(PREFIX)) return null
  const brut = pathname.slice(PREFIX.length).split('/')[0]
  return /^[A-Za-z0-9_-]{1,64}$/.test(brut) ? brut : null
}

/** Le chemin d'un cahier. */
export function taskPath(id: string): string {
  return `${PREFIX}${id}`
}

/**
 * L'adresse complète d'un cahier, telle qu'un humain la recopierait.
 *
 * `null` hors navigateur — les tests de domaine tournent sans `location`, et
 * une adresse inventée y vaudrait moins que pas d'adresse du tout.
 */
export function taskUrl(id: string): string | null {
  if (typeof location === 'undefined' || !location.origin) return null
  return `${location.origin}${taskPath(id)}`
}

/** L'identifiant nommé par l'adresse courante, ou `null`. */
export function currentTaskIdFromLocation(): string | null {
  if (typeof location === 'undefined') return null
  return taskIdFromPath(location.pathname)
}
