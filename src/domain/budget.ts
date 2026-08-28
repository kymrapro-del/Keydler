/**
 * Chrome recommande 1,5 k caractères par sortie d'outil : au-delà, on « tombe
 * sur les garde-fous des agents ». Ce ne sont pas des limites dures.
 *
 * Le compte de correspondances ne suffit pas à s'y tenir : douze extraits de
 * 240 caractères chacun font 6296 caractères, mesurés. Une recherche se
 * remplit donc jusqu'au budget, pas jusqu'au compte — elle sert à TROUVER, et
 * son en-tête annonce déjà « N shown of M found », donc rien n'est caché.
 *
 * Deux exemptions, écrites plutôt que contournées :
 *
 * - **`read_task_detail` tout entier.** J'ai commencé par le borner aussi, et
 *   une épreuve existante l'a refusé — à raison. Le partage des rôles est
 *   délibéré : `resume_task` est le pointeur court, `read_task_detail` est là
 *   où l'on va CHERCHER du volume, preuve comprise jusqu'à
 *   `MAX_EVIDENCE_LENGTH`. Le borner à 1,5 k rendait une à deux entrées par
 *   page dès qu'une preuve était jointe, et détruisait la raison d'être du
 *   chemin. Sa page reste bornée par un nombre d'entrées, et son en-tête dit
 *   toujours combien il en reste et à quel décalage reprendre.
 * - `resume_task` a son propre budget en tokens (`TOKEN_BUDGET`), qui vaut
 *   1600 caractères. Il rend 1528 en pratique, soit 1,9 % de plus que la
 *   recommandation ; l'aligner coûtait plus qu'il ne rapportait.
 *
 * https://developer.chrome.com/docs/ai/webmcp/secure-tools
 */
export const MAX_TOOL_OUTPUT = 1_500

/**
 * De la place tenue d'avance pour l'en-tête et le pied, qui dépendent du
 * nombre d'entrées finalement retenues — donc du résultat de la boucle qui les
 * choisit. Réserver large lève la circularité sans compliquer le calcul.
 */
export const OUTPUT_FRAME = 300

/**
 * Ce qui reste pour les entrées elles-mêmes.
 */
export const OUTPUT_BODY = MAX_TOOL_OUTPUT - OUTPUT_FRAME

/**
 * Remplit jusqu'au budget plutôt que jusqu'au compte, et rend TOUJOURS au moins
 * un élément : une entrée plus grosse que le budget rendrait sinon une page
 * vide, et la pagination n'avancerait jamais.
 */
export function fitting<T>(items: readonly T[], cost: (item: T) => number): T[] {
  const kept: T[] = []
  let used = 0
  for (const item of items) {
    const price = cost(item)
    if (kept.length > 0 && used + price > OUTPUT_BODY) break
    kept.push(item)
    used += price
  }
  return kept
}
