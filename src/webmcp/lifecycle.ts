/**
 * Peut-on désenregistrer un outil pendant que la page vit ?
 *
 * La question n'est pas rhétorique, et sa réponse décide d'un défaut visible en
 * démonstration. `complete_task` clôt la tâche ; la clôture rend les outils
 * d'écriture inutiles ; les retirer avorte leur contrôleur d'enregistrement —
 * y compris celui de l'outil qui est justement en train de répondre. Chrome ne
 * garantit qu'un désenregistrement ne casse pas une exécution en vol qu'à
 * partir de la **153**. La cible du concours commence à la **149**.
 *
 * ── Ce qui ne marche pas ────────────────────────────────────────────────────
 *
 * Une version antérieure comptait les exécutions en vol et retenait le retrait
 * d'un tour de boucle, par `setTimeout(…, 0)`, en supposant que la réponse
 * serait livrée entre-temps. C'était faux, et faux d'une façon qu'aucun test
 * ne pouvait rattraper : la spécification dit que l'ordre entre la source de
 * tâches WebMCP et celle des minuteurs NE PEUT PAS être invoqué. Un minuteur
 * peut s'exécuter avant, entre ou après les tâches WebMCP. Un tour de boucle
 * n'est donc pas une garantie de livraison, et le test qui prétendait le
 * montrer appelait `execute()` en direct — sans traverser ni la carte des
 * exécutions du navigateur, ni la tâche globale qui résout la promesse côté
 * client. Il ne prouvait rien du comportement qu'il nommait.
 *
 * ── Ce qu'on fait à la place ────────────────────────────────────────────────
 *
 * On ne retire que si la capacité est POSITIVEMENT connue. Partout ailleurs —
 * version ancienne, navigateur non-Chromium, environnement qui ne dit rien —
 * les outils restent posés et refusent proprement. On ne peut pas casser une
 * exécution avec un contrôleur qu'on n'avorte pas.
 *
 * ── Ce que cette détection vaut ─────────────────────────────────────────────
 *
 * C'est un reniflage de version, pas une détection de fonctionnalité. Il
 * n'existe aucune surface qui répondrait à « désenregistrer casse-t-il une
 * exécution en vol ? ». C'est précisément pourquoi le défaut est le mode sûr :
 * la seule erreur possible est alors de garder un outil de trop, ce qui coûte
 * une ligne dans la liste que l'agent lit — contre une réponse perdue et une
 * démonstration qui s'arrête.
 */

/** Version de Chromium à partir de laquelle le retrait dynamique est sûr. */
export const DYNAMIC_UNREGISTER_MIN_CHROMIUM = 153

export type LifecycleMode = 'dynamic' | 'static'

export type ToolLifecycle = {
  mode: LifecycleMode
  /** Version majeure de Chromium lue, ou `null` si rien de fiable. */
  chromiumMajor: number | null
  /** Sur quoi la décision se fonde. Affiché, parce qu'elle n'est pas prouvable. */
  reason: string
}

type Brand = { brand?: unknown; version?: unknown }
type UADataLike = { brands?: Brand[] }

/**
 * La version majeure de Chromium, lue par la voie structurée.
 *
 * `userAgentData.brands` publie la version majeure réelle sous la marque
 * « Chromium », à côté de marques de brouillage dont la version ne veut rien
 * dire — d'où la sélection par nom de marque plutôt que par position.
 *
 * Aucun repli sur la chaîne d'agent utilisateur. Elle est réécrite par les
 * extensions, les modes de confidentialité et les navigateurs qui se font
 * passer pour un autre ; en tirer un numéro donnerait une confiance que la
 * source ne mérite pas, et cette confiance-là déciderait d'avorter un
 * contrôleur. Pas de source fiable, pas de retrait.
 */
export function chromiumMajorVersion(): number | null {
  const data = (globalThis.navigator as unknown as { userAgentData?: UADataLike } | undefined)
    ?.userAgentData
  if (!data || !Array.isArray(data.brands)) return null

  for (const entrée of data.brands) {
    if (typeof entrée?.brand !== 'string' || entrée.brand.toLowerCase() !== 'chromium') continue
    const version = Number.parseInt(String(entrée.version), 10)
    return Number.isInteger(version) ? version : null
  }
  return null
}

export function detectLifecycle(): ToolLifecycle {
  const chromiumMajor = chromiumMajorVersion()

  if (chromiumMajor === null) {
    return {
      mode: 'static',
      chromiumMajor: null,
      reason:
        'Chromium version unknown — tools stay registered for the life of the document (safe default).',
    }
  }

  if (chromiumMajor >= DYNAMIC_UNREGISTER_MIN_CHROMIUM) {
    return {
      mode: 'dynamic',
      chromiumMajor,
      reason: `Chromium ${chromiumMajor} — unregistering a tool is safe while an execution is in flight (since ${DYNAMIC_UNREGISTER_MIN_CHROMIUM}).`,
    }
  }

  return {
    mode: 'static',
    chromiumMajor,
    reason: `Chromium ${chromiumMajor} — below ${DYNAMIC_UNREGISTER_MIN_CHROMIUM}, where unregistering may drop an in-flight reply; tools stay registered.`,
  }
}
