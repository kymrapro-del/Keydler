/**
 * Empreinte d'une intention d'écriture.
 *
 * Le `mutation_id` seul ne distingue pas un rejeu d'une collision. C'est
 * l'agent qui produit ces jetons, et rien ne garantit qu'ils soient uniques :
 * un compteur remis à zéro entre deux conversations, un identifiant dérivé du
 * numéro d'étape, un modèle qui recopie l'exemple de la description — et deux
 * travaux DIFFÉRENTS arrivent sous le même jeton.
 *
 * Sans empreinte, le second était accueilli par la réponse du premier : jamais
 * écrit, et pourtant accusé réception. Un agent qui croit son travail consigné
 * ne le reconsigne pas. C'est précisément la perte silencieuse que ce produit
 * existe pour empêcher, réintroduite par le mécanisme censé la prévenir.
 */

/**
 * Représentation canonique d'une intention.
 *
 * Deux appels portant la même intention doivent produire exactement la même
 * chaîne, quelle que soit la façon dont l'agent a sérialisé son objet. D'où
 * trois règles, chacune contre un faux négatif observable :
 *
 * - les clés sont TRIÉES : `{action, result}` et `{result, action}` sont le
 *   même appel, et un agent alterne sans y penser d'un tour à l'autre ;
 * - les chaînes sont trimées, comme le domaine les trime à la validation : ce
 *   qu'il efface ne peut pas distinguer deux intentions ;
 * - l'absence, `null` et la chaîne vide sont confondus, pour la même raison —
 *   `optionalText` les traite déjà tous les trois comme « non fourni ».
 *
 * Ce qui n'entre PAS dans l'intention : `mutation_id` et `based_on_version`.
 * Le premier est le nom de l'appel, pas son contenu. Le second est de la
 * métadonnée de protocole — un réessai après un rafraîchissement de version
 * reste le même travail, et l'inclure ferait échouer le rejeu qu'il doit
 * servir.
 */
export function canonicalIntent(operation: string, args: Record<string, unknown>): string {
  return `${operation} ${encode(args)}`
}

function encode(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value.trim())
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value)
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) return `[${value.map(encode).join(',')}]`

  if (typeof value === 'object') {
    const entrées = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([clé, v]) => `${JSON.stringify(clé)}:${encode(v)}`)
    return `{${entrées.join(',')}}`
  }

  // Une fonction, un symbole : rien qu'un appel d'outil puisse porter. On
  // encode sans prétendre en tirer du sens, plutôt que de lever.
  return JSON.stringify(String(value))
}

/**
 * Empreinte courte et stable d'une intention.
 *
 * Deux hachages cyrb53 de graines distinctes, plus la longueur : environ 106
 * bits de signal, pour au plus cent enregistrements par cahier. La collision
 * accidentelle est hors de portée.
 *
 * Ce n'est PAS une empreinte cryptographique, et elle n'a pas à l'être : elle
 * distingue deux intentions d'un même agent coopératif. Un agent qui voudrait
 * forger une collision n'aurait rien à y gagner — il lui suffirait d'envoyer
 * les mêmes arguments, ce qui EST le même appel.
 *
 * On garde une empreinte plutôt que la chaîne entière : une preuve fait jusqu'à
 * 8000 caractères, et cent d'entre elles pèseraient sur chaque écriture, l'état
 * étant resérialisé en entier à chaque fois.
 */
export function fingerprintIntent(operation: string, args: Record<string, unknown>): string {
  const canonique = canonicalIntent(operation, args)
  const a = cyrb53(canonique, 0)
  const b = cyrb53(canonique, 0x9e3779b9)
  return `${canonique.length.toString(36)}.${a.toString(36)}.${b.toString(36)}`
}

/** cyrb53 — hachage non cryptographique 53 bits, bien distribué et sans dépendance. */
function cyrb53(texte: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < texte.length; i++) {
    const ch = texte.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}
