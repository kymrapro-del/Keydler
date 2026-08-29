import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildDemoTask } from '../src/demo/seed'
import { FRAGMENT_KEY, packSealedTask, packTask } from '../src/export/link'
import * as store from '../src/store/taskStore'
import { __renderNow, mount } from '../src/ui/bench'
import { clearDatabase, waitUntil } from './helpers'

let root: HTMLElement
let unmount: () => void
let copied: string | null

async function settled(turns = 8) {
  for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0))
  __renderNow()
}

async function open() {
  document.body.innerHTML = '<div id="annonces"></div><div id="app"></div>'
  root = document.querySelector<HTMLElement>('#app')!
  unmount = mount(root)
  await settled()
}

beforeEach(async () => {
  copied = null
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: (t: string) => {
        copied = t
        return Promise.resolve()
      },
    },
  })
  localStorage.clear()
  store.__resetStore()
  await clearDatabase()
  await store.init()
  await open()
  await store.openPreparedTask(buildDemoTask())
  await settled()
})

afterEach(() => {
  unmount()
  localStorage.clear()
  history.replaceState(null, '', '/')
})

describe('offrir le cahier dans un lien', () => {
  it('copie une adresse qui porte tout le cahier', async () => {
    root.querySelector<HTMLButtonElement>('#copy-link')!.click()
    await waitUntil(() => copied !== null, 'la copie')
    await settled()

    expect(copied).toContain(`#${FRAGMENT_KEY}`)
    expect(copied!.length).toBeGreaterThan(200)
    // The fragment never leaves the browser: it is not sent to the server.
    expect(copied!.split('#')[0]).toContain('/t/')
  })

  // The link carries the evidence as it is, and command output can carry a
  // token or the name of an internal machine. Saying so after the click is
  // useless: the address is already in the clipboard.
  it('prévient de ce qui voyage AVANT le clic, pas après', async () => {
    const zone = root.querySelector('.handoff')!.textContent!.replace(/\s+/g, ' ')

    expect(zone).toContain('pieces of evidence travel with it')
    expect(zone).toContain('token or an internal hostname')
    // And it reassures about what CANNOT travel, because that is structural.
    expect(zone).toContain('Sealed credentials never travel')
  })

  it('se tait quand aucune preuve n’est attachée', async () => {
    // A warning shown for no reason teaches people to stop reading it.
    const nue = { ...buildDemoTask(), id: 'sans-preuve', steps: [] }
    await store.openPreparedTask(nue)
    await settled()

    const zone = root.querySelector('.handoff')!.textContent!.replace(/\s+/g, ' ')
    expect(zone).not.toContain('evidence travel')
    expect(zone).not.toContain('internal hostname')
    // The button itself is still offered.
    expect(root.querySelector('#copy-link')).not.toBeNull()
  })

  it('compte au singulier quand il n’y a qu’une preuve', async () => {
    const demo = buildDemoTask()
    const une = {
      ...demo,
      id: 'une-preuve',
      steps: demo.steps.filter((s) => s.evidence !== null).slice(0, 1),
    }
    await store.openPreparedTask(une)
    await settled()

    const zone = root.querySelector('.handoff')!.textContent!.replace(/\s+/g, ' ')
    expect(zone).toContain('One piece of evidence travels with it')
  })

  it('dit ce qu’il vient de copier, et que c’est une copie', async () => {
    root.querySelector<HTMLButtonElement>('#copy-link')!.click()
    await waitUntil(() => !!root.querySelector('.notice--ok'), 'le message')
    __renderNow()

    const message = root.querySelector('.notice--ok')!.textContent!
    expect(message.toLowerCase()).toContain('copy')
    // And it names what went with it, not just “the log”.
    expect(message).toContain('evidence included')
  })
})

