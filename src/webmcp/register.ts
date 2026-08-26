import {
  checkAvailability,
  getModelContext,
  type Availability,
  type ModelContextLike,
  type ModelContextTool,
} from './adapter'
import { READ_TOOLS, WRITE_TOOLS } from './tools'
import { detectLifecycle, type ToolLifecycle } from './lifecycle'

export { detectLifecycle, DYNAMIC_UNREGISTER_MIN_CHROMIUM } from './lifecycle'
export type { LifecycleMode, ToolLifecycle } from './lifecycle'
import * as store from '../store/taskStore'

/**
 * Cycle de vie des outils.
 *
 * Ce module s'exécute UNE FOIS, à l'import, hors de tout cycle de rendu.
 *
 * La règle vaudra encore quand React arrivera au J4 : son mode strict monte les
 * composants deux fois en développement, et un `registerTool` appelé depuis un
 * `useEffect` produirait des outils dédoublés puis détruits — une journée de
 * débogage inexplicable. L'enregistrement vit ici, l'interface se contentera de
 * s'abonner à l'état exposé plus bas.
 *
 * Le garde-fou est posé sur `globalThis` et non sur une variable de module : le
 * remplacement de module à chaud réévalue le module, pas le contexte global.
 *
 * ── Ce qui a changé, et pourquoi ────────────────────────────────────────────
 *
 * Les six outils étaient enregistrés en bloc, une fois, définitivement. Un
 * agent voyait donc `log_step`, `complete_task` et les autres même quand aucun
 * cahier n'était ouvert — où chacun ne pouvait rendre que « NO ACTIVE TASK » —
 * et même sur une tâche close, où chacun ne pouvait rendre qu'un refus. Un
 * outil qui ne peut qu'échouer n'est pas un outil : c'est du bruit dans la
 * liste que l'agent doit lire pour choisir, et une invitation à un appel perdu.
 *
 * Les outils suivent maintenant l'état du cahier. Chacun est enregistré avec
 * son propre `AbortController` — la voie que la spécification donne pour
 * désenregistrer — et le jeu exposé est recalculé à chaque changement du
 * magasin. Le navigateur émet `toolchange` à chaque mouvement.
 *
 * ── Le RETRAIT, lui, dépend du navigateur ───────────────────────────────────
 *
 * Avorter le contrôleur d'un outil qui est en train de répondre peut emporter
 * sa réponse avant Chromium 153, et `complete_task` provoque exactement cela :
 * son écriture clôt la tâche, la clôture rend les écritures inutiles, le
 * retrait vise l'outil qui répond. La cible du concours commence à la 149.
 *
 * On ne retire donc QUE si la capacité est positivement connue — voir
 * `lifecycle.ts`, qui explique aussi pourquoi la retenue d'un tour de boucle
 * qui vivait ici était sans valeur. Partout ailleurs, les outils restent posés
 * et refusent proprement.
 *
 * L'AJOUT, lui, n'est jamais retenu : poser un outil n'avorte rien. Une page
 * ouverte avant la tâche retrouve donc ses écritures dès qu'un cahier existe,
 * dans les deux modes.
 */

export type RegistrationPhase =
  | 'pending'
  | 'registered'
  /** Une partie des outils voulus a échoué. Les autres SONT enregistrés. */
  | 'partial'
  | 'unsupported'
  | 'failed'

export type RegistrationState = {
  phase: RegistrationPhase
  availability: Availability
  /** Les outils réellement enregistrés à cet instant. Jamais une intention. */
  toolNames: string[]
  /** Les outils voulus qui n'ont pas pu l'être, avec leur motif. */
  failures: { name: string; reason: string }[]
  /**
   * La politique de retrait retenue, et sur quoi elle se fonde. Exposée parce
   * qu'elle change ce que l'agent voit, et qu'elle repose sur un reniflage de
   * version qu'il vaut mieux afficher que sous-entendre.
   */
  lifecycle: ToolLifecycle
  error: string | null
  /**
   * Les outils enregistrés tels que `getTools()` les a rendus au dernier
   * `toolchange`.
   *
   * L'intérêt est réel mais limité, et il faut dire lequel : c'est une SECONDE
   * SOURCE, la table du navigateur, distincte de la carte que ce module tient.
   * Une divergence entre les deux est le genre de panne qu'un compteur interne
   * ne peut pas voir.
   *
   * Ce n'est PAS une preuve de découverte par l'agent. La spécification fait de
   * `getTools()` l'API des agents qui vivent DANS la page ; l'agent intégré du
   * navigateur reçoit les outils par un mécanisme interne, que rien ici
   * n'observe. Présenter cette liste comme « ce que voit l'agent » ferait
   * passer une relecture locale pour une observation côté client MCP — une
   * affirmation qu'aucun test de ce dépôt ne soutient.
   */
  observedTools: string[] | null
}

