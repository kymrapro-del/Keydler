import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildCoreTask as buildDemoTask } from '../src/demo/seed'
import {
  disputeStep,
  disputedSteps,
  evidenceCounts,
  provenStepCount,
  undoLastSupervision,
  undoable,
  verifyEvidence,
} from '../src/domain/task'
import { renderTaskState, TOKEN_BUDGET, estimateTokens } from '../src/domain/render'
import { renderDetail } from '../src/domain/detail'
import { renderChanges } from '../src/domain/changes'
import { searchTask } from '../src/domain/search'
import { describeEntry } from '../src/ui/history'
import { ValidationError } from '../src/domain/errors'
import * as store from '../src/store/taskStore'
import { __renderNow, mount } from '../src/ui/bench'
import { clearDatabase, waitUntil } from './helpers'
import type { TaskState } from '../src/domain/types'

let task: TaskState

beforeEach(() => {
  task = buildDemoTask()
})

const claimed = (s: TaskState) => s.steps.find((x) => x.confidence === 'claimed')!

function disputed(): TaskState {
  return disputeStep(
    task,
    claimed(task).id,
    'The prototype was never deployed, so nothing could have been measured.',
  )
}

describe('contester une étape', () => {
  it('marque l’étape, avec le motif de l’humain', () => {
    const next = disputed()
    const step = next.steps.find((s) => s.id === claimed(task).id)!

    expect(step.confidence).toBe('disputed')
    expect(step.dispute!.reason).toContain('never deployed')
    expect(step.dispute!.at).toBeTypeOf('number')
    expect(disputedSteps(next)).toHaveLength(1)
    expect(next.audit.at(-1)).toMatchObject({ operation: 'dispute_step', actor: 'human' })
  })

  it('exige un motif : « c’est faux » sans raison n’aide personne', () => {
    expect(() => disputeStep(task, claimed(task).id, '   ')).toThrow(ValidationError)
  })

  it('refuse une étape inconnue', () => {
    expect(() => disputeStep(task, 'nope', 'a reason')).toThrow(ValidationError)
  })

  it('refuse de contester deux fois', () => {
    const once = disputed()
    expect(() => disputeStep(once, claimed(task).id, 'again')).toThrow(ValidationError)
  })

  it('conteste aussi une étape que l’on avait validée soi-même', () => {
    const step = task.steps.find((s) => s.evidence !== null)!
    const verified = verifyEvidence(task, step.id, step.evidence!.content)
    expect(verified.steps.find((s) => s.id === step.id)!.confidence).toBe('human_verified')

    // On peut s'être trompé en validant : c'est précisément ce qu'il faut
    // pouvoir corriger.
    const next = disputeStep(verified, step.id, 'I read the wrong run.')
    expect(next.steps.find((s) => s.id === step.id)!.confidence).toBe('disputed')
  })

  it('ne compte plus une étape contestée comme prouvée', () => {
    const withEvidence = task.steps.find((s) => s.confidence === 'evidence')!
    const before = provenStepCount(task)
    const next = disputeStep(task, withEvidence.id, 'The output came from another branch.')

    expect(provenStepCount(next)).toBe(before - 1)
    expect(evidenceCounts(next).disputed).toBe(1)
  })

  it('s’annule, et l’étape retrouve exactement le degré qu’elle avait', () => {
    const withEvidence = task.steps.find((s) => s.confidence === 'evidence')!
    const next = disputeStep(task, withEvidence.id, 'Wrong branch.')
    expect(undoable(next)).toContain('disputed')

    const back = undoLastSupervision(next)
    const step = back.steps.find((s) => s.id === withEvidence.id)!
    expect(step.confidence).toBe('evidence')
    expect(step.dispute).toBeNull()
  })

  it('rend une étape sans preuve à « claimed » quand on annule', () => {
    const back = undoLastSupervision(disputed())
    expect(back.steps.find((s) => s.id === claimed(task).id)!.confidence).toBe('claimed')
  })
})

