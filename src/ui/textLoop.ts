/**
 * Ruban de texte défilant sur une trajectoire SVG.
 *
 * Porté depuis le composant React « TextLoop » de reactbits.dev vers du DOM
 * et un `requestAnimationFrame` — ce projet n'a pas React, et le mouvement
 * du composant original (un `gsap.to` linéaire, sans easing, en boucle
 * infinie sur un offset) est exactement ce qu'un incrément de temps écoulé
 * fait tout seul. Ajouter GSAP pour ça aurait été une dépendance de plus de
 * 300 Ko pour reproduire vingt lignes.
 *
 * Le texte est réel, pas un slogan générique : les sept noms des outils
 * WebMCP que `src/webmcp/tools.ts` enregistre pour de vrai. C'est un rappel
 * visuel de ce qu'un agent voit, pas une décoration qui parlerait pour rien.
 */

import { watchVisibility } from './visibilityGate'

const VIEW_W = 1200
const VIEW_H = 200
const CY = VIEW_H / 2
const SVG_NS = 'http://www.w3.org/2000/svg'

export interface TextLoopOptions {
  /** Segments répétés, dans l'ordre, séparés par `separator`. */
  items: readonly string[]
  separator?: string
  /** Amplitude de l'onde, en unités du viewBox. */
  curviness?: number
  /** Unités de trajectoire par seconde. */
  speed?: number
  ribbonWidth?: number
  className?: string
}

const DEFAULTS = {
  separator: '✦',
  curviness: 16,
  speed: 70,
  ribbonWidth: 56,
} as const

function buildWavePath(curviness: number): string {
  const a = curviness
  return (
    `M -320 ${CY} Q -160 ${CY - a} 0 ${CY} T 320 ${CY} T 640 ${CY} T 960 ${CY} ` +
    `T 1280 ${CY} T ${VIEW_W + 320} ${CY}`
  )
}

function el<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag)
}

/**
 * `document.fonts`, `window.matchMedia` et la géométrie SVG réelle
 * (`getTotalLength`, `getComputedTextLength`) n'existent pas sous jsdom — les
 * tests rendent la landing sans navigateur. Sans ces gardes, le premier test
 * qui monte la page lève, et `render()` ne rattrapant rien, CHAQUE test qui
 * passe par la landing tombe avec lui. Le ruban doit donc savoir se rendre
 * en statique, une seule copie du texte, sans animation, quand la plateforme
 * ne lui donne pas de quoi mesurer ou animer proprement.
 */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return true
  }
}

let idCounter = 0

/**
 * Construit le ruban et démarre son animation dans `container`.
 *
 * Rend une fonction d'arrêt : le rAF et les deux écouteurs de survol doivent
 * être coupés quand le conteneur est remplacé, sinon chaque nouveau rendu de
 * la landing empile une boucle de plus sur les précédentes — exactement le
 * genre de fuite qu'un `render()` qui remplace `innerHTML` sans prévenir
 * laisse traîner derrière lui.
 */
