import { describe, expect, it } from 'vitest'
import { buildDemoTask } from '../src/demo/seed'
import {
  isSealedLink,
  MAX_LINK_LENGTH,
  packSealedTask,
  packTask,
  unpackTask,
  unsealTask,
  UnreadableLinkError,
} from '../src/export/link'
import { WrongPassphraseError } from '../src/persistence/vault'

const PHRASE = 'the passphrase I gave you over the phone'

// A URL fragment is a bearer capability: checking an identity would need a
// server, demanding knowledge of a secret does not. That is not the same thing,
// and these tests say which of the two is held.
describe('a link a passphrase protects', () => {
  it('reopens with the right passphrase, and returns the task intact', async () => {
    const task = buildDemoTask()
    const packed = await packSealedTask(task, PHRASE)

    expect(isSealedLink(packed)).toBe(true)
    const reread = await unsealTask(packed, PHRASE)
    expect(reread.id).toBe(task.id)
    expect(reread.title).toBe(task.title)
    expect(reread.steps.map((s) => s.action)).toEqual(task.steps.map((s) => s.action))
    expect(reread.constraints.map((c) => c.rule)).toEqual(task.constraints.map((c) => c.rule))
  })

  it('refuses a wrong passphrase, and says so as a wrong passphrase', async () => {
    // Not "this link is unreadable": someone who has just typed a passphrase
    // has to know that the passphrase is at fault, not the link.
    const packed = await packSealedTask(buildDemoTask(), PHRASE)
    await expect(unsealTask(packed, 'definitely not the right passphrase')).rejects.toBeInstanceOf(
      WrongPassphraseError,
    )
  })

  it('leaves nothing readable in the link', async () => {
    const task = buildDemoTask()
    const packed = await packSealedTask(task, PHRASE)

    // The title, a rule and a step: nothing must show through, neither in the
    // clear nor as base64 of the clear.
    for (const secret of [task.title, task.constraints[0].rule, task.steps[0].action, task.id]) {
      expect(packed, secret).not.toContain(secret)
      expect(packed, `${secret} (base64)`).not.toContain(
        btoa(secret).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
      )
    }
  })

  it('produces a different link every time, on the same task', async () => {
    // Salt and IV drawn at random: two identical links would reveal that they
    // carry the same log, to anyone who saw both go by.
    const task = buildDemoTask()
    const plain = await packSealedTask(task, PHRASE)
    const secondLink = await packSealedTask(task, PHRASE)
    expect(plain).not.toBe(secondLink)
  })

  it('stays under the length bound, and says so when it goes over', async () => {
    const packed = await packSealedTask(buildDemoTask(), PHRASE)
    expect(packed.length).toBeLessThanOrEqual(MAX_LINK_LENGTH)

    // Content that does not compress: 60,000 "x" fit in a few hundred bytes
    // once gzipped, and would pass the bound.
    const bruit = Array.from(
      { length: 4000 },
      (_, i) => `${i}-${Math.abs(Math.sin(i) * 1e15).toString(36)}`,
    ).join(' ')
    const huge = { ...buildDemoTask(), title: bruit }
    await expect(packSealedTask(huge, PHRASE)).rejects.toThrow(/Export this task/)
  })

  it('refuses an empty passphrase rather than sealing with nothing', async () => {
    await expect(packSealedTask(buildDemoTask(), '   ')).rejects.toThrow()
  })
})

describe('the two kinds of link are never confused', () => {
  it('recognises an ordinary link as unprotected', async () => {
    const packed = await packTask(buildDemoTask())
    expect(isSealedLink(packed)).toBe(false)
    expect((await unpackTask(packed)).title).toBe(buildDemoTask().title)
  })

  it('refuses to unseal a link that is not sealed', async () => {
    const packed = await packTask(buildDemoTask())
    await expect(unsealTask(packed, PHRASE)).rejects.toBeInstanceOf(UnreadableLinkError)
  })

  it('refuses to open a sealed link by the ordinary path', async () => {
    // Without this the recipient would see "unreadable link" where they should
    // be asked for a passphrase.
    const packed = await packSealedTask(buildDemoTask(), PHRASE)
    await expect(unpackTask(packed)).rejects.toBeInstanceOf(UnreadableLinkError)
  })

  it('refuses a sealed link that is truncated or tampered with', async () => {
    const packed = await packSealedTask(buildDemoTask(), PHRASE)
    await expect(unsealTask(packed.slice(0, packed.length - 40), PHRASE)).rejects.toThrow()
    await expect(unsealTask('s' + 'A'.repeat(200), PHRASE)).rejects.toBeInstanceOf(
      UnreadableLinkError,
    )
  })
})
