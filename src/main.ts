import './webmcp'

import './tokens.css'
import './style.css'
import { redirectToCanonical } from './canonical'
import { buildMeasureTask } from './demo/measures'
import * as store from './store/taskStore'
import { mount } from './ui/bench'
import { currentTaskIdFromLocation } from './webmcp/location'

// On the wrong origin nothing below must run: mounting the page there creates a
// second database, unreachable from the canonical one.
if (redirectToCanonical()) {
  throw new Error('redirecting to the canonical origin')
}

const root = document.querySelector<HTMLElement>('#app')
if (!root) throw new Error('#app introuvable')

const bound = currentTaskIdFromLocation()

mount(root)

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // `updateViaCache: 'none'` makes the update check ignore the HTTP cache,
    // without depending on a header set elsewhere. In production
    // `public/_headers` asks for `no-cache` on `/sw.js` and Cloudflare serves
    // `max-age=14400`, the worker being the only thing edge-cached
    // (`cf-cache-status: REVALIDATED` against `DYNAMIC`). A returning visitor
    // kept the old worker, and with it the old application.
    void navigator.serviceWorker
      .register('/sw.js', { updateViaCache: 'none' })
      .catch(() => undefined)
  })
}

void (async () => {
  await store.init(bound ?? undefined)

  const n = Number(new URLSearchParams(location.search).get('measure'))
  if (!n) return

  const wanted = buildMeasureTask(n)
  if (store.currentTask()?.title === wanted.title) return
  await store.openPreparedTask(wanted)
})()
