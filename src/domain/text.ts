// "Cafe" and "cafe" are the same word for search as for the anti-repeat guard:
// one definition, or the two contradict each other. The NFD fold is expensive
// and an ASCII string has nothing to fold: 23.9 ms → 5.3 ms over 60,000 fields,
// at a cost of 13% on fully accented text.
const NON_ASCII = /[\u0080-\uFFFF]/

export function fold(value: string): string {
  const lower = value.toLocaleLowerCase()
  if (!NON_ASCII.test(lower)) return lower
  return lower.normalize('NFD').replace(/\p{Diacritic}/gu, '')
}
