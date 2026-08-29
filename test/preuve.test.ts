import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EVIDENCE_KINDS } from '../src/domain/types'
import { evidenceKindLabel, guessEvidenceKind } from '../src/domain/evidence'
import { renderDetail } from '../src/domain/detail'
import * as store from '../src/store/taskStore'
import { __renderNow, mount } from '../src/ui/bench'
import { clearDatabase, waitUntil } from './helpers'

const DIFF = `diff --git a/src/issuer.ts b/src/issuer.ts
--- a/src/issuer.ts
+++ b/src/issuer.ts
@@ -12,7 +12,7 @@
-  const token = sign(payload)
+  const token = sign(payload, { expiresIn: '15m' })`

const REPORT = `Test Files  12 passed (12)
     Tests  148 passed (148)
  Duration  3.41s`

describe('the kind of a piece of evidence', () => {
  it('recognises a diff by its markers', () => {
    expect(guessEvidenceKind(DIFF)).toBe('diff')
    expect(guessEvidenceKind('--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b')).toBe('diff')
  })

  it('recognises a test report', () => {
    expect(guessEvidenceKind(REPORT)).toBe('test_report')
    expect(guessEvidenceKind('PASS  test/domain.test.ts\n  ✓ 40 tests')).toBe('test_report')
  })

  it('recognises an address on its own, not one in the middle of a text', () => {
    expect(guessEvidenceKind('https://github.com/x/y/pull/3')).toBe('url')
    // A command output that contains an address stays a command output.
    expect(guessEvidenceKind('curl https://example.test\n200 OK')).toBe('command_output')
  })

  it('recognises a hash, whatever its usual length', () => {
    expect(guessEvidenceKind('a94a8fe5ccb19ba61c4c0873d391e987982fbbd3')).toBe('hash')
    expect(guessEvidenceKind('9f86d081')).toBe('hash')
    // An eight-letter word is not a hash.
    expect(guessEvidenceKind('deadbeaf zzz')).toBe('command_output')
  })

  it('falls back to command output, never to nothing', () => {
    expect(guessEvidenceKind('')).toBe('command_output')
    expect(guessEvidenceKind('npm run build\nbuilt in 1.2s')).toBe('command_output')
  })

  it('gives every kind a readable name, and forgets none', () => {
    for (const kind of EVIDENCE_KINDS) {
      const label = evidenceKindLabel(kind)
      expect(label, kind).toBeTruthy()
      expect(label, kind).not.toContain('_')
    }
  })
})

describe('recording a step by hand', () => {
  let root: HTMLElement
  let unmount: () => void

  async function settled(turns = 6) {
    for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0))
    __renderNow()
  }

  async function recorded(before: number) {
    await waitUntil(
      () => (store.currentTask()?.steps.length ?? 0) > before,
      'l’étape à être écrite',
    )
    __renderNow()
  }

  function fill(id: string, value: string) {
    const field = root.querySelector<HTMLInputElement>(`#${id}`)!
    field.value = value
    field.dispatchEvent(new Event('input', { bubbles: true }))
  }

  beforeEach(async () => {
    store.__resetStore()
    await clearDatabase()
    await store.init()
    document.body.innerHTML = '<div id="annonces"></div><div id="app"></div>'
    root = document.querySelector<HTMLElement>('#app')!
    unmount = mount(root)
    await store.createAndOpenTask('Ship the issuer', 'Read the spec')
    await settled()
    root.querySelector<HTMLButtonElement>('#log-step')!.click()
    await settled()
  })

  afterEach(() => {
    unmount()
    history.replaceState(null, '', '/')
  })

  /**
   * Pasted evidence leaves with every export and every shareable link, and a
   * command output readily carries a token. The field says so where you paste,
   * not in a help page.
   */
  it('says, at the moment of pasting, where the evidence will travel', () => {
    const champ = root.querySelector('#step-evidence')!
    const note = champ.parentElement!.textContent!.replace(/\s+/g, ' ')

    expect(note).toContain('Kept exactly as pasted')
    expect(note).toContain('travels with every export and shared link')
  })

  it('takes in a piece of evidence spanning several lines', async () => {
    // An <input type="text"> flattens line breaks: a command output or a pasted
    // diff arrived there on a single line, unreadable for the human as for the
    // agent that reads it back afterwards.
    const field = root.querySelector('#step-evidence')!
    expect(field.tagName).toBe('TEXTAREA')

    fill('step-action', 'Rewrote the issuer')
    fill('step-result', 'API unchanged')
    fill('step-evidence', DIFF)
    const before = store.currentTask()!.steps.length
    root.querySelector<HTMLFormElement>('#form-step')!.requestSubmit()
    await recorded(before)

    const step = store.currentTask()!.steps.at(-1)!
    expect(step.evidence!.content).toContain('\n')
    expect(step.evidence!.content.split('\n').length).toBe(DIFF.split('\n').length)
  })

  it('lets the human name the kind of their evidence', async () => {
    const select = root.querySelector<HTMLSelectElement>('#step-kind')!
    expect([...select.options].map((o) => o.value)).toEqual([...EVIDENCE_KINDS])

    fill('step-action', 'Rewrote the issuer')
    fill('step-result', 'API unchanged')
    fill('step-evidence', DIFF)
    select.value = 'url'
    select.dispatchEvent(new Event('input', { bubbles: true }))
    const before = store.currentTask()!.steps.length
    root.querySelector<HTMLFormElement>('#form-step')!.requestSubmit()
    await recorded(before)

    expect(store.currentTask()!.steps.at(-1)!.evidence!.kind).toBe('url')
  })

  it('offers the guessed kind until the human has chosen', async () => {
    fill('step-evidence', DIFF)
    expect(root.querySelector<HTMLSelectElement>('#step-kind')!.value).toBe('diff')

    fill('step-evidence', REPORT)
    expect(root.querySelector<HTMLSelectElement>('#step-kind')!.value).toBe('test_report')
  })

  it('no longer overwrites the kind once the human has chosen it', async () => {
    const select = root.querySelector<HTMLSelectElement>('#step-kind')!
    select.value = 'command_output'
    select.dispatchEvent(new Event('input', { bubbles: true }))

    fill('step-evidence', DIFF)
    expect(select.value).toBe('command_output')
  })

  it('no longer labels a diff as command output in what the agent reads', async () => {
    fill('step-action', 'Rewrote the issuer')
    fill('step-result', 'API unchanged')
    fill('step-evidence', DIFF)
    const before = store.currentTask()!.steps.length
    root.querySelector<HTMLFormElement>('#form-step')!.requestSubmit()
    await recorded(before)

    // This is the point that counts: read_task_detail announced "command_output"
    // for a diff, so the product lied to the agent about the kind of evidence it holds.
    const rendered = renderDetail(store.currentTask()!, {
      section: 'steps',
      offset: 0,
      limit: 5,
      id: null,
    })
    expect(rendered).toContain('evidence kind: diff')
    expect(rendered).not.toContain('evidence kind: command_output')
  })
})
