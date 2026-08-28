/**
 * Vidéo de fond pilotée par le scroll — pas de lecture autonome : la seule
 * chose qui avance `currentTime`, c'est la position de la page. Utilisée pour
 * l'organigramme de nœuds de `#tool-anatomy` (voir scripts/process-brand-video.mjs
 * pour la fabrication des deux fichiers, un par thème).
 *
 * Deux fichiers plutôt qu'un canal alpha : voir la note en tête de ce script
 * de fabrication — WebM+alpha ne survit pas à son propre aller-retour
 * encode→décode sur cette machine, et Safari ne décode aucune vidéo avec
 * alpha nativement de toute façon. Chaque fichier est donc une vidéo opaque
 * banale, déjà aplatie sur la bonne couleur de fond du thème.
 */

import { watchVisibility } from './visibilityGate'

export interface ScrollVideoOptions {
  lightSrc: string
  darkSrc: string
}

/**
 * `window.matchMedia` n'existe pas sous jsdom (les tests) — contrairement à
 * `silkBackground.ts` et `particleText.ts`, qui ne l'atteignent jamais
 * (bloqués plus tôt par l'absence de contexte WebGL/2D sous jsdom), rien
 * n'arrête ce module avant cet appel. Un bouchon qui répond « ne correspond
 * jamais » laisse le reste du module tourner sans se soucier de la
 * plateforme : la vidéo s'anime normalement, sans thème sombre ni mouvement
 * réduit détectés — un dégradé raisonnable, jamais un crash.
 */
function safeMatchMedia(query: string): MediaQueryList {
  if (typeof window.matchMedia === 'function') return window.matchMedia(query)
  return {
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  } as MediaQueryList
}

/**
 * Même contrat de priorité que documenté en tête de src/tokens.css :
 * `data-theme` explicite gagne toujours sur la préférence système.
 */
function isDarkTheme(): boolean {
  const explicit = document.documentElement.dataset.theme
  if (explicit === 'dark') return true
  if (explicit === 'light') return false
  return safeMatchMedia('(prefers-color-scheme: dark)').matches
}

/**
 * Monte la vidéo dans `container` et la relie au scroll de la page.
 *
 * Rend une fonction d'arrêt, même contrat que les autres modules de `ui/`.
 */
export function mountScrollVideo(container: HTMLElement, options: ScrollVideoOptions): () => void {
  const video = document.createElement('video')
  video.className = 'tool-anatomy__video'
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  video.setAttribute('aria-hidden', 'true')
  container.prepend(video)

  let currentIsDark: boolean | null = null
  function applySrc(): void {
    const dark = isDarkTheme()
    if (dark === currentIsDark) return
    currentIsDark = dark
    const resumeAt = video.currentTime
    video.src = dark ? options.darkSrc : options.lightSrc
    video.load()
    video.addEventListener(
      'loadedmetadata',
      () => {
        video.currentTime = resumeAt
      },
      { once: true },
    )
  }
  applySrc()

  // Sur Safari iOS, `currentTime` posé avant toute lecture est parfois ignoré
  // silencieusement. Une vidéo muette peut s'auto-jouer sans geste utilisateur
  // — jouer puis mettre en pause immédiatement débloque le seek sans jamais
  // qu'une image bouge à l'écran. `play()` sous jsdom (les tests) est un
  // bouchon qui ne rend pas de Promise : sans ce contrôle, `.then` lève et
  // casse le montage entier avant qu'il ait pu rendre sa fonction d'arrêt.
  const primed = video.play()
  if (primed && typeof primed.then === 'function') {
    primed.then(
      () => video.pause(),
      () => {
        /* autoplay refusé : le seek restera tenté quand même, au pire sans effet */
      },
    )
  }

  let visible = true
  const stopWatchingVisibility = watchVisibility(container, (v) => {
    visible = v
  })

  const reducedMotionQuery = safeMatchMedia('(prefers-reduced-motion: reduce)')

  /** 0 quand le haut de `container` touche le bas de l'écran, 1 quand son bas touche le haut. */
  function scrollProgress(): number {
    const rect = container.getBoundingClientRect()
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight
    const total = rect.height + viewportHeight
    const traveled = viewportHeight - rect.top
    return Math.min(Math.max(traveled / total, 0), 1)
  }

  let raf = 0
  function update(): void {
    raf = 0
    if (!visible || document.hidden) return
    const duration = video.duration
    if (!Number.isFinite(duration) || duration <= 0) return
    video.currentTime = scrollProgress() * duration
  }
  function schedule(): void {
    if (!raf) raf = requestAnimationFrame(update)
  }

  /**
   * Moins de mouvement ne veut pas dire aucune information : la vidéo se fige
   * sur son image finale (tous les nœuds connectés) plutôt que de disparaître
   * — même principe que `reducedMotion` dans particleText.ts et textLoop.ts.
   */
  function applyReducedMotionPreference(): void {
    window.removeEventListener('scroll', schedule)
    window.removeEventListener('resize', schedule)
    if (reducedMotionQuery.matches) {
      const duration = video.duration
      if (Number.isFinite(duration) && duration > 0) video.currentTime = duration
    } else {
      window.addEventListener('scroll', schedule, { passive: true })
      window.addEventListener('resize', schedule)
      schedule()
    }
  }

  if (video.readyState >= 1) applyReducedMotionPreference()
  else video.addEventListener('loadedmetadata', applyReducedMotionPreference, { once: true })

  const onReducedMotionChange = () => applyReducedMotionPreference()
  reducedMotionQuery.addEventListener('change', onReducedMotionChange)

  const colorSchemeQuery = safeMatchMedia('(prefers-color-scheme: dark)')
  const onColorSchemeChange = () => applySrc()
  colorSchemeQuery.addEventListener('change', onColorSchemeChange)

  const themeObserver = new MutationObserver(applySrc)
  themeObserver.observe(document.documentElement, { attributeFilter: ['data-theme'] })

  return () => {
    if (raf) cancelAnimationFrame(raf)
    window.removeEventListener('scroll', schedule)
    window.removeEventListener('resize', schedule)
    reducedMotionQuery.removeEventListener('change', onReducedMotionChange)
    colorSchemeQuery.removeEventListener('change', onColorSchemeChange)
    themeObserver.disconnect()
    stopWatchingVisibility()
    video.remove()
  }
}
