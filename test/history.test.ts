import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import manifestRaw from '../public/manifest.webmanifest?raw'
import indexRaw from '../index.html?raw'
import mainRaw from '../src/main.ts?raw'
import swRaw from '../public/sw.js?raw'
import { buildDemoTask } from '../src/demo/seed'
import { addConstraint, logStep, setConstraintActive, verifyEvidence } from '../src/domain/task'
import type { AuditEntry } from '../src/domain/types'
import { describeEntry, describeHistory } from '../src/ui/history'
import * as store from '../src/store/taskStore'
import { __renderNow, mount } from '../src/ui/bench'
import { clearDatabase, mutationId } from './helpers'

function entry(over: Partial<AuditEntry>): AuditEntry {
  return {
    id: 'e1',
    operation: 'log_step',
    actor: 'agent',
    versionBefore: 4,
    versionAfter: 5,
    basedOnVersion: 4,
    outcome: 'applied',
    detail: 'Ran the tests',
    at: 1_700_000_000_000,
    ...over,
  }
}

describe('the history put into words', () => {
  it('says who did what, with no machine operation name', () => {
    const line = describeEntry(entry({ actor: 'human', operation: 'deactivate_constraint' }))
    expect(line.who).toBe('You')
    expect(line.what).toBe('lifted a rule')
    expect(line.what).not.toContain('deactivate_constraint')
  })

  it('tells a rule SET by the human from a rule PROPOSED by the agent', () => {
    expect(describeEntry(entry({ actor: 'human', operation: 'add_constraint' })).what).toBe(
      'added a rule',
    )
    // That is the whole asymmetry of the product, and it must be readable in
    // the history.
    expect(describeEntry(entry({ actor: 'agent', operation: 'add_constraint' })).what).toBe(
      'proposed a rule',
    )
  })

  it('puts an attempt in the infinitive, not in the past', () => {
    // "tried to recorded a step": the verb table is past tense for what did
    // happen, and a refused attempt precisely did not happen.
    for (const operation of ['log_step', 'add_constraint', 'reject_approach', 'complete_task']) {
      const line = describeEntry(entry({ operation, outcome: 'refused', detail: 'stale write' }))
      expect(line.what, operation).toMatch(/^tried to [a-z]/)
      expect(line.what, operation).not.toMatch(/tried to \w+ed\b/)
    }
    expect(describeEntry(entry({ operation: 'log_step', outcome: 'refused' })).what).toBe(
      'tried to record a step (refused)',
    )
  })

  it('explains a refusal by its cause, not by its code', () => {
    const stale = describeEntry(
      entry({ outcome: 'refused', detail: 'stale write on v4, current v6' }),
    )
    expect(stale.refused).toBe(true)
    expect(stale.what).toContain('refused')
    expect(stale.detail).toBe('the task had changed since it was read')

    expect(
      describeEntry(entry({ outcome: 'refused', detail: 'mutation_id: mutation-id-collision' }))
        .detail,
    ).toBe('the same write id was reused for different work')
    expect(
      describeEntry(entry({ outcome: 'refused', detail: 'cancelled before anything was written' }))
        .detail,
    ).toBe('the call was cancelled before it wrote')
  })

  it('carries over the count of repeated attempts', () => {
    const line = describeEntry(entry({ outcome: 'refused', detail: 'stale write', repeated: 7 }))
    expect(line.repeated).toBe(7)
  })

  it('names the trimming as a fact of the system, not of a person', () => {
    const line = describeEntry(
      entry({ operation: 'audit_trimmed', detail: '40 earlier entries dropped' }),
    )
    expect(line.who).toBe('System')
    expect(line.refused).toBe(false)
  })

  it('never leaves an unknown operation without a sentence', () => {
    const line = describeEntry(entry({ operation: 'some_future_operation', actor: 'human' }))
    expect(line.what).toContain('some_future_operation')
    expect(line.what.length).toBeGreaterThan(5)
  })

  it('returns the most recent first', () => {
    const lines = describeHistory([
      entry({ id: 'a', at: 1 }),
      entry({ id: 'b', at: 2 }),
      entry({ id: 'c', at: 3 }),
    ])
    expect(lines.map((l) => l.at)).toEqual([3, 2, 1])
  })
})

