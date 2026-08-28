/**
 * Fond animé façon « soie » — porté depuis le composant React « Silk » de
 * reactbits.dev vers du WebGL brut, sans `three` ni `@react-three/fiber`.
 *
 * L'original charge un moteur de scène 3D complet (three.js, ~600 Ko) pour
 * dessiner un unique plan plein écran avec un shader — aucune géométrie 3D
 * n'est en jeu. Un triangle plein écran et une trentaine de lignes de bootstrap
 * WebGL1 suffisent à faire tourner EXACTEMENT le même shader ; le moteur de
 * scène n'aurait rien ajouté d'autre que son propre poids.
 *
 * La couleur n'est pas un hex choisi une fois : elle est lue depuis
 * `--md-sys-color-primary` au montage, et relue si le thème système change —
 * c'est ce qui garde le fond « toujours dans les verts du site » sans dupliquer
 * la couleur de marque nulle part.
 *
 * La boucle s'arrête aussi hors du viewport (voir `watchVisibility`) : un
 * shader plein écran qui tourne pendant qu'on lit le tableau de bord plus bas
 * dans la page ne coûte rien à l'œil et tout au processeur graphique.
 */

import { watchVisibility } from './visibilityGate'

const VERTEX_SRC = `
attribute vec2 aPosition;
varying vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`

// Corps du fragment shader inchangé par rapport à la source reactbits — seule
// la déclaration de précision a été ajoutée, requise en WebGL1 et absente du
// GLSL ES 3.00 que react-three-fiber compile pour WebGL2.
const FRAGMENT_SRC = `
precision highp float;
varying vec2 vUv;

uniform float uTime;
uniform vec3  uColor;
uniform float uSpeed;
uniform float uScale;
uniform float uRotation;
uniform float uNoiseIntensity;

const float e = 2.71828182845904523536;

float noise(vec2 texCoord) {
  float G = e;
  vec2  r = (G * sin(G * texCoord));
  return fract(r.x * r.y * (1.0 + texCoord.x));
}

vec2 rotateUvs(vec2 uv, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  mat2  rot = mat2(c, -s, s, c);
  return rot * uv;
}

void main() {
  float rnd        = noise(gl_FragCoord.xy);
  vec2  uv         = rotateUvs(vUv * uScale, uRotation);
  vec2  tex        = uv * uScale;
  float tOffset    = uSpeed * uTime;

  tex.y += 0.03 * sin(8.0 * tex.x - tOffset);

  float pattern = 0.6 +
                  0.4 * sin(5.0 * (tex.x + tex.y +
                                   cos(3.0 * tex.x + 5.0 * tex.y) +
                                   0.02 * tOffset) +
                           sin(20.0 * (tex.x + tex.y - 0.1 * tOffset)));

  vec4 col = vec4(uColor, 1.0) * vec4(pattern) - rnd / 15.0 * uNoiseIntensity;
  col.a = 1.0;
  gl_FragColor = col;
}
`

export interface SilkBackgroundOptions {
  speed?: number
  scale?: number
  noiseIntensity?: number
  rotation?: number
  /** Rôle de couleur M3 dont la valeur calculée alimente `uColor`. */
  colorToken?: string
  className?: string
}

const DEFAULTS = {
  speed: 3,
  scale: 1,
  noiseIntensity: 1.2,
  rotation: 0,
  colorToken: '--md-sys-color-primary',
} as const

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.trim().replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16) / 255
  const g = parseInt(clean.slice(2, 4), 16) / 255
  const b = parseInt(clean.slice(4, 6), 16) / 255
  return [r || 0, g || 0, b || 0]
}

function readColor(token: string): [number, number, number] {
  const value = getComputedStyle(document.documentElement).getPropertyValue(token)
  return hexToRgb(value)
}

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader)
    return null
  }
  return shader
}

/**
 * Monte le fond dans `host` et démarre son animation.
 *
 * Rend une fonction d'arrêt, sur le même principe que `mountTextLoop` : sans
 * elle, chaque nouveau rendu de la landing créerait un second contexte WebGL
 * par-dessus le précédent, jamais libéré.
 */
