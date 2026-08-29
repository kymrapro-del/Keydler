/**
 * `www.js` is a Cloudflare Worker: plain JavaScript, outside the TypeScript
 * program. These declarations let a test import it and check what it returns,
 * rather than silence the import error.
 */
declare const worker: {
  fetch(request: Request): Response
}

export default worker
