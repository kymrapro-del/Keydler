/**
 * `token.mjs` is plain JavaScript : it runs in Node during the build, outside
 * the TypeScript program. Without these declarations, every import from a test
 * required a `@ts-expect-error`, that is, silencing an error rather than
 * resolving it, and losing along the way all type checking on what the module
 * actually returns.
 */

/** What an origin trial token carries, once its payload is read. */
export type Token = {
  /** Set when the token could not be read; the other fields are then absent. */
  error?: string
  version?: number
  /** The exact origin, port included: `https://keydler.com:443`. */
  origin?: string
  feature?: string
  /** False when `isSubdomain` is absent: coverage is never implicit. */
  subdomains?: boolean
  thirdParty?: boolean
  expires?: Date | null
}

export function readToken(base64: string): Token

/** Splits the environment variable: one origin, one token. */
export function tokensFrom(raw: string | undefined): string[]
