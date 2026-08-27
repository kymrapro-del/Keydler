import { vi } from 'vitest'
import { getDb } from '../src/persistence/db'
import * as store from '../src/store/taskStore'
import type { ModelContextTool, RegisteredTool, ToolResult } from '../src/webmcp/adapter'
import type { TaskState } from '../src/domain/types'
import { fingerprintIntent } from '../src/domain/intent'

/**
 * Outillage partagé des tests.
 *
 * Deux choses y vivent, pour la même raison : elles étaient recopiées dans
 * quatre fichiers, et une copie qui dérive rend un test vert sans rien prouver.
 */

/**
 * IndexedDB survit d'un test à l'autre — c'est justement le comportement
 * recherché en production. On repart donc d'une base vide à chaque cas.
 */
export async function clearDatabase(): Promise<void> {
  const db = await getDb()
  const tx = db.transaction(['tasks', 'meta'], 'readwrite')
  await Promise.all([tx.objectStore('tasks').clear(), tx.objectStore('meta').clear(), tx.done])
}

/**
 * Appelle un outil comme le navigateur l'appelle.
 *
 * La spécification déclare `signal` REQUIS dans
 * `ToolExecuteCallbackOptions` : une exécution en reçoit toujours un. Un test
 * qui passait `{}` éprouvait donc un chemin que la plateforme ne produit
 * jamais, et laissait le vrai — celui où le signal existe — sans couverture.
 */
export function call(
  tool: ModelContextTool,
  input: Record<string, unknown> = {},
  signal: AbortSignal = new AbortController().signal,
): Promise<ToolResult> {
  return tool.execute(input, { signal })
}

/**
 * Les options qu'une exécution reçoit du navigateur.
 *
 * Un contrôleur neuf par appel, comme la plateforme en crée un par exécution.
 */
export function exec(signal?: AbortSignal): { signal: AbortSignal } {
  return { signal: signal ?? new AbortController().signal }
}

/** Le texte rendu par un outil, sans l'enveloppe. */
export function textOf(result: ToolResult): string {
  return result.content.map((c) => c.text).join('\n')
}

let compteur = 0

/** Un `mutation_id` valable et distinct à chaque appel. */
export function mutationId(prefix = 'm'): string {
  compteur += 1
  return `${prefix}-test-${compteur.toString().padStart(6, '0')}`
}

/**
 * Une écriture passée directement au magasin, avec tout ce que le contrat
 * exige. L'empreinte est calculée comme la couche outil la calcule, pour que
 * ces cas n'éprouvent pas un chemin que la production ne prend jamais.
 */
export function storeWrite(
  operation: string,
  basedOnVersion: number,
  intent: Record<string, unknown>,
  mutate: (state: TaskState) => TaskState,
  id = mutationId(),
) {
  return {
    operation,
    basedOnVersion,
    mutationId: id,
    fingerprint: fingerprintIntent(operation, intent),
    mutate,
    render: (next: TaskState) => `v${next.version}`,
  }
}

/** Une écriture d'agent, avec tout ce que le contrat exige. */
export function writeArgs(
  task: TaskState,
  extra: Record<string, unknown> = {},
  id = mutationId(),
): Record<string, unknown> {
  return { based_on_version: task.version, mutation_id: id, ...extra }
}

/** L'état courant du magasin, en exigeant qu'il y en ait un. */
export function currentTask(): TaskState {
  const task = store.currentTask()
  if (!task) throw new Error('aucun cahier ouvert')
  return task
}

/**
 * Une implémentation de `document.modelContext` conforme à la spécification.
 *
 * Elle reproduit ce que le navigateur fait vraiment, et pas ce qu'il serait
 * commode de supposer :
 *
 * - `registerTool` REJETTE avec `InvalidStateError` si le nom est déjà pris.
 *   Il ne remplace pas. C'est la raison pour laquelle un renouvellement doit
 *   désenregistrer avant d'enregistrer, et un faux permissif laisserait passer
 *   l'inversion.
 * - Un `signal` déjà avorté fait rejeter l'enregistrement d'emblée.
 * - `abort()` retire l'outil de la table, de façon synchrone.
 * - `getTools()` rend les outils TRIÉS PAR NOM, comme la spécification
 *   l'impose — l'ordre d'enregistrement n'est pas celui que l'agent voit.
 * - `toolchange` est émis à chaque enregistrement et à chaque retrait.
 */
