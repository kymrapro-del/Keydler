import { normalizeTask } from '../persistence/normalize'
import type { TaskState } from '../domain/types'

export const FRAGMENT_KEY = 'log='

/**
 * Une adresse trop longue est tronquée en silence par des messageries et des
 * terminaux. Mieux vaut refuser clairement et renvoyer vers l'export en
 * fichier, qui n'a pas de limite.
 */
export const MAX_LINK_LENGTH = 12_000

const SAFE = /^[A-Za-z0-9_-]+$/

export class TooLargeForLinkError extends Error {
  constructor(length: number) {
    super(
      `This watch log needs ${length} characters and a link holds ${MAX_LINK_LENGTH}. ` +
        'Use “Export this task” and send the file instead — it has no limit.',
    )
    this.name = 'TooLargeForLinkError'
  }
}

export class UnreadableLinkError extends Error {
  constructor() {
    super('That link does not carry a readable watch log. Ask for a fresh one.')
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

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let total = 0
  const reader = stream.getReader()

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.length
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
  void streamOf(bytes).pipeTo(transform.writable as WritableStream<Uint8Array>)
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
  return collect(through(bytes, gunzip))
}

export async function packTask(task: TaskState): Promise<string> {
  const raw = bytesOf(JSON.stringify(task))
  const { bytes, gzipped } = await squeeze(raw)
  const packed = `${gzipped ? 'z' : 'p'}${toBase64Url(bytes)}`
  if (packed.length > MAX_LINK_LENGTH) throw new TooLargeForLinkError(packed.length)
  return packed
}

export async function unpackTask(packed: string): Promise<TaskState> {
  if (!SAFE.test(packed) || packed.length < 2) throw new UnreadableLinkError()

  const marker = packed[0]
  if (marker !== 'z' && marker !== 'p') throw new UnreadableLinkError()

  let json: string
  try {
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
