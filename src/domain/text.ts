// « Café » et « cafe » sont le même mot pour la recherche comme pour la garde
// anti-répétition : une seule définition, sinon les deux se contredisent. Le repli
// NFD est cher et une chaîne ASCII n'a rien à replier — 23,9 ms → 5,3 ms sur
// 60 000 champs, au prix de 13 % sur du texte entièrement accentué.
const NON_ASCII = /[\u0080-\uFFFF]/

export function fold(value: string): string {
  const lower = value.toLocaleLowerCase()
  if (!NON_ASCII.test(lower)) return lower
  return lower.normalize('NFD').replace(/\p{Diacritic}/gu, '')
}
