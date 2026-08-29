/**
 * `carte-sociale.mjs` is plain JavaScript: it runs in Node at build time,
 * outside the TypeScript program. These declarations let a test import it and
 * check what it produces, rather than silence the import error.
 */

/** The SVG the card is rendered from. Pure: it renders nothing. */
export function construireSvg(): string

/** The fingerprint written into the PNG, so staleness can be detected. */
export function empreinteSvg(texte: string): string