const GUARD = Symbol.for('cahier-de-quart.webmcp.registered')
type GuardedGlobal = typeof globalThis & { [GUARD]?: boolean }

let state: RegistrationState = {
  phase: 'pending',
  availability: { supported: false, reason: 'no-api' },
  toolNames: [],
  failures: [],
  lifecycle: { mode: 'static', chromiumMajor: null, reason: 'not detected yet' },
  error: null,
  observedTools: null,
}

const listeners = new Set<() => void>()

function setState(next: RegistrationState): void {
  state = next
  for (const listener of listeners) listener()
}

export function getRegistrationState(): RegistrationState {
  return state
}

export function onRegistrationChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Les outils que l'état courant justifie.
 *
 * Les lectures sont toujours là : elles répondent quel que soit l'état, et
 * `resume_task` est justement l'outil qui explique un état vide ou cassé. Les
 * écritures n'apparaissent que sur une tâche active — le seul cas où elles
 * peuvent aboutir.
 */
export function toolsForCurrentState(): ModelContextTool[] {
  const { status, task } = store.getSnapshot()
  const écrivable = status === 'ready' && task !== null && task.status === 'active'
  return écrivable ? [...READ_TOOLS, ...WRITE_TOOLS] : [...READ_TOOLS]
}

/** Les contrôleurs des outils actuellement enregistrés, par nom. */
const registered = new Map<string, AbortController>()

function raison(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  return String(error)
}

/**
 * Aligne les outils enregistrés sur ceux que l'état justifie.
 *
 * Retirer d'abord, ajouter ensuite. L'ordre compte : `registerTool` REJETTE
 * avec `InvalidStateError` si le nom est déjà pris — la spécification le dit
 * en toutes lettres — et non pas remplace. Ajouter avant de retirer ferait
 * donc échouer tout renouvellement d'un outil sous le même nom.
 */
async function sync(modelContext: ModelContextLike): Promise<void> {
  const voulus = toolsForCurrentState()
  const noms = new Set(voulus.map((t) => t.name))
  const lifecycle = getRegistrationState().lifecycle

  // Le retrait N'A LIEU QUE si la capacité est positivement connue. Ailleurs,
  // un outil devenu inutile reste posé : il refuse proprement, et sa réponse
  // ne peut pas être emportée par un contrôleur qu'on n'avorte jamais.
  if (lifecycle.mode === 'dynamic') {
    for (const [nom, controller] of [...registered]) {
      if (noms.has(nom)) continue
      // La voie donnée par la spécification pour désenregistrer. Les étapes
      // d'abandon retirent l'outil de la table du navigateur avant que
      // `abort()` ne rende la main : le nom est donc libre tout de suite.
      controller.abort()
      registered.delete(nom)
    }
  }

  // Ce qui manque est reposé à CHAQUE tour, y compris ce qui avait échoué au
  // précédent. Un refus peut être passager — une permission qui arrive, un
  // document qui redevient actif — et rien ne justifie de condamner un outil
  // pour un échec unique.
  const àPoser = voulus.filter((t) => !registered.has(t.name))

  // Chacun son contrôleur, chacun son sort. Une boucle `await` séquentielle
  // s'arrêtait au premier échec et laissait les suivants non enregistrés, sans
  // que rien ne dise lesquels.
  const issues = await Promise.allSettled(
    àPoser.map(async (tool) => {
      const controller = new AbortController()
      try {
        await modelContext.registerTool(tool, { signal: controller.signal })
        return { tool, controller }
      } catch (error) {
        // Le contrôleur meurt avec sa tentative : le garder ouvert laisserait
        // un abandon plus tard désenregistrer un outil homonyme qu'une
        // synchronisation ultérieure aurait posé avec succès.
        controller.abort()
        throw error
      }
    }),
  )

  const motifs = new Map<string, string>()
  issues.forEach((issue, i) => {
    if (issue.status === 'fulfilled') {
      registered.set(issue.value.tool.name, issue.value.controller)
    } else {
      motifs.set(àPoser[i].name, raison(issue.reason))
    }
  })

  // L'état constate ce qui MANQUE, il ne se contente pas de rapporter le
  // dernier tour. Compter les seuls échecs du tour courant faisait qu'une
  // synchronisation sans rien à poser — un simple changement de version du
  // cahier — repassait la page en « tout va bien » alors qu'un outil restait
  // absent depuis plusieurs minutes.
  const failures = voulus
    .filter((t) => !registered.has(t.name))
    .map((t) => ({ name: t.name, reason: motifs.get(t.name) ?? 'not registered' }))

  const posés = [...registered.keys()]
  const availability = checkAvailability()

  setState({
    // Un échec partiel n'est ni « enregistré » ni « échoué ». L'ancien code
    // rendait `phase: 'failed'` avec `toolNames: []` alors que les premiers
    // outils de la boucle étaient bel et bien posés et joignables : l'écran
    // annonçait zéro outil pendant qu'un agent en appelait trois.
    phase: failures.length === 0 ? 'registered' : posés.length > 0 ? 'partial' : 'failed',
    availability,
    toolNames: posés,
    failures,
    lifecycle,
    error: failures.length > 0 ? failures.map((f) => `${f.name} — ${f.reason}`).join(' ; ') : null,
    observedTools: state.observedTools,
  })
}

