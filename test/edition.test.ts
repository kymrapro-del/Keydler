import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildDemoTask } from '../src/demo/seed'
import { ValidationError } from '../src/domain/errors'
import {
  activeConstraints,
  acceptedRejections,
  createTask,
  editConstraint,
  editRejection,
  renameTask,
} from '../src/domain/task'
import { renderTaskState } from '../src/domain/render'
import * as store from '../src/store/taskStore'
import { __renderNow, mount } from '../src/ui/bench'
import { clearDatabase } from './helpers'

function ctx(seed = 0) {
  let n = seed
  return { now: 1_700_000_000_000, newId: () => `id-${n++}` }
}

describe('corrections humaines, dans le domaine', () => {
  it('renomme la tâche et garde la trace de l’ancien nom', () => {
    const before = createTask({ title: 'Refactor auth', next: 'Map it' }, ctx())
    const after = renameTask(before, 'Refactor the authentication module', ctx(10))

    expect(after.title).toBe('Refactor the authentication module')
    expect(after.version).toBe(before.version + 1)
    expect(after.audit.at(-1)).toMatchObject({ operation: 'rename_task', actor: 'human' })
    expect(after.audit.at(-1)!.detail).toContain('Refactor auth →')
  })

  it('refuse un renommage vide, et un renommage qui ne change rien', () => {
    const task = createTask({ title: 'Same' }, ctx())
    expect(() => renameTask(task, '   ', ctx(10))).toThrow(ValidationError)
    expect(() => renameTask(task, 'Same', ctx(10))).toThrow(ValidationError)
  })

  it('reformule une règle sans toucher à sa force ni à sa source', () => {
    const task = buildDemoTask()
    const rule = activeConstraints(task)[0]
    const after = editConstraint(task, rule.id, 'Never modify the database schema, ever')

    const edited = after.constraints.find((c) => c.id === rule.id)!
    expect(edited.rule).toBe('Never modify the database schema, ever')
    expect(edited.source).toBe(rule.source)
    expect(edited.standing).toBe(rule.standing)
    expect(edited.active).toBe(rule.active)

    // What the agent re-reads follows immediately.
    expect(renderTaskState(after)).toContain('Never modify the database schema, ever')
  })

  it('reformule un rejet, motif compris', () => {
    const task = buildDemoTask()
    const rejection = acceptedRejections(task)[0]
    const after = editRejection(task, rejection.id, {
      approach: 'JWT approach B',
      reason: 'breaks rotation under concurrent logins, measured on 2026-08-14',
    })

    const edited = after.rejected.find((r) => r.id === rejection.id)!
    expect(edited.reason).toContain('measured on 2026-08-14')
    expect(edited.standing).toBe(rejection.standing)
    expect(after.audit.at(-1)).toMatchObject({ operation: 'edit_rejection', actor: 'human' })
  })

  it('exige toujours un motif : reformuler ne permet pas de le vider', () => {
    const task = buildDemoTask()
    const rejection = acceptedRejections(task)[0]
    expect(() =>
      editRejection(task, rejection.id, { approach: 'JWT approach B', reason: '  ' }),
    ).toThrow(ValidationError)
  })

  it('refuse de reformuler ce qui n’existe pas', () => {
    const task = buildDemoTask()
    expect(() => editConstraint(task, 'nope', 'x')).toThrow(ValidationError)
    expect(() => editRejection(task, 'nope', { approach: 'a', reason: 'b' })).toThrow(
      ValidationError,
    )
  })

  it('n’est jamais refusé pour version périmée : l’humain reste autoritaire', () => {
    const task = buildDemoTask()
    const rule = activeConstraints(task)[0]

    // None of these mutations carries a `basedOnVersion`: that is exactly
    // what goes stale on the version the agent works from.
    for (const entry of [
      renameTask(task, 'A new name').audit.at(-1)!,
      editConstraint(task, rule.id, 'A reworded rule').audit.at(-1)!,
    ]) {
      expect(entry.basedOnVersion).toBeNull()
      expect(entry.outcome).toBe('applied')
    }
  })
})