export class FakeModelContext extends EventTarget {
  readonly tools = new Map<string, ModelContextTool>()
  /** Chaque appel reçu, pour compter les tentatives. */
  readonly attempts: string[] = []
  /** Noms dont l'enregistrement doit échouer, pour éprouver l'échec partiel. */
  failOn = new Set<string>()

  /**
   * Retient les enregistrements en vol, pour ouvrir à volonté la fenêtre
   * pendant laquelle deux synchronisations peuvent se chevaucher.
   */
  private enAttente: (() => void)[] = []
  lent = false

  /** Laisse repartir tous les enregistrements retenus. */
  reprendre(): void {
    const attendus = this.enAttente
    this.enAttente = []
    for (const libérer of attendus) libérer()
  }

  registerTool = vi.fn(
    async (tool: ModelContextTool, options?: { signal?: AbortSignal }): Promise<void> => {
      this.attempts.push(tool.name)

      if (this.lent) {
        await new Promise<void>((resolve) => this.enAttente.push(resolve))
      }

      if (options?.signal?.aborted) {
        throw options.signal.reason instanceof Error
          ? options.signal.reason
          : new DOMException('aborted', 'AbortError')
      }
      if (this.tools.has(tool.name)) {
        throw new DOMException(`tool "${tool.name}" is already registered`, 'InvalidStateError')
      }
      if (this.failOn.has(tool.name)) {
        throw new DOMException(`refused: ${tool.name}`, 'NotAllowedError')
      }

      this.tools.set(tool.name, tool)
      options?.signal?.addEventListener('abort', () => {
        this.tools.delete(tool.name)
        this.dispatchEvent(new Event('toolchange'))
      })
      this.dispatchEvent(new Event('toolchange'))
    },
  )

  getTools = vi.fn(async (): Promise<RegisteredTool[]> =>
    [...this.tools.values()]
      .map((t) => ({
        name: t.name,
        title: t.title,
        description: t.description,
        inputSchema: t.inputSchema,
        annotations: t.annotations,
      }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
  )

  names(): string[] {
    return [...this.tools.keys()].sort()
  }
}

/** Installe un faux `document.modelContext` et rend de quoi l'interroger. */
export function installModelContext(): FakeModelContext {
  const fake = new FakeModelContext()
  Object.defineProperty(document, 'modelContext', { configurable: true, value: fake })
  return fake
}

export function removeModelContext(): void {
  Reflect.deleteProperty(document, 'modelContext')
}

/**
 * Laisse la file d'écriture et IndexedDB aboutir.
 *
 * Une écriture traverse la file du magasin puis une transaction : un seul tour
 * de boucle ne suffit pas, et attendre trop peu faisait échouer des cas pour
 * une raison sans rapport avec ce qu'ils éprouvaient.
 */
export async function settle(tours = 4): Promise<void> {
  for (let i = 0; i < tours; i++) await new Promise((r) => setTimeout(r, 0))
}

/**
 * Fait passer le navigateur pour une version de Chromium donnée.
 *
 * `userAgentData.brands` est la voie structurée : Chrome y publie sa version
 * majeure réelle sous la marque « Chromium », à côté de marques de brouillage
 * dont la version ne veut rien dire. C'est ce que le code doit lire.
 */
export function pretendChromium(major: number | null, brand = 'Chromium'): void {
  if (major === null) {
    Reflect.deleteProperty(navigator, 'userAgentData')
    return
  }
  Object.defineProperty(navigator, 'userAgentData', {
    configurable: true,
    value: {
      brands: [
        { brand: 'Not(A:Brand', version: '8' },
        { brand: brand, version: String(major) },
      ],
    },
  })
}

export function resetUserAgentData(): void {
  Reflect.deleteProperty(navigator, 'userAgentData')
}