describe('ce que les autres surfaces en disent', () => {
  it('met la contestation en tête de ce que lit l’agent, avec son motif', () => {
    const rendered = renderTaskState(disputed())
    expect(rendered).toContain('DISPUTED BY THE HUMAN')
    expect(rendered).toContain('never deployed')
    expect(rendered.indexOf('DISPUTED BY THE HUMAN')).toBeLessThan(rendered.indexOf('RECENT WORK'))
    expect(estimateTokens(rendered)).toBeLessThanOrEqual(TOKEN_BUDGET)
  })

  it('n’invente rien quand rien n’est contesté', () => {
    expect(renderTaskState(task)).not.toContain('DISPUTED BY THE HUMAN')
  })

  it('porte le motif dans le détail de l’étape', () => {
    const rendered = renderDetail(disputed(), {
      section: 'steps',
      offset: 0,
      limit: 20,
      id: null,
    })
    expect(rendered).toContain('disputed')
    expect(rendered).toContain('never deployed')
  })

  it('compte comme un changement qui engage l’agent', () => {
    const rendered = renderChanges(disputed(), task.version)
    expect(rendered).toContain('CHANGES WHAT YOU MAY DO')
    expect(rendered).not.toContain('dispute_step')
  })

  it('se retrouve par la recherche, par le motif', () => {
    const hits = searchTask(disputed(), 'never deployed')
    expect(hits.length).toBeGreaterThan(0)
  })

  it('se lit en phrase dans l’historique', () => {
    const line = describeEntry({
      id: 'e1',
      operation: 'dispute_step',
      actor: 'human',
      versionBefore: 4,
      versionAfter: 5,
      basedOnVersion: null,
      outcome: 'applied',
      detail: 'Reduced token TTL',
      at: 1,
    })
    expect(line.what).not.toContain('dispute_step')
    expect(line.what).toContain('disputed')
  })
})

describe('contester depuis la page', () => {
  let root: HTMLElement
  let unmount: () => void

  async function settled(turns = 8) {
    for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0))
    __renderNow()
  }

  async function written(before: number) {
    await waitUntil(() => (store.currentTask()?.version ?? 0) > before, 'l’écriture')
    __renderNow()
  }

  beforeEach(async () => {
    store.__resetStore()
    await clearDatabase()
    await store.init()
    document.body.innerHTML = '<div id="annonces"></div><div id="app"></div>'
    root = document.querySelector<HTMLElement>('#app')!
    unmount = mount(root)
    await store.openPreparedTask(buildDemoTask())
    await settled()
  })

  afterEach(() => {
    unmount()
    history.replaceState(null, '', '/')
  })

  it('propose de contester chaque étape que vous n’avez pas validée', () => {
    const id = claimed(store.currentTask()!).id
    expect(root.querySelector(`[data-dispute="${id}"]`)).not.toBeNull()
  })

  it('demande un motif, et refuse de contester sans', async () => {
    const id = claimed(store.currentTask()!).id
    root.querySelector<HTMLButtonElement>(`[data-dispute="${id}"]`)!.click()
    __renderNow()

    const field = root.querySelector<HTMLTextAreaElement>('#dispute-reason')!
    expect(field).not.toBeNull()
    field.value = '   '
    field.dispatchEvent(new Event('input', { bubbles: true }))
    root.querySelector<HTMLFormElement>('#form-dispute')!.requestSubmit()
    await settled()

    expect(disputedSteps(store.currentTask()!)).toHaveLength(0)
  })

  it('offre les deux issues là où la preuve est sous les yeux', async () => {
    const card = [...root.querySelectorAll('.card')].find((c) =>
      c.querySelector('h2')?.textContent?.includes('Evidence to review'),
    )!
    expect(card).toBeDefined()

    // Lire une preuve et ne pouvoir que l'approuver, c'est un formulaire à une
    // seule issue : le refus doit être au même endroit que l'accord.
    expect(card.querySelector('[data-verify]')).not.toBeNull()
    expect(card.querySelector('[data-dispute]')).not.toBeNull()
  })

  it('retire de la revue une preuve déjà tranchée', async () => {
    const step = store.currentTask()!.steps.find((s) => s.confidence === 'evidence')!
    const before = store.currentTask()!.version
    await store.mutate((s) => disputeStep(s, step.id, 'The output came from another branch.'))
    await written(before)

    const card = [...root.querySelectorAll('.card')].find((c) =>
      c.querySelector('h2')?.textContent?.includes('Evidence to review'),
    )
    expect(card?.querySelector(`[data-verify="${step.id}"]`) ?? null).toBeNull()
  })

  it('marque l’étape, et le motif est à l’écran', async () => {
    const id = claimed(store.currentTask()!).id
    root.querySelector<HTMLButtonElement>(`[data-dispute="${id}"]`)!.click()
    __renderNow()

    const before = store.currentTask()!.version
    const field = root.querySelector<HTMLTextAreaElement>('#dispute-reason')!
    field.value = 'The prototype was never deployed.'
    field.dispatchEvent(new Event('input', { bubbles: true }))
    root.querySelector<HTMLFormElement>('#form-dispute')!.requestSubmit()
    await written(before)

    expect(disputedSteps(store.currentTask()!)).toHaveLength(1)
    expect(root.textContent).toContain('The prototype was never deployed.')
  })
})