export function mountSilkBackground(
  host: HTMLElement,
  options: SilkBackgroundOptions = {},
): () => void {
  const speed = options.speed ?? DEFAULTS.speed
  const scale = options.scale ?? DEFAULTS.scale
  const noiseIntensity = options.noiseIntensity ?? DEFAULTS.noiseIntensity
  const rotation = options.rotation ?? DEFAULTS.rotation
  const colorToken = options.colorToken ?? DEFAULTS.colorToken

  const canvas = document.createElement('canvas')
  canvas.className = options.className ?? 'silk-background'
  canvas.setAttribute('aria-hidden', 'true')
  host.prepend(canvas)

  const maybeGl = (canvas.getContext('webgl') ??
    canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null

  // Pas de WebGL — mobile ancien, navigateur en mode logiciel bridé, contexte
  // refusé par une extension. Le fond reste transparent, la page garde son
  // apparence sans lui : ce n'est jamais une raison de casser la landing.
  if (!maybeGl) return () => host.removeChild(canvas)

  // Réaffecté à une liaison neuve, explicitement non nullable : TypeScript ne
  // propage pas le rétrécissement d'un contrôle de nullité dans le corps d'une
  // fonction déclarée plus bas dans la même portée — seule une nouvelle
  // liaison typée non nullable le lui garantit pour `applyColor`, `resize`,
  // `draw`, qui capturent toutes `gl` par fermeture.
  const gl: WebGLRenderingContext = maybeGl

  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SRC)
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SRC)
  const program = gl.createProgram()
  if (!vertexShader || !fragmentShader || !program) {
    host.removeChild(canvas)
    return () => {}
  }
  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    host.removeChild(canvas)
    return () => {}
  }
  gl.useProgram(program)

  // Un triangle plein écran : trois sommets qui débordent largement le clip
  // space couvrent tout le viewport sans avoir besoin d'un quad ni d'un
  // tampon d'indices — la moitié du triangle est coupée par le clipping,
  // c'est voulu.
  const buffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const aPosition = gl.getAttribLocation(program, 'aPosition')
  gl.enableVertexAttribArray(aPosition)
  gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0)

  const uTime = gl.getUniformLocation(program, 'uTime')
  const uColor = gl.getUniformLocation(program, 'uColor')
  const uSpeed = gl.getUniformLocation(program, 'uSpeed')
  const uScale = gl.getUniformLocation(program, 'uScale')
  const uRotation = gl.getUniformLocation(program, 'uRotation')
  const uNoiseIntensity = gl.getUniformLocation(program, 'uNoiseIntensity')

  gl.uniform1f(uSpeed, speed)
  gl.uniform1f(uScale, scale)
  gl.uniform1f(uRotation, rotation)
  gl.uniform1f(uNoiseIntensity, noiseIntensity)

  function applyColor(): void {
    const [r, g, b] = readColor(colorToken)
    gl.uniform3f(uColor, r, g, b)
  }
  applyColor()

  function resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const width = Math.max(1, Math.round(host.clientWidth * dpr))
    const height = Math.max(1, Math.round(host.clientHeight * dpr))
    if (canvas.width === width && canvas.height === height) return
    canvas.width = width
    canvas.height = height
    gl.viewport(0, 0, width, height)
  }
  resize()

  const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  const colorSchemeQuery = window.matchMedia('(prefers-color-scheme: dark)')

  function draw(time: number): void {
    if (Number.isFinite(time)) gl.uniform1f(uTime, time)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  let raf = 0
  let last = 0
  let clock = 0
  let visible = true
  const stopWatchingVisibility = watchVisibility(host, (v) => {
    visible = v
  })

  function frame(now: number): void {
    raf = requestAnimationFrame(frame)
    if (!last) last = now
    const dt = (now - last) / 1000
    last = now
    if (!visible || document.hidden || !Number.isFinite(dt) || dt < 0) return
    clock += 0.1 * dt
    draw(clock)
  }

  const canAnimate =
    !reducedMotionQuery.matches && speed > 0 && typeof requestAnimationFrame === 'function'

  draw(0)
  if (canAnimate) raf = requestAnimationFrame(frame)

  const onColorSchemeChange = () => applyColor()
  colorSchemeQuery.addEventListener('change', onColorSchemeChange)

  const themeObserver = new MutationObserver(applyColor)
  themeObserver.observe(document.documentElement, { attributeFilter: ['data-theme'] })

  const onResize = () => {
    resize()
    if (!canAnimate) draw(clock)
  }
  window.addEventListener('resize', onResize)

  return () => {
    if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf)
    window.removeEventListener('resize', onResize)
    colorSchemeQuery.removeEventListener('change', onColorSchemeChange)
    themeObserver.disconnect()
    stopWatchingVisibility()
    if (canvas.parentElement) canvas.parentElement.removeChild(canvas)
  }
}
