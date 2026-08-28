/**
 * Prévient d'une entrée en avertissant à chaque passage dans ou hors du
 * viewport — pour que les trois boucles d'animation de la landing (le fond
 * WebGL, le ruban SVG, le titre en particules) sachent s'arrêter de calculer
 * quand personne ne les regarde.
 *
 * Aucune des trois ne s'arrêtait auparavant au défilement : une fois la
 * bannière passée, le shader continuait de tourner à plein régime, invisible,
 * pour toujours — la cause la plus probable d'un ralentissement perçu sur une
 * page qui n'a pourtant, à l'écran, plus rien d'animé.
 */
export function watchVisibility(el: Element, onChange: (visible: boolean) => void): () => void {
  if (typeof IntersectionObserver !== 'function') {
    // jsdom (les tests) et les très vieux navigateurs : par défaut visible,
    // pour ne jamais geler une animation là où on ne peut pas savoir.
    onChange(true)
    return () => {}
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) onChange(entry.isIntersecting)
    },
    // Une marge généreuse : l'animation reprend un peu avant que l'élément
    // n'entre réellement à l'écran, pour qu'on ne voie jamais un premier
    // rendu figé pendant que le défilement s'arrête.
    { rootMargin: '200px 0px' },
  )
  observer.observe(el)

  return () => observer.disconnect()
}
