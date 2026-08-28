/**
 * `www.js` est un Worker Cloudflare : du JavaScript simple, hors du programme
 * TypeScript. Ces déclarations permettent aux épreuves de l'importer et de
 * vérifier réellement ce qu'il rend, au lieu de taire l'erreur d'import.
 */
declare const worker: {
  fetch(request: Request): Response
}

export default worker
