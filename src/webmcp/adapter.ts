/**
 * Adaptateur WebMCP.
 *
 * La spécification a déplacé le getter de `Navigator` vers `Document` dans le
 * brouillon du 27 mai 2026, au motif que les outils appartiennent à une page et
 * non au navigateur ; `navigator.modelContext` est déprécié depuis Chrome 150.
 * On cible `document.modelContext` et on retombe sur l'ancienne forme pour les
 * navigateurs restés en arrière.
 *
 * Toute la connaissance de cette instabilité est enfermée ici. Le reste du code
 * ne voit qu'une interface stable — c'est ce qui rendra la mise à jour indolore
 * quand la spécification bougera encore.
 */

/** Réponse d'outil au format MCP. */
export type ToolResult = {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

export type ModelContextTool = {
  name: string
  title?: string
  description: string
  inputSchema?: object
  annotations?: {
    readOnlyHint?: boolean
    destructiveHint?: boolean
    idempotentHint?: boolean
    openWorldHint?: boolean
    untrustedContentHint?: boolean
  }
  execute: (
    input: Record<string, unknown>,
    options: { signal?: AbortSignal },
  ) => Promise<ToolResult>
}

type ModelContextLike = {
  registerTool: (tool: ModelContextTool, options?: { signal?: AbortSignal }) => Promise<void>
}

declare global {
  interface Document {
    modelContext?: ModelContextLike
  }
  interface Navigator {
    modelContext?: ModelContextLike
  }
}

/** L'implémentation disponible, ou `null` si le navigateur n'en a aucune. */
export function getModelContext(): ModelContextLike | null {
  if (typeof document === 'undefined') return null
  const candidate = document.modelContext ?? globalThis.navigator?.modelContext
  return candidate && typeof candidate.registerTool === 'function' ? candidate : null
}

export type Availability =
  | { supported: true; surface: 'document' | 'navigator' }
  | { supported: false; reason: 'no-api' | 'insecure-context' }

/**
 * Diagnostic destiné à l'écran. On distingue le contexte non sécurisé du simple
 * défaut d'API : ce sont deux problèmes différents, donc deux consignes
 * différentes pour la personne qui teste.
 */
export function checkAvailability(): Availability {
  if (typeof document === 'undefined') return { supported: false, reason: 'no-api' }
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    return { supported: false, reason: 'insecure-context' }
  }
  if (document.modelContext?.registerTool) return { supported: true, surface: 'document' }
  if (globalThis.navigator?.modelContext?.registerTool) {
    return { supported: true, surface: 'navigator' }
  }
  return { supported: false, reason: 'no-api' }
}

/** Emballe une chaîne dans l'enveloppe MCP attendue. */
export function text(value: string): ToolResult {
  return { content: [{ type: 'text', text: value }] }
}

/**
 * Pose le jeton d'origin trial par script. Chrome accepte un `<meta>` ajouté
 * dynamiquement, ce qui évite de committer dans `index.html` un jeton lié à une
 * seule origine — chaque déploiement a la sienne.
 */
export function installOriginTrialToken(token: string | undefined): void {
  if (!token || typeof document === 'undefined') return
  if (document.querySelector('meta[http-equiv="origin-trial"]')) return
  const meta = document.createElement('meta')
  meta.httpEquiv = 'origin-trial'
  meta.content = token
  document.head.prepend(meta)
}
