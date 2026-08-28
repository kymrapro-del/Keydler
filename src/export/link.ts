import { normalizeTask } from '../persistence/normalize'
import { seal, unseal } from '../persistence/vault'
import { requirePassphrase, type SealedValue } from '../domain/secret'
import type { TaskState } from '../domain/types'

export const FRAGMENT_KEY = 'log='

/**
 * Une adresse trop longue est tronquée en silence par des messageries et des
 * terminaux. Mieux vaut refuser clairement et renvoyer vers l'export en
 * fichier, qui n'a pas de limite. La borne laisse passer un cahier ordinaire
 * même sans CompressionStream — sinon le repli ne servirait à rien.
 */
export const MAX_LINK_LENGTH = 16_000

const SAFE = /^[A-Za-z0-9_-]+$/

export class TooLargeForLinkError extends Error {
  constructor(length: number) {
    super(
      `This log needs ${length} characters and a link holds ${MAX_LINK_LENGTH}. ` +
        'Use “Export this task” and send the file instead — it has no limit.',
    )
    this.name = 'TooLargeForLinkError'
  }
}

export class UnreadableLinkError extends Error {
  constructor() {
    super('That link does not carry a readable log. Ask for a fresh one.')
    this.name = 'UnreadableLinkError'
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * Le lien est ouvert par la VICTIME : borner l'entrée ne protège de rien, car
 * gzip laisse quelques kilo-octets devenir plusieurs mégaoctets. C'est la
 * sortie qu'il faut borner, et l'arrêter dès le dépassement plutôt qu'après.
 */
export const MAX_DECOMPRESSED = 2_000_000

async function collect(
  stream: ReadableStream<Uint8Array>,
  limit = Number.POSITIVE_INFINITY,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let total = 0
  const reader = stream.getReader()

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.length
    if (total > limit) {
      // Le flux peut déjà être en erreur : annuler ne doit pas produire un
      // rejet non capté par-dessus le refus que l'on est en train de rendre.
      await reader.cancel().catch(() => undefined)
      throw new UnreadableLinkError()
    }
  }

  const out = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

function bytesOf(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}

type ByteTransform = { readable: ReadableStream<Uint8Array>; writable: WritableStream<unknown> }

function through(bytes: Uint8Array, transform: ByteTransform): ReadableStream<Uint8Array> {
  // Annuler la lecture fait échouer ce `pipeTo`. Sans ce `catch`, chaque lien
  // refusé laisserait un rejet non capté dans la console du navigateur.
  void streamOf(bytes)
    .pipeTo(transform.writable as WritableStream<Uint8Array>)
    .catch(() => undefined)
  return transform.readable
}

async function squeeze(bytes: Uint8Array): Promise<{ bytes: Uint8Array; gzipped: boolean }> {
  if (typeof globalThis.CompressionStream !== 'function') return { bytes, gzipped: false }
  const gz = new CompressionStream('gzip') as unknown as ByteTransform
  return { bytes: await collect(through(bytes, gz)), gzipped: true }
}

async function expand(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof globalThis.DecompressionStream !== 'function') {
    throw new UnreadableLinkError()
  }
  const gunzip = new DecompressionStream('gzip') as unknown as ByteTransform
  return collect(through(bytes, gunzip), MAX_DECOMPRESSED)
}

/**
 * Un lien porte le cahier entier. Personne ne peut savoir qui l'ouvre : un
 * fragment d'URL est une capacité au porteur, et vérifier une identité
 * demanderait un serveur, que ce produit n'a pas et ne veut pas.
 *
 * Ce qui est possible sans serveur, c'est d'exiger la connaissance d'un
 * secret. Ce n'est pas la même chose qu'authentifier quelqu'un, et il ne faut
 * pas le vendre comme tel — mais cela règle la fuite qui compte vraiment : un
 * lien oublié dans un fil de discussion devient un bloc de chiffré inutile.
 *
 * Le chiffrement est celui du coffre, sans une ligne de crypto nouvelle :
 * AES-GCM 256, clé dérivée par PBKDF2-SHA256 à 600 000 itérations, sel et IV
 * tirés au hasard à chaque scellement. On chiffre APRÈS avoir compressé — un
 * chiffré ne se compresse pas.
 */
export const SEALED_MARKER = 's'

export async function packSealedTask(task: TaskState, passphrase: string): Promise<string> {
  const clair = await packTask(task, { unbounded: true })
  const scellé = await seal(clair, requirePassphrase(passphrase))
  const packed = `${SEALED_MARKER}${toBase64Url(bytesOf(JSON.stringify(scellé)))}`
  if (packed.length > MAX_LINK_LENGTH) throw new TooLargeForLinkError(packed.length)
  return packed
}

export function isSealedLink(packed: string): boolean {
  return packed.startsWith(SEALED_MARKER)
}

/**
 * Rendu séparément de `unpackTask` : le destinataire doit d'abord savoir qu'une
 * phrase de passe est attendue, avant qu'on la lui demande.
 */
export async function unsealTask(packed: string, passphrase: string): Promise<TaskState> {
  if (!isSealedLink(packed)) throw new UnreadableLinkError()
  if (packed.length > MAX_LINK_LENGTH) throw new UnreadableLinkError()
  if (!SAFE.test(packed)) throw new UnreadableLinkError()

  let scellé: SealedValue
  try {
    const json = new TextDecoder().decode(fromBase64Url(packed.slice(1)))
    const lu = JSON.parse(json) as Partial<SealedValue>
    if (
      typeof lu?.ciphertext !== 'string' ||
      typeof lu.iv !== 'string' ||
      typeof lu.salt !== 'string' ||
      typeof lu.iterations !== 'number'
    ) {
      throw new UnreadableLinkError()
    }
    scellé = lu as SealedValue
  } catch {
    throw new UnreadableLinkError()
  }

  // `unseal` lève `WrongPassphraseError`, qui doit remonter telle quelle :
  // « la phrase est fausse » et « ce lien est illisible » ne se disent pas
  // pareil à quelqu'un qui vient de taper une phrase.
  const clair = await unseal(scellé, requirePassphrase(passphrase))
  return unpackTask(clair)
}

export async function packTask(task: TaskState): Promise<string>
export async function packTask(task: TaskState, options: { unbounded: boolean }): Promise<string>
export async function packTask(task: TaskState, options?: { unbounded: boolean }): Promise<string> {
  const raw = bytesOf(JSON.stringify(task))
  const { bytes, gzipped } = await squeeze(raw)
  const packed = `${gzipped ? 'z' : 'p'}${toBase64Url(bytes)}`
  // Le lien scellé mesure sa propre longueur APRÈS chiffrement ; borner ici en
  // plus refuserait des cahiers qui tiennent, sur un compte qui n'est pas le
  // bon.
  if (!options?.unbounded && packed.length > MAX_LINK_LENGTH) {
    throw new TooLargeForLinkError(packed.length)
  }
  return packed
}

export async function unpackTask(packed: string): Promise<TaskState> {
  // La borne n'était vérifiée qu'à la PRODUCTION du lien. Rien n'oblige un
  // lien reçu à être passé par là : on n'accepte que ce que l'on sait produire.
  if (packed.length > MAX_LINK_LENGTH) throw new UnreadableLinkError()
  if (!SAFE.test(packed) || packed.length < 2) throw new UnreadableLinkError()

  const marker = packed[0]
  if (marker !== 'z' && marker !== 'p') throw new UnreadableLinkError()

  let json: string
  try {
    // Pas de seconde borne ici : la longueur du fragment plafonne déjà le repli
    // non compressé à quelques kilo-octets. Seule la décompression peut faire
    // gonfler la charge, et c'est là qu'elle est bornée.
    const bytes = fromBase64Url(packed.slice(1))
    const plain = marker === 'z' ? await expand(bytes) : bytes
    json = new TextDecoder().decode(plain)
  } catch {
    throw new UnreadableLinkError()
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new UnreadableLinkError()
  }

  const candidate = parsed as { id?: unknown; title?: unknown; version?: unknown }
  if (
    typeof candidate?.id !== 'string' ||
    candidate.id === '' ||
    typeof candidate.title !== 'string' ||
    typeof candidate.version !== 'number'
  ) {
    throw new UnreadableLinkError()
  }

  const task = normalizeTask(parsed as never)
  if (!task) throw new UnreadableLinkError()
  return task
}

export function readLinkFragment(): string | null {
  if (typeof location === 'undefined') return null
  const hash = location.hash.replace(/^#/, '')
  if (!hash.startsWith(FRAGMENT_KEY)) return null
  const payload = hash.slice(FRAGMENT_KEY.length)
  return SAFE.test(payload) ? payload : null
}

export function linkFor(origin: string, path: string, packed: string): string {
  return `${origin}${path}#${FRAGMENT_KEY}${packed}`
}
