import { getDb } from './db'
import {
  publicName,
  requirePassphrase,
  requireSecretName,
  requireSecretPurpose,
  requireSecretValue,
  type SealedValue,
  type SecretName,
  type SecretRef,
} from '../domain/secret'

const ITERATIONS = 600_000
const SALT_BYTES = 16
const IV_BYTES = 12

export class VaultUnavailableError extends Error {
  constructor() {
    super(
      'This browser does not expose Web Crypto on this page, so a value cannot be sealed. ' +
        'Serve the page over HTTPS or from localhost.',
    )
    this.name = 'VaultUnavailableError'
  }
}

export class DuplicateSecretNameError extends Error {
  readonly credentialName: string

  constructor(name: string) {
    super(
      `This task already has a credential named ${name}. ` +
        'The agent only ever sees the name, so two of them would make ${' +
        name +
        '} ambiguous. Rename one, or delete the old one first.',
    )
    this.name = 'DuplicateSecretNameError'
    this.credentialName = name
  }
}

export class WrongPassphraseError extends Error {
  constructor() {
    super('That passphrase does not open this value.')
    this.name = 'WrongPassphraseError'
  }
}

function subtle(): SubtleCrypto {
  const c = globalThis.crypto
  if (!c || !c.subtle) throw new VaultUnavailableError()
  return c.subtle
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  globalThis.crypto.getRandomValues(bytes)
  return bytes
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const material = await subtle().importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return subtle().deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function seal(value: string, passphrase: string): Promise<SealedValue> {
  const salt = randomBytes(SALT_BYTES)
  const iv = randomBytes(IV_BYTES)
  const key = await deriveKey(passphrase, salt, ITERATIONS)
  const ciphertext = await subtle().encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(value),
  )
  return {
    ciphertext: toBase64(new Uint8Array(ciphertext)),
    iv: toBase64(iv),
    salt: toBase64(salt),
    iterations: ITERATIONS,
  }
}

export async function unseal(sealed: SealedValue, passphrase: string): Promise<string> {
  const key = await deriveKey(passphrase, fromBase64(sealed.salt), sealed.iterations)
  try {
    const plain = await subtle().decrypt(
      { name: 'AES-GCM', iv: fromBase64(sealed.iv) as BufferSource },
      key,
      fromBase64(sealed.ciphertext) as BufferSource,
    )
    return new TextDecoder().decode(plain)
  } catch {
    throw new WrongPassphraseError()
  }
}

let counter = 0

function newId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  counter += 1
  return `secret-${Date.now().toString(36)}-${counter.toString(36)}`
}

export async function addSecret(input: {
  taskId: string
  name: unknown
  purpose: unknown
  value: unknown
  passphrase: unknown
}): Promise<SecretName> {
  const name = requireSecretName(input.name)
  const purpose = requireSecretPurpose(input.purpose)
  const value = requireSecretValue(input.value)
  const passphrase = requirePassphrase(input.passphrase)

  const db = await getDb()
  const existing = await db.getAllFromIndex('secrets', 'by-taskId', input.taskId)
  if (existing.some((ref) => ref.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    throw new DuplicateSecretNameError(name)
  }

  const ref: SecretRef = {
    id: newId(),
    taskId: input.taskId,
    name,
    purpose,
    sealed: await seal(value, passphrase),
    at: Date.now(),
  }

  await db.put('secrets', ref)
  return publicName(ref)
}

export async function editSecret(
  id: string,
  input: { name: unknown; purpose: unknown },
): Promise<SecretName> {
  const name = requireSecretName(input.name)
  const purpose = requireSecretPurpose(input.purpose)

  const db = await getDb()
  const ref = await db.get('secrets', id)
  if (!ref) throw new Error('No such credential on this device.')

  const siblings = await db.getAllFromIndex('secrets', 'by-taskId', ref.taskId)
  const clash = siblings.some(
    (other) => other.id !== id && other.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
  )
  if (clash) throw new DuplicateSecretNameError(name)

  const next: SecretRef = { ...ref, name, purpose }
  await db.put('secrets', next)
  return publicName(next)
}

export async function listSecretNames(taskId: string): Promise<SecretName[]> {
  const db = await getDb()
  const all = await db.getAllFromIndex('secrets', 'by-taskId', taskId)
  return all.map(publicName).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

export async function revealSecret(id: string, passphrase: unknown): Promise<string> {
  const phrase = requirePassphrase(passphrase)
  const db = await getDb()
  const ref = await db.get('secrets', id)
  if (!ref) throw new Error('No such credential on this device.')
  return unseal(ref.sealed, phrase)
}

export async function deleteSecret(id: string): Promise<void> {
  const db = await getDb()
  await db.delete('secrets', id)
}

export async function deleteSecretsForTask(taskId: string): Promise<void> {
  const db = await getDb()
  const tx = db.transaction('secrets', 'readwrite')
  const index = tx.store.index('by-taskId')
  for (const ref of await index.getAll(taskId)) await tx.store.delete(ref.id)
  await tx.done
}
