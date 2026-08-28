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

describe('scellement', () => {
  it('ne laisse pas la valeur en clair dans ce qui est conservé', async () => {
    const sealed = await seal('AIzaSyD-secret-value-0123456789', 'correct horse battery')

    const serialised = JSON.stringify(sealed)
    expect(serialised).not.toContain('AIzaSyD-secret-value-0123456789')
    expect(serialised).not.toContain('correct horse battery')
    expect(sealed.iterations).toBeGreaterThanOrEqual(600_000)
  })

  it('rend la valeur d’origine avec la bonne phrase', async () => {
    const sealed = await seal('AIzaSyD-secret-value-0123456789', 'correct horse battery')
    expect(await unseal(sealed, 'correct horse battery')).toBe('AIzaSyD-secret-value-0123456789')
  })

  it('refuse une phrase erronée plutôt que de rendre du charabia', async () => {
    const sealed = await seal('AIzaSyD-secret-value', 'correct horse battery')
    await expect(unseal(sealed, 'wrong horse battery')).rejects.toBeInstanceOf(WrongPassphraseError)
  })

  it('tire un sel et un vecteur neufs à chaque scellement', async () => {
    const a = await seal('same value', 'same passphrase')
    const b = await seal('same value', 'same passphrase')

    expect(a.salt).not.toBe(b.salt)
    expect(a.iv).not.toBe(b.iv)
    expect(a.ciphertext).not.toBe(b.ciphertext)
  })

  it('supporte une valeur non ASCII sans la corrompre', async () => {
    const value = 'clé-secrète-🔐-Ω'
    expect(await unseal(await seal(value, 'passphrase!'), 'passphrase!')).toBe(value)
  })
})

describe('coffre', () => {
  const task = 'task-abc'

  it('conserve un secret et n’en rend que le nom', async () => {
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

  it('ne rend la valeur qu’avec la phrase, et jamais sans', async () => {
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

  it('sépare les cahiers', async () => {
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

  it('supprime un secret, et tous ceux d’un cahier', async () => {
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

  it('trie par nom, pour que l’agent lise une liste stable', async () => {
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

  it('exige un nom citable tel quel par un agent', async () => {
    for (const name of ['', '   ', 'has space', 'a'.repeat(65), '-leading', 'quote"']) {
      await expect(addSecret({ ...base, name })).rejects.toBeInstanceOf(ValidationError)
    }
    await expect(addSecret({ ...base, name: 'gemini-api-key' })).resolves.toBeTruthy()
  })

  it('exige un usage : un nom seul n’apprend rien à l’agent', async () => {
    await expect(addSecret({ ...base, name: 'k', purpose: '  ' })).rejects.toBeInstanceOf(
      ValidationError,
    )
  })

  it('refuse une valeur vide ou démesurée', async () => {
    await expect(addSecret({ ...base, name: 'k', value: '' })).rejects.toBeInstanceOf(
      ValidationError,
    )
    await expect(
      addSecret({ ...base, name: 'k', value: 'x'.repeat(MAX_SECRET_VALUE_LENGTH + 1) }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('refuse une phrase de passe trop courte', async () => {
    await expect(addSecret({ ...base, name: 'k', passphrase: 'short' })).rejects.toBeInstanceOf(
      ValidationError,
    )
  })
})

describe('syntaxe de référence', () => {
  it('donne à l’agent la forme exacte à écrire', () => {
    expect(referenceSyntax('gemini-api-key')).toBe('${gemini-api-key}')
  })
})

describe('un nom, un identifiant', () => {
  const base = {
    taskId: 'task-unique',
    purpose: 'Gemini calls',
    value: 'AIzaSy-first',
    passphrase: 'correct horse battery',
  }

  it('refuse un second identifiant qui porterait le même nom', async () => {
    await addSecret({ ...base, name: 'gemini-api-key' })

    // ${gemini-api-key} est la seule chose que l'agent reçoit. Deux entrées de
    // ce nom rendent la référence ambiguë : il ne peut plus désigner une valeur.
    await expect(
      addSecret({ ...base, name: 'gemini-api-key', value: 'AIzaSy-second' }),
    ).rejects.toBeInstanceOf(DuplicateSecretNameError)

    expect((await listSecretNames(base.taskId)).length).toBe(1)
  })

  it('compare les noms sans tenir compte de la casse', async () => {
    await addSecret({ ...base, name: 'gemini-api-key' })
    await expect(addSecret({ ...base, name: 'GEMINI-API-KEY' })).rejects.toBeInstanceOf(
      DuplicateSecretNameError,
    )
  })

  it('laisse le même nom vivre dans un autre cahier', async () => {
    await addSecret({ ...base, name: 'gemini-api-key' })
    await addSecret({ ...base, taskId: 'another-task', name: 'gemini-api-key' })
    expect((await listSecretNames('another-task')).length).toBe(1)
  })

  it('dit qu’une phrase est trop courte, pas trop longue', async () => {
    const error = await addSecret({ ...base, name: 'k', passphrase: 'short' }).catch((e) => e)
    expect(error).toBeInstanceOf(ValidationError)
    expect((error as ValidationError).code).toBe('too-short')
  })
})

describe('toute nature de secret, pas seulement une clé d’API', () => {
  const PEM = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDExampleNotReal
b25lIGxpbmUgdHdvIGxpbmUgdGhyZWUgbGluZSBmb3VyIGxpbmUgZml2ZSBsaW5l
-----END PRIVATE KEY-----`

  const base = {
    taskId: 'task-kinds',
    purpose: 'Signs the deploy bundle',
    passphrase: 'correct horse battery',
  }

  it('accepte chaque nature déclarée, et refuse une nature inventée', async () => {
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

  it('conserve une valeur sur plusieurs lignes, octet pour octet', async () => {
    const { id } = await addSecret({
      ...base,
      name: 'deploy-signing-key',
      kind: 'private_key',
      value: PEM,
    })

    // Une clé PEM tronquée à sa première ligne est inutilisable, et rien ne le
    // signalerait avant l'usage.
    expect(await revealSecret(id, base.passphrase)).toBe(PEM)
  })

  it('accepte une valeur bien plus longue qu’une clé d’API', async () => {
    const long = 'x'.repeat(MAX_SECRET_VALUE_LENGTH)
    const { id } = await addSecret({ ...base, name: 'big', kind: 'certificate', value: long })
    expect((await revealSecret(id, base.passphrase)).length).toBe(MAX_SECRET_VALUE_LENGTH)

    await expect(
      addSecret({ ...base, name: 'bigger', kind: 'certificate', value: `${long}x` }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('vaut « other » pour un identifiant scellé avant que les natures existent', async () => {
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

  it('garde la nature quand on corrige le nom ou l’usage', async () => {
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