/**
 * File des synchronisations.
 *
 * Le magasin peut notifier deux fois coup sur coup — une écriture d'agent suivie
 * d'une correction humaine, par exemple. Deux `sync` en vol calculeraient tous
 * deux le même « à poser » et enregistreraient le même nom deux fois : la
 * spécification REJETTE le second avec `InvalidStateError`, et la page se
 * déclarerait en échec partiel sur un outil pourtant bien présent.
 */
let file: Promise<void> = Promise.resolve()

function syncQueued(modelContext: ModelContextLike): Promise<void> {
  file = file.then(
    () => sync(modelContext),
    () => sync(modelContext),
  )
  return file
}

/**
 * Relit les outils enregistrés depuis la table du navigateur, et retient le
 * résultat.
 *
 * Utile parce que c'est une source distincte de la carte que ce module tient :
 * une divergence entre les deux est le genre de panne qu'un compteur interne
 * ne peut pas voir. Rien de plus — `getTools()` est l'API des agents dans la
 * page, pas la voie par laquelle l'agent du navigateur découvre les outils.
 */
async function observeRegisteredTools(modelContext: ModelContextLike): Promise<void> {
  if (typeof modelContext.getTools !== 'function') return
  try {
    const outils = await modelContext.getTools()
    setState({ ...state, observedTools: outils.map((t) => t.name) })
  } catch {
    // Une relecture indisponible n'est pas une panne d'enregistrement : on
    // laisse la dernière observation en place plutôt que d'annoncer un vide.
  }
}

/** Défait tout ce que ce module a posé. Utilisé au démontage et par les tests. */
function unregisterAll(): void {
  // Le démontage avorte tout, quel que soit le mode : il n'y a plus de page à
  // servir, et une exécution en vol n'a plus personne à qui répondre.
  for (const controller of registered.values()) controller.abort()
  registered.clear()
}

let détacher: (() => void) | null = null

/**
 * Enregistre les outils et les tient alignés sur l'état du cahier.
 *
 * Idempotent : les appels suivants ne réenregistrent rien.
 */
export async function registerTools(): Promise<RegistrationState> {
  const guarded = globalThis as GuardedGlobal
  if (guarded[GUARD]) return state
  guarded[GUARD] = true

  const availability = checkAvailability()
  const modelContext = availability.supported ? getModelContext() : null
  // Décidée UNE FOIS, au démarrage : la version du navigateur ne change pas
  // sous les pieds d'un document, et une politique qui basculerait en cours de
  // route laisserait des outils dans un état qu'aucun des deux modes ne décrit.
  const lifecycle = detectLifecycle()

  if (!modelContext) {
    // Pas une panne : l'immense majorité des navigateurs sont dans ce cas.
    // La page doit rester lisible et dire quoi activer.
    setState({
      phase: 'unsupported',
      availability,
      toolNames: [],
      failures: [],
      lifecycle,
      error: null,
      observedTools: null,
    })
    return state
  }

  // L'événement du navigateur, pas une notification que ce module s'enverrait
  // à lui-même : c'est le signal que la plateforme émet quand la table des
  // outils bouge, et donc le moment juste pour la relire.
  const surToolChange = () => void observeRegisteredTools(modelContext)
  modelContext.addEventListener?.('toolchange', surToolChange)

  // Le magasin est la source du cycle de vie : ouvrir, clore ou supprimer un
  // cahier change ce qu'un agent doit voir.
  const désabonner = store.subscribe(() => void syncQueued(modelContext))

  détacher = () => {
    désabonner()
    modelContext.removeEventListener?.('toolchange', surToolChange)
    unregisterAll()
  }

  setState({ ...state, lifecycle })
  await syncQueued(modelContext)
  await observeRegisteredTools(modelContext)

  return state
}

/** Réinitialise le garde-fou. Réservé aux tests. */
export function __resetRegistration(): void {
  const guarded = globalThis as GuardedGlobal
  delete guarded[GUARD]
  détacher?.()
  détacher = null
  file = Promise.resolve()
  unregisterAll()
  listeners.clear()
  state = {
    phase: 'pending',
    availability: { supported: false, reason: 'no-api' },
    toolNames: [],
    failures: [],
    lifecycle: { mode: 'static', chromiumMajor: null, reason: 'not detected yet' },
    error: null,
    observedTools: null,
  }
}
