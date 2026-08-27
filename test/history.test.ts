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

describe('mise en mots du journal', () => {
  it('dit qui a fait quoi, sans nom d’opération machine', () => {
    const line = describeEntry(entry({ actor: 'human', operation: 'deactivate_constraint' }))
    expect(line.who).toBe('You')
    expect(line.what).toBe('lifted a rule')
    expect(line.what).not.toContain('deactivate_constraint')
  })

  it('distingue une règle POSÉE par l’humain d’une règle PROPOSÉE par l’agent', () => {
    expect(describeEntry(entry({ actor: 'human', operation: 'add_constraint' })).what).toBe(
      'added a rule',
    )
    // C'est toute l'asymétrie du produit, et elle doit se lire dans l'historique.
    expect(describeEntry(entry({ actor: 'agent', operation: 'add_constraint' })).what).toBe(
      'proposed a rule',
    )
  })

  it('explique un refus par sa cause, pas par son code', () => {
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

  it('reporte le compteur de tentatives répétées', () => {
    const line = describeEntry(entry({ outcome: 'refused', detail: 'stale write', repeated: 7 }))
    expect(line.repeated).toBe(7)
  })

  it('nomme l’élagage comme un fait du système, pas de quelqu’un', () => {
    const line = describeEntry(
      entry({ operation: 'audit_trimmed', detail: '40 earlier entries dropped' }),
    )
    expect(line.who).toBe('System')
    expect(line.refused).toBe(false)
  })

  it('ne laisse jamais une opération inconnue sans phrase', () => {
    const line = describeEntry(entry({ operation: 'some_future_operation', actor: 'human' }))
    expect(line.what).toContain('some_future_operation')
    expect(line.what.length).toBeGreaterThan(5)
  })

  it('rend le plus récent en premier', () => {
    const lines = describeHistory([
      entry({ id: 'a', at: 1 }),
      entry({ id: 'b', at: 2 }),
      entry({ id: 'c', at: 3 }),
    ])
    expect(lines.map((l) => l.at)).toEqual([3, 2, 1])
  })
})

describe('l’historique à l’écran', () => {
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

  const section = () =>
    [...root.querySelectorAll('.card')].find((c) =>
      c.querySelector('h2')?.textContent?.includes('History'),
    )!

  it('montre le passé du cahier en langage humain', async () => {
    expect(section().textContent).toContain('recorded a step')

    // L'extrait ne montre que les plus récentes ; la création est la plus
    // ancienne du cahier de démonstration et n'y figure donc pas.
    root.querySelector<HTMLButtonElement>('#toggle-history')!.click()
    await settled()

    const text = section().textContent ?? ''
    expect(text).toContain('created the task')
    expect(text).toContain('added a rule')
    expect(text).toContain('approved evidence')

    // Aucun nom d'opération machine ne doit atteindre l'écran.
    for (const raw of ['log_step', 'add_constraint', 'verify_evidence', 'create_task']) {
      expect(text, raw).not.toContain(raw)
    }
  })

  it('rend un refus visible dans l’historique, avec sa cause', async () => {
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

  it('reflète une action humaine dès qu’elle a lieu', async () => {
    const step = store.currentTask()!.steps.find((s) => s.evidence !== null)!
    await store.mutate((s) => verifyEvidence(s, step.id, step.evidence!.content))
    await settled()
    expect(section().textContent).toContain('approved evidence')

    const rule = store.currentTask()!.constraints[0]
    await store.mutate((s) => setConstraintActive(s, rule.id, false))
    await settled()
    expect(section().textContent).toContain('lifted a rule')
  })

  it('n’affiche qu’un extrait, et se déplie sur demande', async () => {
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
  // Les fichiers réellement présents, vus par le graphe de modules — pas une
  // liste écrite à la main qui resterait vraie après la suppression d'un
  // fichier.
  const shipped = new Set(
    Object.keys(import.meta.glob('../public/icons/*', { eager: true, query: '?url' })).map((p) =>
      p.replace('../public', ''),
    ),
  )

  it('porte ce que Chrome exige pour proposer l’installation', () => {
    expect(manifest.name).toBeTruthy()
    expect(manifest.short_name).toBeTruthy()
    expect(manifest.start_url).toBe('/')
    expect(manifest.display).toBe('standalone')
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i)
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('fournit les tailles attendues, dont une icône masquable', () => {
    const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes)
    expect(sizes).toContain('192x192')
    expect(sizes).toContain('512x512')

    const maskable = manifest.icons.find((i: { purpose: string }) => i.purpose === 'maskable')
    expect(maskable).toBeTruthy()
    expect(maskable.sizes).toBe('512x512')
  })

  it('pointe vers des fichiers qui existent réellement', () => {
    for (const icon of manifest.icons as { src: string; type: string }[]) {
      expect(icon.type).toBe('image/png')
      // Une icône déclarée mais absente casse l'installation sans que rien ne
      // le signale avant l'essai sur un vrai navigateur.
      expect(shipped, icon.src).toContain(icon.src)
    }
  })

  it('est référencé par la page, avec une couleur de thème par mode', () => {
    const html = indexRaw
    expect(html).toContain('rel="manifest"')
    expect(html).toContain('/manifest.webmanifest')
    expect(html).toContain('prefers-color-scheme: light')
    expect(html).toContain('prefers-color-scheme: dark')
  })

  it('ne sert le service worker qu’en production', () => {
    const main = mainRaw
    // En développement, un cache s'interpose entre le rechargement à chaud et
    // la page : on perd des heures à déboguer une version qui n'existe plus.
    expect(main).toContain('import.meta.env.PROD')
    expect(main).toContain("navigator.serviceWorker.register('/sw.js')")
  })

  it('sert la page par le réseau d’abord, le cache seulement en secours', () => {
    const sw = swRaw
    // Cache-first sur le document servirait une ancienne version après un
    // déploiement. Les fichiers d'assets, eux, portent une empreinte dans leur
    // nom : les mettre en cache sans condition est sans risque.
    expect(sw).toContain("request.mode === 'navigate'")
    expect(sw).toMatch(/fetch\(request\)[\s\S]*\.catch\(\(\) =>[\s\S]*caches\s*\n?\s*\.match/)
    expect(sw).toContain('caches.delete')
  })
})
