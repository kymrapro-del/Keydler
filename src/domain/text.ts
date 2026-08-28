/**
 * Replier casse et accents : « Café » et « cafe » sont le même mot pour une
 * recherche comme pour une garde anti-répétition. Une seule définition, parce
 * que deux endroits qui répondent différemment à « est-ce le même mot ? »
 * finissent par se contredire devant l'utilisateur.
 *
 * Le repli complet — `normalize('NFD')` puis `\p{Diacritic}` — est cher, et
 * ces deux appelants le font sur beaucoup de chaînes : la recherche relit tout
 * le cahier à chaque frappe, la garde compare à tout ce qui est déjà posé. Or
 * une chaîne ASCII n'a rien à replier, et une sortie de commande, un diff, une
 * URL ou une empreinte n'en sortent jamais.
 *
 * Mesuré sur 60 000 champs : 23,9 ms → 5,3 ms. Le prix est de 13 % sur un
 * texte entièrement accentué, où le test échoue à chaque fois ; c'est le sens
 * de l'échange, et il penche du bon côté pour ce que ce produit contient.
 */
const NON_ASCII = /[\u0080-\uFFFF]/

export function fold(value: string): string {
  const lower = value.toLocaleLowerCase()
  if (!NON_ASCII.test(lower)) return lower
  return lower.normalize('NFD').replace(/\p{Diacritic}/gu, '')
}
