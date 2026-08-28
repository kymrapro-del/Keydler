import './webmcp'

import './fonts.css'
import './tokens.css'
import './style.css'
import './workspace.css'
import './marketing.css'
import { buildMeasureTask } from './demo/measures'
import * as store from './store/taskStore'
import { mount } from './ui/bench'
import { currentTaskIdFromLocation } from './webmcp/location'

const root = document.querySelector<HTMLElement>('#app')
if (!root) throw new Error('#app introuvable')

const lié = currentTaskIdFromLocation()

mount(root)

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined)
  })
}

/**
 * L'adresse décide du cahier.
 *
 * `/t/:id` ouvre CE cahier. Sans identifiant, `/` reste la vitrine publique,
 * même si ce navigateur contient déjà une mémoire. La différence est décisive
 * dès qu'il y a plus d'une tâche sur l'appareil : liée, la page rend la tâche
 * nommée ou dit qu'elle a disparu ; publique, elle n'ouvre rien implicitement.
 *
 * `?mesure=N` charge la tâche de mesure N au chargement de la page.
 *
 * Le protocole du J6 doit être rejouable par une simple URL : un juge ouvre
 * l'adresse et retrouve exactement l'état sur lequel la mesure a été faite,
 * sans manipulation. La tâche n'est reconstruite que si le cahier ouvert n'est
 * pas déjà celle-là, pour qu'un rechargement en cours d'essai ne remette pas
 * le compteur à zéro.
 */
void (async () => {
  if (lié) await store.init(lié)
  else await store.initPublicLanding()

  const n = Number(new URLSearchParams(location.search).get('mesure'))
  if (!n) return

  const voulue = buildMeasureTask(n)
  if (store.currentTask()?.title === voulue.title) return
  await store.openPreparedTask(voulue)
})()