describe('corrections humaines, à l’écran', () => {
  let root: HTMLElement
  let unmount: () => void

  async function settled(turns = 6) {
    for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0))
    __renderNow()
  }

  function type(id: string, value: string) {
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
    await store.openPreparedTask(buildDemoTask())
    await settled()
  })

  afterEach(() => {
    unmount()
    history.replaceState(null, '', '/')
  })

  it('renomme la tâche depuis l’en-tête, sans rechargement', async () => {
    root.querySelector<HTMLButtonElement>('#edit-title')!.click()
    await settled()
    expect(document.activeElement?.id).toBe('edit-value')
    expect(root.querySelector<HTMLInputElement>('#edit-value')!.value).toBe(
      'Refactor the authentication module',
    )

    type('edit-value', 'Rework the auth module')
    root.querySelector<HTMLFormElement>('#edit-form')!.requestSubmit()
    await settled()

    expect(store.currentTask()!.title).toBe('Rework the auth module')
    expect(root.querySelector('h1')!.textContent!.trim()).toBe('Rework the auth module')
  })

  it('change la prochaine action, ce que l’agent relira', async () => {
    root.querySelector<HTMLButtonElement>('#edit-next')!.click()
    await settled()

    type('edit-value', 'Measure rotation against the mobile client first')
    root.querySelector<HTMLFormElement>('#edit-form')!.requestSubmit()
    await settled()

    const task = store.currentTask()!
    expect(task.next).toBe('Measure rotation against the mobile client first')
    expect(renderTaskState(task)).toContain('Measure rotation against the mobile client')
    expect(root.querySelector('.hero__value')!.textContent).toContain('Measure rotation')
  })

  it('reformule une règle sans la lever', async () => {
    const before = activeConstraints(store.currentTask()!).length
    root.querySelector<HTMLButtonElement>('[data-edit-rule]')!.click()
    await settled()

    type('edit-value', 'Never touch the database schema')
    root.querySelector<HTMLFormElement>('#edit-form')!.requestSubmit()
    await settled()

    const rules = activeConstraints(store.currentTask()!)
    expect(rules).toHaveLength(before)
    expect(rules.map((r) => r.rule)).toContain('Never touch the database schema')
  })

  it('reformule un rejet en gardant son motif obligatoire', async () => {
    root.querySelector<HTMLButtonElement>('[data-edit-rejection]')!.click()
    await settled()

    type('edit-reason', '   ')
    root.querySelector<HTMLFormElement>('#edit-form')!.requestSubmit()
    await settled()

    expect(root.querySelector('[role="alert"]')!.textContent).toContain(
      'the reason cannot be empty',
    )
    // Nothing was written: the rejection keeps its reason.
    expect(acceptedRejections(store.currentTask()!)[0].reason).toContain('breaks refresh token')
  })

  it('abandonne une édition sans rien changer', async () => {
    const title = store.currentTask()!.title
    root.querySelector<HTMLButtonElement>('#edit-title')!.click()
    await settled()

    type('edit-value', 'Something else entirely')
    root.querySelector<HTMLButtonElement>('#cancel-edit')!.click()
    await settled()

    expect(store.currentTask()!.title).toBe(title)
    expect(root.querySelector('#edit-form')).toBeNull()
  })

  it('consigne une étape faite à la main, comptée comme vérifiée par vous', async () => {
    const before = store.currentTask()!.steps.length
    root.querySelector<HTMLButtonElement>('#log-step')!.click()
    await settled()
    expect(document.activeElement?.id).toBe('step-action')

    type('step-action', 'Rewrote the issuer by hand')
    type('step-result', 'Public API unchanged')
    type('step-evidence', '$ npm test\n183 passed')
    root.querySelector<HTMLFormElement>('#form-step')!.requestSubmit()
    await settled()

    const steps = store.currentTask()!.steps
    expect(steps).toHaveLength(before + 1)
    const added = steps.at(-1)!
    expect(added.source).toBe('human')
    // Evidence the person produced themselves: they were there.
    expect(added.confidence).toBe('human_verified')
    expect(added.evidence!.content).toContain('183 passed')
    expect(added.evidence!.verifiedAt).not.toBeNull()
  })

  it('consigne une étape sans preuve comme simplement affirmée', async () => {
    root.querySelector<HTMLButtonElement>('#log-step')!.click()
    await settled()

    type('step-action', 'Read the incident report')
    type('step-result', 'scope confirmed')
    root.querySelector<HTMLFormElement>('#form-step')!.requestSubmit()
    await settled()

    expect(store.currentTask()!.steps.at(-1)!.confidence).toBe('claimed')
  })

  it('refuse une étape sans action, en langage humain', async () => {
    const before = store.currentTask()!.steps.length
    root.querySelector<HTMLButtonElement>('#log-step')!.click()
    await settled()

    type('step-result', 'something happened')
    root.querySelector<HTMLFormElement>('#form-step')!.requestSubmit()
    await settled()

    expect(root.querySelector('[role="alert"]')!.textContent).toContain('cannot be empty')
    expect(store.currentTask()!.steps).toHaveLength(before)
  })

  it('inscrit chaque correction dans l’historique, en mots', async () => {
    root.querySelector<HTMLButtonElement>('#edit-title')!.click()
    await settled()
    type('edit-value', 'A different name')
    root.querySelector<HTMLFormElement>('#edit-form')!.requestSubmit()
    await settled()

    const history = [...root.querySelectorAll('.card')].find((c) =>
      c.querySelector('h2')?.textContent?.includes('History'),
    )!
    expect(history.textContent).toContain('renamed the task')
    expect(history.textContent).not.toContain('rename_task')
  })
})
