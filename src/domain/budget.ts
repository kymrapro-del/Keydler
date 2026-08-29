/**
 * Chrome recommande 1,5 k caractères par sortie d'outil, sans limite dure : on remplit donc
 * jusqu'au budget et non jusqu'au compte, douze extraits de 240 caractères en faisant 6296.
 * Deux exemptions : `read_task_detail`, qui borné à 1,5 k ne rendait qu'une ou deux entrées
 * par page dès qu'une preuve était jointe, et `resume_task`, qui a son propre budget en
 * tokens, soit 1600 caractères, 1528 rendus en pratique.
 * https://developer.chrome.com/docs/ai/webmcp/secure-tools
 */
export const MAX_TOOL_OUTPUT = 1_500

/**
 * De la place tenue d'avance pour l'en-tête et le pied, qui dépendent du
 * nombre d'entrées finalement retenues, donc du résultat de la boucle qui les
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
