import { beforeEach, describe, expect, it } from 'vitest'
import {
  addSecret,
  editSecret,
  DuplicateSecretNameError,
  deleteSecret,
  deleteSecretsForTask,
  listSecretNames,
  revealSecret,
  seal,
  unseal,
  WrongPassphraseError,
} from '../src/persistence/vault'
import { ValidationError } from '../src/domain/errors'
import { MAX_SECRET_VALUE_LENGTH, referenceSyntax, SECRET_KINDS } from '../src/domain/secret'
import { getDb } from '../src/persistence/db'

async function clearVault() {
  const db = await getDb()
  const tx = db.transaction('secrets', 'readwrite')
  await Promise.all([tx.store.clear(), tx.done])
}

beforeEach(clearVault)

describe('sealing', () => {
  it('keeps no plaintext value in what it stores', async () => {
    const sealed = await seal('AIzaSyD-secret-value-0123456789', 'correct horse battery')

    const serialised = JSON.stringify(sealed)
    expect(serialised).not.toContain('AIzaSyD-secret-value-0123456789')
    expect(serialised).not.toContain('correct horse battery')
    expect(sealed.iterations).toBeGreaterThanOrEqual(600_000)
  })

  it('returns the original value with the right passphrase', async () => {
    const sealed = await seal('AIzaSyD-secret-value-0123456789', 'correct horse battery')
    expect(await unseal(sealed, 'correct horse battery')).toBe('AIzaSyD-secret-value-0123456789')
  })

  it('refuses a wrong passphrase rather than returning gibberish', async () => {
    const sealed = await seal('AIzaSyD-secret-value', 'correct horse battery')
    await expect(unseal(sealed, 'wrong horse battery')).rejects.toBeInstanceOf(WrongPassphraseError)
  })

  it('draws a fresh salt and a fresh vector for every sealing', async () => {
    const a = await seal('same value', 'same passphrase')
    const b = await seal('same value', 'same passphrase')

    expect(a.salt).not.toBe(b.salt)
    expect(a.iv).not.toBe(b.iv)
    expect(a.ciphertext).not.toBe(b.ciphertext)
  })

  it('carries a non-ASCII value without corrupting it', async () => {
    const value = 'clé-secrète-🔐-Ω'
    expect(await unseal(await seal(value, 'passphrase!'), 'passphrase!')).toBe(value)
  })
})

describe('vault', () => {
  const task = 'task-abc'

  it('stores a secret and gives back only its name', async () => {
    const created = await addSecret({
      taskId: task,
      name: 'gemini-api-key',
      purpose: 'Calls the Gemini API from the ingestion script',
      value: 'AIzaSyD-real-looking-key-value',
      passphrase: 'correct horse battery',
    })

    expect(created).toEqual({
      id: expect.any(String),
      name: 'gemini-api-key',
      kind: 'other',
      purpose: 'Calls the Gemini API from the ingestion script',
    })
    expect(JSON.stringify(created)).not.toContain('AIzaSyD-real-looking-key-value')

    const listed = await listSecretNames(task)
    expect(listed.map((s) => s.name)).toEqual(['gemini-api-key'])
    expect(JSON.stringify(listed)).not.toContain('AIzaSyD-real-looking-key-value')
  })

  it('gives the value back only with the passphrase, never without', async () => {
    const { id } = await addSecret({
      taskId: task,
      name: 'gemini-api-key',
      purpose: 'Calls the Gemini API',
      value: 'AIzaSyD-real-looking-key-value',
      passphrase: 'correct horse battery',
    })

    await expect(revealSecret(id, 'wrong phrase here')).rejects.toBeInstanceOf(WrongPassphraseError)
    expect(await revealSecret(id, 'correct horse battery')).toBe('AIzaSyD-real-looking-key-value')
  })

  it('keeps notebooks apart', async () => {
    await addSecret({
      taskId: 'task-a',
      name: 'key-a',
      purpose: 'for a',
      value: 'value-a',
      passphrase: 'passphrase-a',
    })
    await addSecret({
      taskId: 'task-b',
      name: 'key-b',
      purpose: 'for b',
      value: 'value-b',
      passphrase: 'passphrase-b',
    })

    expect((await listSecretNames('task-a')).map((s) => s.name)).toEqual(['key-a'])
    expect((await listSecretNames('task-b')).map((s) => s.name)).toEqual(['key-b'])
  })

  it('deletes one secret, and every secret of a notebook', async () => {
    const { id } = await addSecret({
      taskId: task,
      name: 'one',
      purpose: 'p',
      value: 'v',
      passphrase: 'passphrase',
    })
    await addSecret({
      taskId: task,
      name: 'two',
      purpose: 'p',
      value: 'v',
      passphrase: 'passphrase',
    })

    await deleteSecret(id)
    expect((await listSecretNames(task)).map((s) => s.name)).toEqual(['two'])

    await deleteSecretsForTask(task)
    expect(await listSecretNames(task)).toEqual([])
  })

  it('sorts by name, so the agent reads a stable list', async () => {
    for (const name of ['zeta-key', 'alpha-key', 'mid-key']) {
      await addSecret({
        taskId: task,
        name,
        purpose: 'p',
        value: 'v',
        passphrase: 'passphrase',
      })
    }
    expect((await listSecretNames(task)).map((s) => s.name)).toEqual([
      'alpha-key',
      'mid-key',
      'zeta-key',
    ])
  })
})

