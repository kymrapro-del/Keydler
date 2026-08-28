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

describe('la nature d’une preuve', () => {
  it('reconnaît un diff à ses marqueurs', () => {
    expect(guessEvidenceKind(DIFF)).toBe('diff')
    expect(guessEvidenceKind('--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b')).toBe('diff')
  })

  it('reconnaît un rapport de tests', () => {
    expect(guessEvidenceKind(REPORT)).toBe('test_report')
    expect(guessEvidenceKind('PASS  test/domain.test.ts\n  ✓ 40 tests')).toBe('test_report')
  })

  it('reconnaît une adresse seule, pas une adresse au milieu d’un texte', () => {
    expect(guessEvidenceKind('https://github.com/x/y/pull/3')).toBe('url')
    // Une sortie de commande qui contient une adresse reste une sortie de commande.
    expect(guessEvidenceKind('curl https://example.test\n200 OK')).toBe('command_output')
  })

  it('reconnaît une empreinte, quelle que soit sa longueur usuelle', () => {
    expect(guessEvidenceKind('a94a8fe5ccb19ba61c4c0873d391e987982fbbd3')).toBe('hash')
    expect(guessEvidenceKind('9f86d081')).toBe('hash')
    // Un mot de huit lettres n'est pas une empreinte.
    expect(guessEvidenceKind('deadbeaf zzz')).toBe('command_output')
  })

  it('retombe sur la sortie de commande, jamais sur rien', () => {
    expect(guessEvidenceKind('')).toBe('command_output')
    expect(guessEvidenceKind('npm run build\nbuilt in 1.2s')).toBe('command_output')
  })

  it('donne un nom lisible à chaque nature, sans en oublier', () => {
    for (const kind of EVIDENCE_KINDS) {
      const label = evidenceKindLabel(kind)
      expect(label, kind).toBeTruthy()
      expect(label, kind).not.toContain('_')
    }
  })
})

describe('consigner une étape à la main', () => {
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
   * Une preuve collée part avec chaque export et chaque lien partageable, et
   * une sortie de commande porte volontiers un jeton. Le champ le dit là où on
   * colle, pas dans une page d'aide.
   */
  it('dit, au moment de coller, où la preuve ira', () => {
    const champ = root.querySelector('#step-evidence')!
    const note = champ.parentElement!.textContent!.replace(/\s+/g, ' ')

    expect(note).toContain('Kept exactly as pasted')
    expect(note).toContain('travels with every export and shared link')
  })

  it('accueille une preuve sur plusieurs lignes', async () => {
    // Un <input type="text"> écrase les retours à la ligne : une sortie de
    // commande ou un diff collé y arrivait sur une seule ligne, illisible pour
    // l'humain comme pour l'agent qui la relit ensuite.
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

  it('laisse l’humain nommer la nature de sa preuve', async () => {
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

  it('propose la nature devinée tant que l’humain n’a pas choisi', async () => {
    fill('step-evidence', DIFF)
    expect(root.querySelector<HTMLSelectElement>('#step-kind')!.value).toBe('diff')

    fill('step-evidence', REPORT)
    expect(root.querySelector<HTMLSelectElement>('#step-kind')!.value).toBe('test_report')
  })

  it('n’écrase plus la nature une fois que l’humain l’a choisie', async () => {
    const select = root.querySelector<HTMLSelectElement>('#step-kind')!
    select.value = 'command_output'
    select.dispatchEvent(new Event('input', { bubbles: true }))

    fill('step-evidence', DIFF)
    expect(select.value).toBe('command_output')
  })

  it('n’étiquette plus un diff en sortie de commande dans ce que lit l’agent', async () => {
    fill('step-action', 'Rewrote the issuer')
    fill('step-result', 'API unchanged')
    fill('step-evidence', DIFF)
    const before = store.currentTask()!.steps.length
    root.querySelector<HTMLFormElement>('#form-step')!.requestSubmit()
    await recorded(before)

    // C'est le point qui compte : read_task_detail annonçait « command_output »
    // pour un diff, donc le produit mentait à l'agent sur la nature d'une preuve.
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
