/**
 * Surligne, dans la nav, le lien de la section actuellement à l'écran.
 *
 * Une nav à onglets qui n'en active jamais aucun pendant le défilement se lit
 * comme cassée, pas comme sobre — la pastille du lien actif n'a de sens que si
 * elle suit vraiment ce qu'on regarde.
 */
export interface NavSpyOptions {
  /** Sélecteur des liens de nav à surligner ; chaque `href` doit être `#id`. */
  linkSelector: string
  activeClass: string
}

export function mountNavSpy(container: HTMLElement, options: NavSpyOptions): () => void {
  const links = [...container.querySelectorAll<HTMLAnchorElement>(options.linkSelector)]
  const bySectionId = new Map<string, HTMLAnchorElement>()
  for (const link of links) {
    const id = link.getAttribute('href')?.replace(/^#/, '')
    if (id) bySectionId.set(id, link)
  }

  const sections = [...bySectionId.keys()]
    .map((id) => document.getElementById(id))
    .filter((el): el is HTMLElement => el !== null)

  if (sections.length === 0 || typeof IntersectionObserver !== 'function') {
    // jsdom (les tests) et les très vieux navigateurs n'ont pas
    // `IntersectionObserver` : la nav reste utilisable, seule la mise en
    // évidence automatique manque.
    return () => {}
  }

  function setActive(id: string | null): void {
    for (const [sectionId, link] of bySectionId) {
      link.classList.toggle(options.activeClass, sectionId === id)
      if (sectionId === id) link.setAttribute('aria-current', 'true')
      else link.removeAttribute('aria-current')
    }
  }

  // La section la plus haute qui touche encore la bande d'observation gagne —
  // pas simplement « la plus visible », qui hésiterait entre deux sections de
  // hauteurs très différentes pendant le défilement.
  const visible = new Set<string>()
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target.id)
        else visible.delete(entry.target.id)
      }
      const ordered = sections.filter((s) => visible.has(s.id))
      setActive(ordered[0]?.id ?? null)
    },
    // La bande d'observation est resserrée sous la nav flottante et sur le
    // tiers supérieur de l'écran : une section ne s'active qu'en approchant
    // du haut, pas dès qu'elle pointe par le bas du viewport.
    { rootMargin: '-96px 0px -66% 0px', threshold: 0 },
  )

  for (const section of sections) observer.observe(section)

  return () => {
    observer.disconnect()
    setActive(null)
  }
}
