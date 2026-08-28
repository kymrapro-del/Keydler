/**
 * `jeton.mjs` est du JavaScript simple : il tourne dans Node pendant la
 * construction, hors du programme TypeScript. Sans ces déclarations, chaque
 * import depuis une épreuve exigeait un `@ts-expect-error` — c'est-à-dire de
 * TAIRE une erreur plutôt que de la résoudre, et de perdre au passage toute
 * vérification de type sur ce que le module rend vraiment.
 */

/** Ce que porte un jeton d'origin trial, une fois sa charge utile lue. */
export type Jeton = {
  /** Renseigné quand le jeton n'a pas pu être lu ; les autres champs sont alors absents. */
  erreur?: string
  version?: number
  /** L'origine exacte, port compris : `https://keydler.com:443`. */
  origine?: string
  fonctionnalite?: string
  /** Faux quand `isSubdomain` est absent : la couverture n'est jamais implicite. */
  sousDomaines?: boolean
  tiers?: boolean
  expire?: Date | null
}

export function lireJeton(base64: string): Jeton

/** Découpe la variable d'environnement : une origine, un jeton. */
export function tokensDe(brut: string | undefined): string[]