export function mountTextLoop(container: HTMLElement, options: TextLoopOptions): () => void {
  const { items, separator = DEFAULTS.separator, curviness = DEFAULTS.curviness } = options
  const speed = options.speed ?? DEFAULTS.speed
  const ribbonWidth = options.ribbonWidth ?? DEFAULTS.ribbonWidth

  idCounter += 1
  const pathId = `text-loop-path-${idCounter}`

  const unit = `${items.join(` ${separator} `)} ${separator} `

  const svg = el('svg')
  svg.setAttribute('class', options.className ?? 'text-loop__svg')
  svg.setAttribute('viewBox', `0 0 ${VIEW_W} ${VIEW_H}`)
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
  svg.setAttribute('role', 'img')
  svg.setAttribute('aria-label', items.join(', '))

  const path = el('path')
  path.setAttribute('id', pathId)
  path.setAttribute('d', buildWavePath(curviness))
  path.setAttribute('class', 'text-loop__ribbon')
  path.setAttribute('fill', 'none')
  path.setAttribute('stroke-width', String(ribbonWidth))
  path.setAttribute('stroke-linecap', 'round')
  svg.appendChild(path)

  const measure = el('text')
  measure.setAttribute('class', 'text-loop__measure')
  measure.setAttribute('aria-hidden', 'true')
  measure.textContent = unit
  svg.appendChild(measure)

  function makeLayer(): { text: SVGTextElement; textPath: SVGTextPathElement } {
    const text = el('text')
    text.setAttribute('class', 'text-loop__text')
    text.setAttribute('dominant-baseline', 'central')
    text.setAttribute('aria-hidden', 'true')
    const textPath = el('textPath')
    textPath.setAttributeNS('http://www.w3.org/1999/xlink', 'href', `#${pathId}`)
    textPath.setAttribute('href', `#${pathId}`)
    textPath.setAttribute('startOffset', '0')
    textPath.textContent = unit
    text.appendChild(textPath)
    svg.appendChild(text)
    return { text, textPath }
  }
  const head = makeLayer()
  const tail = makeLayer()

  container.replaceChildren(svg)

  let length = 0
  let raf = 0
  let offset = 0
  let last = 0
  let hovered = false
  let visible = true
  const stopWatchingVisibility = watchVisibility(container, (v) => {
    visible = v
  })

  /** Rend `false` si la plateforme ne sait pas mesurer un chemin SVG. */
  function measureAndFit(): boolean {
    let totalLength: number
    let unitWidth: number
    try {
      totalLength = path.getTotalLength()
      unitWidth = measure.getComputedTextLength()
    } catch {
      return false
    }
    if (!totalLength || !Number.isFinite(totalLength)) return false

    length = totalLength
    const reps = unitWidth > 0 ? Math.max(1, Math.round(length / unitWidth)) : 1
    const looped = unit.repeat(reps)
    head.textPath.textContent = looped
    tail.textPath.textContent = looped
    head.textPath.setAttribute('textLength', String(length))
    tail.textPath.setAttribute('textLength', String(length))
    head.textPath.setAttribute('lengthAdjust', 'spacing')
    tail.textPath.setAttribute('lengthAdjust', 'spacing')
    return true
  }

  function apply(o: number): void {
    const partner = o >= 0 ? o - length : o + length
    head.textPath.setAttribute('startOffset', String(o))
    tail.textPath.setAttribute('startOffset', String(partner))
  }

  const measured = measureAndFit()
  if (measured) apply(0)

  if (measured && document.fonts?.ready) {
    document.fonts.ready
      .then(() => {
        if (measureAndFit()) apply(offset)
      })
      .catch(() => {
        /* la police système suffit si la webfont n'a pas fini de charger */
      })
  }

  const canAnimate =
    measured && !prefersReducedMotion() && speed > 0 && typeof requestAnimationFrame === 'function'

  function frame(now: number): void {
    raf = requestAnimationFrame(frame)
    if (!last) last = now
    const dt = (now - last) / 1000
    last = now
    if (hovered || !visible || document.hidden || !length) return
    // `dt` non fini (timestamp absent ou aberrant) ne doit jamais entrer dans
    // le calcul : une seule frame avec un NaN corromprait `offset` pour de
    // bon, puisque NaN se propage dans toute arithmétique qui le touche
    // ensuite et ne s'en remet jamais tout seul.
    if (!Number.isFinite(dt) || dt < 0) return
    offset = (offset + speed * dt) % length
    apply(offset)
  }

  if (canAnimate) {
    raf = requestAnimationFrame(frame)
  }

  const onEnter = () => {
    hovered = true
  }
  const onLeave = () => {
    hovered = false
  }
  container.addEventListener('pointerenter', onEnter)
  container.addEventListener('pointerleave', onLeave)

  return () => {
    if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf)
    container.removeEventListener('pointerenter', onEnter)
    container.removeEventListener('pointerleave', onLeave)
    stopWatchingVisibility()
  }
}
