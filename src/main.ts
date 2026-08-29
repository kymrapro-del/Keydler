import './webmcp'

import './tokens.css'
import './style.css'
import { redirectToCanonical } from './canonical'
import { buildMeasureTask } from './demo/measures'
import * as store from './store/taskStore'
import { mount } from './ui/bench'
import { currentTaskIdFromLocation } from './webmcp/location'

// Before anything else: on the wrong origin, nothing that follows must run.
// Mounting the page there would create a parallel database that nobody will
// ever find again.
if (redirectToCanonical()) {
  throw new Error('redirection vers l’origine canonique')
}

const root = document.querySelector<HTMLElement>('#app')
if (!root) throw new Error('#app introuvable')

const lié = currentTaskIdFromLocation()

mount(root)

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // `updateViaCache: 'none'` makes the update check ignore the HTTP cache,
    // without depending on a header we do not control. Measured in production:
    // `public/_headers` asks for `no-cache` on `/sw.js` and Cloudflare serves
    // `max-age=14400` (four hours), the worker being the only thing cached at
    // the edge (`cf-cache-status: REVALIDATED` against `DYNAMIC`). A visitor who
    // came back kept the old worker, and with it the old application.
    void navigator.serviceWorker
      .register('/sw.js', { updateViaCache: 'none' })
      .catch(() => undefined)
  })
}

void (async () => {
  await store.init(lié ?? undefined)

  const n = Number(new URLSearchParams(location.search).get('mesure'))
  if (!n) return

  const voulue = buildMeasureTask(n)
  if (store.currentTask()?.title === voulue.title) return
  await store.openPreparedTask(voulue)
})()