describe('recevoir un cahier par un lien', () => {
  async function arriveWith(packed: string) {
    unmount()
    store.__resetStore()
    await clearDatabase()
    // Like main.ts: the address is read BEFORE the store opens, so the task is
    // indeed bound to an id absent from this device.
    history.replaceState(null, '', `/t/notonthisdevice#${FRAGMENT_KEY}${packed}`)
    await store.init('notonthisdevice')
    await open()
  }

  const offer = () =>
    [...root.querySelectorAll('.card')].find((c) =>
      c.querySelector('h2')?.textContent?.includes('A shared log'),
    )

  it('propose, et n’importe rien tout seul', async () => {
    const packed = await packTask(buildDemoTask())
    await arriveWith(packed)

    expect(offer()).toBeDefined()
    expect(offer()!.textContent).toContain('Refactor the authentication module')
    // Nothing was written: opening a link is not consenting to write it.
    expect(await store.allTasks()).toHaveLength(0)
  })

  it('ne contredit pas l’offre par un bandeau « cette tâche n’existe pas »', async () => {
    await arriveWith(await packTask(buildDemoTask()))

    // The address does point at a missing task, but the link carries exactly
    // what it takes to create it. Saying both at once alarms for nothing.
    expect(root.textContent).not.toContain('does not exist on this device')
    expect(offer()).toBeDefined()
  })

  it('dit à nouveau la tâche absente si l’on refuse le lien', async () => {
    await arriveWith(await packTask(buildDemoTask()))
    root.querySelector<HTMLButtonElement>('#decline-link')!.click()
    await settled()

    expect(root.textContent).toContain('does not exist on this device')
  })

  it('annonce que ce sera une copie, sans lien avec l’original', async () => {
    await arriveWith(await packTask(buildDemoTask()))
    expect(offer()!.textContent!.toLowerCase()).toContain('copy')
  })

  it('importe sur demande, et ouvre le cahier reçu', async () => {
    const source = buildDemoTask()
    await arriveWith(await packTask(source))

    root.querySelector<HTMLButtonElement>('#accept-link')!.click()
    await waitUntil(() => store.currentTask() !== null, 'le cahier importé', 3000)
    await settled()

    expect(store.currentTask()!.title).toBe(source.title)
    expect(store.currentTask()!.steps.length).toBe(source.steps.length)
    expect(offer()).toBeUndefined()
    // The address does not keep the payload: reloading would not offer again.
    expect(location.hash).toBe('')
  })

  it('se refuse d’un clic, et laisse la page vide comme avant', async () => {
    await arriveWith(await packTask(buildDemoTask()))

    root.querySelector<HTMLButtonElement>('#decline-link')!.click()
    await settled()

    expect(offer()).toBeUndefined()
    expect(await store.allTasks()).toHaveLength(0)
    expect(location.hash).toBe('')
  })

  it('dit qu’un lien est illisible plutôt que de laisser croire à une page cassée', async () => {
    await arriveWith('zdefinitivementpasuncahier')
    await waitUntil(() => !!root.querySelector('.notice--error'), 'le message d’erreur', 3000)
    __renderNow()

    expect(root.querySelector('.notice--error')!.textContent).toMatch(/link/i)
    expect(offer()).toBeUndefined()
  })
})

describe('le lien protégé, depuis l’écran', () => {
  async function arriveWith(packed: string) {
    unmount()
    store.__resetStore()
    await clearDatabase()
    history.replaceState(null, '', `/t/notonthisdevice#${FRAGMENT_KEY}${packed}`)
    await store.init('notonthisdevice')
    await open()
  }

  function type(id: string, value: string) {
    const champ = root.querySelector<HTMLInputElement>(`#${id}`)!
    champ.value = value
    champ.dispatchEvent(new Event('input', { bubbles: true }))
  }

  it('copie un lien scellé, et le dit sans promettre plus que ça', async () => {
    const bouton = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.trim() === 'Copy a protected link',
    )!
    expect(bouton).toBeTruthy()

    const vrai = window.prompt
    window.prompt = () => 'la phrase du téléphone'
    bouton.click()
    await waitUntil(() => copied !== null, 'la copie')
    window.prompt = vrai
    await settled()

    expect(copied).toContain(`#${FRAGMENT_KEY}s`)
    // Nothing of the log shows through in the address.
    expect(copied).not.toContain(store.currentTask()!.title.replace(/ /g, ''))
    expect(root.querySelector('.notice--ok')?.textContent).toContain('unreadable')
  })

  it('n’annonce pas ce qu’il ne fait pas', async () => {
    // The passphrase does not check an identity: it checks knowledge of a
    // secret. The screen must say so, and say why.
    const zone = root.querySelector('.handoff')!.textContent!.replace(/\s+/g, ' ')
    expect(zone).toContain('Nobody can tell who opens a link')
    expect(zone).toContain('would need a server')
  })

  it('ne dit rien du cahier tant que la phrase n’est pas donnée', async () => {
    const packed = await packSealedTask(store.currentTask()!, 'la phrase du téléphone')
    const titre = store.currentTask()!.title
    await arriveWith(packed)

    const texte = root.textContent!.replace(/\s+/g, ' ')
    expect(texte).toContain('A protected log')
    expect(texte).not.toContain(titre)
    expect(root.querySelector('#sealed-passphrase')).not.toBeNull()
  })

  it('ouvre avec la bonne phrase, et propose la copie comme d’habitude', async () => {
    const packed = await packSealedTask(store.currentTask()!, 'la phrase du téléphone')
    const titre = store.currentTask()!.title
    await arriveWith(packed)

    type('sealed-passphrase', 'la phrase du téléphone')
    root.querySelector<HTMLFormElement>('#form-sealed')!.requestSubmit()
    await waitUntil(() => root.textContent!.includes('A shared log'), 'l’offre')
    __renderNow()

    expect(root.textContent).toContain(titre)
    expect(root.querySelector('#accept-link')).not.toBeNull()
  })

  it('refuse une phrase fausse en disant que le lien, lui, est bon', async () => {
    const packed = await packSealedTask(store.currentTask()!, 'la phrase du téléphone')
    await arriveWith(packed)

    type('sealed-passphrase', 'ce n’est pas la bonne')
    root.querySelector<HTMLFormElement>('#form-sealed')!.requestSubmit()
    await waitUntil(() => !!root.querySelector('.notice--error'), 'le refus')
    __renderNow()

    const message = root.querySelector('.notice--error')!.textContent!
    expect(message).toContain('does not open this link')
    expect(message).toContain('the link itself is fine')
    // And it stays open: you can type it again.
    expect(root.querySelector('#sealed-passphrase')).not.toBeNull()
  })
})
