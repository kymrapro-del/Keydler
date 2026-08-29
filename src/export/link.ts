import { normalizeTask } from '../persistence/normalize'
import { seal, unseal } from '../persistence/vault'
import { requirePassphrase, type SealedValue } from '../domain/secret'
import type { TaskState } from '../domain/types'

export const FRAGMENT_KEY = 'log='

/**
 * Mail clients and terminals truncate an over-long address silently, so refuse
 * and point at the file export instead. The bound lets an ordinary log through
 * without CompressionStream, or the fallback would be useless.
 */
export const MAX_LINK_LENGTH = 16_000

const SAFE = /^[A-Za-z0-9_-]+$/

export class TooLargeForLinkError extends Error {
  constructor(length: number) {
    super(
      `This log needs ${length} characters and a link holds ${MAX_LINK_LENGTH}. ` +
        'Use “Export this task” and send the file instead, which has no limit.',
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
 * The link is opened by the victim, so bounding the input protects nothing:
 * gzip turns a few kilobytes into megabytes. The output is bounded, and stopped
 * as soon as it goes over.
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
      // The stream may already be errored: cancelling must not add an uncaught
      // rejection on top of the refusal being returned.
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
  // Cancelling the read makes this `pipeTo` fail. Without this `catch`, every
  // refused link would leave an uncaught rejection in the browser console.
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
 * A URL fragment is a bearer capability. With no server the most this can do is
 * demand a secret, not authenticate; a link left in a thread is then a useless
 * block of ciphertext. The vault's own crypto, nothing new: AES-GCM 256,
 * PBKDF2-SHA256 at 600,000 iterations, after compression, since ciphertext does
 * not compress.
 */
export const SEALED_MARKER = 's'

export async function packSealedTask(task: TaskState, passphrase: string): Promise<string> {
  const plainHttp = await packTask(task, { unbounded: true })
  const sealed = await seal(plainHttp, requirePassphrase(passphrase))
  const packed = `${SEALED_MARKER}${toBase64Url(bytesOf(JSON.stringify(sealed)))}`
  if (packed.length > MAX_LINK_LENGTH) throw new TooLargeForLinkError(packed.length)
  return packed
}

export function isSealedLink(packed: string): boolean {
  return packed.startsWith(SEALED_MARKER)
}

/**
 * Kept apart from `unpackTask`: the recipient has to know that a passphrase is
 * expected before being asked for one.
 */
export async function unsealTask(packed: string, passphrase: string): Promise<TaskState> {
  if (!isSealedLink(packed)) throw new UnreadableLinkError()
  if (packed.length > MAX_LINK_LENGTH) throw new UnreadableLinkError()
  if (!SAFE.test(packed)) throw new UnreadableLinkError()

  let sealed: SealedValue
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
    sealed = lu as SealedValue
  } catch {
    throw new UnreadableLinkError()
  }

  // `unseal` throws `WrongPassphraseError`, which travels up as it is: "wrong
  // passphrase" and "unreadable link" are not the same thing to say.
  const plainHttp = await unseal(sealed, requirePassphrase(passphrase))
  return unpackTask(plainHttp)
}

export async function packTask(task: TaskState): Promise<string>
export async function packTask(task: TaskState, options: { unbounded: boolean }): Promise<string>
export async function packTask(task: TaskState, options?: { unbounded: boolean }): Promise<string> {
  const raw = bytesOf(JSON.stringify(task))
  const { bytes, gzipped } = await squeeze(raw)
  const packed = `${gzipped ? 'z' : 'p'}${toBase64Url(bytes)}`
  // A sealed link measures its own length after encryption; bounding here as
  // well would refuse logs that do fit, on a count that is not the right one.
  if (!options?.unbounded && packed.length > MAX_LINK_LENGTH) {
    throw new TooLargeForLinkError(packed.length)
  }
  return packed
}

export async function unpackTask(packed: string): Promise<TaskState> {
  // The bound was only checked when the link was produced, and nothing forces a
  // received link through that path. Accept only what this can produce.
  if (packed.length > MAX_LINK_LENGTH) throw new UnreadableLinkError()
  if (!SAFE.test(packed) || packed.length < 2) throw new UnreadableLinkError()

  const marker = packed[0]
  if (marker !== 'z' && marker !== 'p') throw new UnreadableLinkError()

  let json: string
  try {
    // No second bound here: the fragment length already caps the uncompressed
    // fallback at a few kilobytes. Only decompression can inflate the payload,
    // and that is where it is bounded.
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