describe('validation', () => {
  const base = { taskId: 't', purpose: 'p', value: 'v', passphrase: 'passphrase' }

  it('requires a name an agent can quote as it stands', async () => {
    for (const name of ['', '   ', 'has space', 'a'.repeat(65), '-leading', 'quote"']) {
      await expect(addSecret({ ...base, name })).rejects.toBeInstanceOf(ValidationError)
    }
    await expect(addSecret({ ...base, name: 'gemini-api-key' })).resolves.toBeTruthy()
  })

  it('requires a purpose: a name alone teaches the agent nothing', async () => {
    await expect(addSecret({ ...base, name: 'k', purpose: '  ' })).rejects.toBeInstanceOf(
      ValidationError,
    )
  })

  it('refuses an empty or oversized value', async () => {
    await expect(addSecret({ ...base, name: 'k', value: '' })).rejects.toBeInstanceOf(
      ValidationError,
    )
    await expect(
      addSecret({ ...base, name: 'k', value: 'x'.repeat(MAX_SECRET_VALUE_LENGTH + 1) }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('refuses a passphrase that is too short', async () => {
    await expect(addSecret({ ...base, name: 'k', passphrase: 'short' })).rejects.toBeInstanceOf(
      ValidationError,
    )
  })
})

describe('reference syntax', () => {
  it('gives the agent the exact form to write', () => {
    expect(referenceSyntax('gemini-api-key')).toBe('${gemini-api-key}')
  })
})

describe('one name, one credential', () => {
  const base = {
    taskId: 'task-unique',
    purpose: 'Gemini calls',
    value: 'AIzaSy-first',
    passphrase: 'correct horse battery',
  }

  it('refuses a second credential that would carry the same name', async () => {
    await addSecret({ ...base, name: 'gemini-api-key' })

    // ${gemini-api-key} is the only thing the agent receives. Two entries under
    // that name make the reference ambiguous: it can no longer name one value.
    await expect(
      addSecret({ ...base, name: 'gemini-api-key', value: 'AIzaSy-second' }),
    ).rejects.toBeInstanceOf(DuplicateSecretNameError)

    expect((await listSecretNames(base.taskId)).length).toBe(1)
  })

  it('compares names without regard to case', async () => {
    await addSecret({ ...base, name: 'gemini-api-key' })
    await expect(addSecret({ ...base, name: 'GEMINI-API-KEY' })).rejects.toBeInstanceOf(
      DuplicateSecretNameError,
    )
  })

  it('lets the same name live in another notebook', async () => {
    await addSecret({ ...base, name: 'gemini-api-key' })
    await addSecret({ ...base, taskId: 'another-task', name: 'gemini-api-key' })
    expect((await listSecretNames('another-task')).length).toBe(1)
  })

  it('says a passphrase is too short, not too long', async () => {
    const error = await addSecret({ ...base, name: 'k', passphrase: 'short' }).catch((e) => e)
    expect(error).toBeInstanceOf(ValidationError)
    expect((error as ValidationError).code).toBe('too-short')
  })
})

describe('every kind of secret, not only an API key', () => {
  const PEM = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDExampleNotReal
b25lIGxpbmUgdHdvIGxpbmUgdGhyZWUgbGluZSBmb3VyIGxpbmUgZml2ZSBsaW5l
-----END PRIVATE KEY-----`

  const base = {
    taskId: 'task-kinds',
    purpose: 'Signs the deploy bundle',
    passphrase: 'correct horse battery',
  }

  it('accepts every declared kind, and refuses an invented one', async () => {
    for (const kind of SECRET_KINDS) {
      const named = await addSecret({
        ...base,
        taskId: `task-${kind}`,
        name: `key-${kind}`,
        kind,
        value: 'some-value',
      })
      expect(named.kind, kind).toBe(kind)
    }

    await expect(
      addSecret({ ...base, name: 'k', kind: 'nuclear-codes', value: 'x' }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('keeps a multi-line value byte for byte', async () => {
    const { id } = await addSecret({
      ...base,
      name: 'deploy-signing-key',
      kind: 'private_key',
      value: PEM,
    })

    // A PEM key truncated to its first line is unusable, and nothing would
    // report it before use.
    expect(await revealSecret(id, base.passphrase)).toBe(PEM)
  })

  it('accepts a value far longer than an API key', async () => {
    const long = 'x'.repeat(MAX_SECRET_VALUE_LENGTH)
    const { id } = await addSecret({ ...base, name: 'big', kind: 'certificate', value: long })
    expect((await revealSecret(id, base.passphrase)).length).toBe(MAX_SECRET_VALUE_LENGTH)

    await expect(
      addSecret({ ...base, name: 'bigger', kind: 'certificate', value: `${long}x` }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('reads as “other” for a credential sealed before kinds existed', async () => {
    const db = await getDb()
    await db.put('secrets', {
      id: 'legacy-1',
      taskId: 'task-legacy',
      name: 'old-key',
      purpose: 'Sealed before kinds existed',
      sealed: { ciphertext: 'x', iv: 'y', salt: 'z', iterations: 600_000 },
      at: 1,
    } as never)

    const [named] = await listSecretNames('task-legacy')
    expect(named.kind).toBe('other')
  })

  it('keeps the kind when the name or the purpose is corrected', async () => {
    const { id } = await addSecret({
      ...base,
      name: 'webhook',
      kind: 'webhook_url',
      value: 'https://example.test/hook',
    })
    const edited = await editSecret(id, { name: 'slack-webhook', purpose: 'Posts build results' })
    expect(edited.kind).toBe('webhook_url')
  })
})
