// L'enregistrement WebMCP est un effet de bord d'import, volontairement placé
// avant tout rendu. Il ne dépend d'aucun composant et ne doit jamais en
// dépendre : le mode strict de React, quand il arrivera, monte deux fois.
import './webmcp'

import './tokens.css'
import './style.css'
import { buildMeasureTask } from './demo/measures'
import * as store from './store/taskStore'
import { mount } from './ui/bench'

/**
 * Point d'entrée : monter la vue, puis amorcer l'état.
 *
 * Tout ce qui est testable vit dans `ui/bench.ts` ; ce fichier ne garde que ce
 * qui ne peut pas l'être — l'accrochage au document et la lecture de l'URL.
 */
const root = document.querySelector<HTMLElement>('#app')
if (!root) throw new Error('#app introuvable')

mount(root)

/**
 * `?mesure=N` charge la tâche de mesure N au chargement de la page.
 *
 * Le protocole du J6 doit être rejouable par une simple URL : un juge ouvre
 * l'adresse et retrouve exactement l'état sur lequel la mesure a été faite,
 * sans manipulation. La tâche n'est reconstruite que si le cahier ouvert n'est
 * pas déjà celle-là, pour qu'un rechargement en cours d'essai ne remette pas
 * le compteur à zéro.
 */
void (async () => {
  await store.init()

  const n = Number(new URLSearchParams(location.search).get('mesure'))
  if (!n) return

  const voulue = buildMeasureTask(n)
  if (store.currentTask()?.title === voulue.title) return
  await store.openPreparedTask(voulue)
})()