describe('the history on screen', () => {
  let root: HTMLElement
  let unmount: () => void

  async function settled(turns = 6) {
    for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0))
    __renderNow()
  }

  beforeEach(async () => {
    store.__resetStore()
    await clearDatabase()
    await store.init()
    document.body.innerHTML = '<div id="announcements"></div><div id="app"></div>'
    root = document.querySelector<HTMLElement>('#app')!
    unmount = mount(root)
    await store.openPreparedTask(buildDemoTask())
    await settled()
  })

  afterEach(() => {
    unmount()
    history.replaceState(null, '', '/')
  })

  const section = () =>
    [...root.querySelectorAll('.card')].find((c) =>
      c.querySelector('h2')?.textContent?.includes('History'),
    )!

  it('shows the past of the log in human language', async () => {
    expect(section().textContent).toContain('recorded a step')

    // The excerpt shows only the most recent ones; creation is the oldest of
    // the demo task and so does not appear there.
    root.querySelector<HTMLButtonElement>('#toggle-history')!.click()
    await settled()

    const text = section().textContent ?? ''
    expect(text).toContain('created the task')
    expect(text).toContain('added a rule')
    expect(text).toContain('approved evidence')

    // No machine operation name must reach the screen.
    for (const raw of ['log_step', 'add_constraint', 'verify_evidence', 'create_task']) {
      expect(text, raw).not.toContain(raw)
    }
  })

  it('makes a refusal visible in the history, with its cause', async () => {
    const stale = store.currentTask()!.version
    await store.mutate((s) =>
      addConstraint(s, { rule: 'A human rule', basedOnVersion: null }, 'human'),
    )
    await store
      .mutateAsAgent({
        operation: 'log_step',
        basedOnVersion: stale,
        mutationId: mutationId(),
        fingerprint: 'history-fp',
        mutate: (s) => logStep(s, { action: 'a', result: 'b', basedOnVersion: stale }, 'agent'),
        render: (n) => `v${n.version}`,
      })
      .catch(() => undefined)
    await settled()

    const refused = section().querySelector('.event--refused')!
    expect(refused).not.toBeNull()
    expect(refused.textContent).toContain('Agent')
    expect(refused.textContent).toContain('refused')
    expect(refused.textContent).toContain('the task had changed since it was read')
  })

  it('reflects a human action as soon as it happens', async () => {
    const step = store.currentTask()!.steps.find((s) => s.evidence !== null)!
    await store.mutate((s) => verifyEvidence(s, step.id, step.evidence!.content))
    await settled()
    expect(section().textContent).toContain('approved evidence')

    const rule = store.currentTask()!.constraints[0]
    await store.mutate((s) => setConstraintActive(s, rule.id, false))
    await settled()
    expect(section().textContent).toContain('lifted a rule')
  })

  it('shows only an excerpt, and unfolds on request', async () => {
    for (let i = 0; i < 20; i++) {
      await store.mutate((s) =>
        addConstraint(s, { rule: `Rule number ${i}`, basedOnVersion: null }, 'human'),
      )
    }
    await settled()

    const before = section().querySelectorAll('.event').length
    expect(before).toBe(12)

    const toggle = root.querySelector<HTMLButtonElement>('#toggle-history')!
    expect(toggle.textContent).toContain('Show all')
    toggle.click()
    await settled()

    expect(section().querySelectorAll('.event').length).toBeGreaterThan(before)
    expect(root.querySelector('#toggle-history')!.textContent).toContain('Show recent only')
  })
})

describe('installable', () => {
  const manifest = JSON.parse(manifestRaw)
  // The files really present, seen through the module graph, not a hand written
  // list that would stay true after a file has been deleted.
  const shipped = new Set(
    Object.keys(import.meta.glob('../public/icons/*', { eager: true, query: '?url' })).map((p) =>
      p.replace('../public', ''),
    ),
  )

  it('carries what Chrome requires to offer installation', () => {
    expect(manifest.name).toBeTruthy()
    expect(manifest.short_name).toBeTruthy()
    expect(manifest.start_url).toBe('/')
    expect(manifest.display).toBe('standalone')
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i)
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('provides the expected sizes, including a maskable icon', () => {
    const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes)
    expect(sizes).toContain('192x192')
    expect(sizes).toContain('512x512')

    const maskable = manifest.icons.find((i: { purpose: string }) => i.purpose === 'maskable')
    expect(maskable).toBeTruthy()
    expect(maskable.sizes).toBe('512x512')
  })

  it('points at files that really exist', () => {
    for (const icon of manifest.icons as { src: string; type: string }[]) {
      expect(icon.type).toBe('image/png')
      // An icon declared but missing breaks installation with nothing to report
      // it before trying on a real browser.
      expect(shipped, icon.src).toContain(icon.src)
    }
  })

  it('is referenced by the page, with one theme colour per mode', () => {
    const html = indexRaw
    expect(html).toContain('rel="manifest"')
    expect(html).toContain('/manifest.webmanifest')
    expect(html).toContain('prefers-color-scheme: light')
    expect(html).toContain('prefers-color-scheme: dark')
  })

  it('serves the service worker only in production', () => {
    const main = mainRaw
    // In development, a cache comes between hot reload and the page, and hours
    // go into debugging a version that no longer exists.
    expect(main).toContain('import.meta.env.PROD')
    expect(main).toMatch(/serviceWorker\s*\n?\s*\.register\(\s*'\/sw\.js'/)
  })

  it('registers the service worker without going through the HTTP cache', () => {
    // Measured in production: `_headers` asks for `no-cache` on `/sw.js` and
    // Cloudflare serves `max-age=14400` anyway, and a returning visitor kept
    // the old worker, and the old application, for up to four hours.
    // `updateViaCache: 'none'` holds whatever the host.
    expect(mainRaw).toContain("updateViaCache: 'none'")
  })

  it('serves the page from the network first, the cache only as a fallback', () => {
    const sw = swRaw
    // Cache-first on the document would serve an old version after a deploy.
    // The asset files carry a fingerprint in their name: caching those
    // unconditionally carries no risk.
    expect(sw).toContain("request.mode === 'navigate'")
    expect(sw).toMatch(/fetch\(request\)[\s\S]*\.catch\(\(\) =>[\s\S]*caches\s*\n?\s*\.match/)
    expect(sw).toContain('caches.delete')
  })
})
