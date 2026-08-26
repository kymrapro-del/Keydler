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
 * Emballe un refus. Le message est destiné à être lu par l'agent : il doit
 * porter l'instruction à suivre, pas seulement le constat d'échec.
 */
export function failure(value: string): ToolResult {
  return { content: [{ type: 'text', text: value }], isError: true }
}

/*
 * Le jeton d'origin trial n'est PAS posé ici.
 *
 * Une version antérieure l'injectait par script au démarrage. C'était inerte
 * dans tous les cas : `import.meta.env` est figé à la construction, donc quand
 * le jeton existe la balise du build est déjà dans le `<head>` et l'injection
 * s'arrêtait aussitôt ; quand il n'existe pas, il n'y avait rien à poser.
 *
 * Pire, `document.modelContext` est un accesseur dont l'existence se décide à
 * l'analyse du document : un jeton arrivé après coup n'aurait rien débloqué.
 * Il est donc écrit dans le HTML à la construction — voir `vite.config.ts`.
 */
